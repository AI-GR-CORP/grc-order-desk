import { clamp01, normalizeIsoDate, similarity, truncate, TRACKED_CATEGORIES, type ThreadCategory } from '@grc/core';
import type { BulkOrderExtraction, DevItemExtraction, ThreadExtraction } from '@grc/core/ai';
import { retryOnConflict, type Db, type Sql, type Tx } from '../db';
import { canonicalCompanyId, findOrCreateCompany } from './companies';

export interface ApplyMeta {
  /** sent_at of the newest message the model saw. */
  extractedThrough: Date;
  /** Ids the model was allowed to reference (shown to it as EXISTING ITEMS). */
  devIds: ReadonlySet<string>;
  bulkIds: ReadonlySet<string>;
  stageKeys: ReadonlySet<string>;
}

const codeKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s\-_./]/g, '');

/** Fields only written when the model returns a value and nobody has edited them by hand. */
function patchFor(values: Record<string, unknown>, locked: readonly string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === '') continue;
    if (locked.includes(k)) continue;
    patch[k] = v;
  }
  return patch;
}

function devValues(d: DevItemExtraction) {
  return {
    enquiry_date: normalizeIsoDate(d.enquiry_date),
    merchant_name: truncate(d.merchant_name, 200),
    brand: truncate(d.brand, 200),
    inquiry: truncate(d.inquiry, 2000),
    product_code: truncate(d.product_code, 200),
    colours: truncate(d.colours, 500),
    sample_collected: d.sample_collected,
    grc_rate: truncate(d.grc_rate, 300),
    sample_dispatch_date: normalizeIsoDate(d.sample_dispatch_date),
    courier: truncate(d.courier, 100),
    awb: truncate(d.awb, 100),
    edd: normalizeIsoDate(d.edd),
    brand_status: truncate(d.brand_status, 1000),
    team_status: truncate(d.team_status, 1000),
    next_action: truncate(d.next_action, 1000),
    summary: truncate(d.summary, 2000),
    stage: d.stage,
  };
}

async function findDuplicateDev(tx: Tx, companyId: string, d: DevItemExtraction): Promise<string | null> {
  const rows = await tx<{ id: string; brand: string | null; inquiry: string | null; product_code: string | null }[]>`
    select id, brand, inquiry, product_code from dev_item
    where company_id = ${companyId} and stage <> 'closed'
    order by updated_at desc limit 200`;
  const code = codeKey(d.product_code);
  if (code) {
    const hit = rows.find((r) => codeKey(r.product_code) === code);
    if (hit) return hit.id;
  }
  if (d.brand && d.inquiry) {
    const hit = rows.find(
      (r) => r.brand?.toLowerCase().trim() === d.brand!.toLowerCase().trim() && similarity(r.inquiry, d.inquiry) >= 0.75,
    );
    if (hit) return hit.id;
  }
  return null;
}

async function upsertDevItem(
  tx: Tx,
  ctx: { threadId: string; companyId: string | null; meta: ApplyMeta },
  d: DevItemExtraction,
): Promise<string> {
  let id = d.existing_item_id && ctx.meta.devIds.has(d.existing_item_id) ? d.existing_item_id : null;
  if (!id && ctx.companyId) id = await findDuplicateDev(tx, ctx.companyId, d);
  const values = devValues(d);
  const confidence = clamp01(d.confidence);

  if (!id) {
    const [row] = await tx<{ id: string }[]>`
      insert into dev_item ${tx({
        ...values,
        company_id: ctx.companyId,
        primary_thread_id: ctx.threadId,
        last_activity_at: ctx.meta.extractedThrough,
        last_follow_up: ctx.meta.extractedThrough.toISOString().slice(0, 10),
        ai_confidence: confidence,
        source: 'ai',
      })}
      returning id`;
    id = row!.id;
  } else {
    const [cur] = await tx<{ locked_fields: string[]; company_id: string | null }[]>`
      select locked_fields, company_id from dev_item where id = ${id} for update`;
    const patch = patchFor(values, cur?.locked_fields ?? []);
    patch.last_activity_at = ctx.meta.extractedThrough;
    patch.last_follow_up = ctx.meta.extractedThrough.toISOString().slice(0, 10);
    patch.ai_confidence = confidence;
    if (!cur?.company_id && ctx.companyId) patch.company_id = ctx.companyId;
    await tx`update dev_item set ${tx(patch)} where id = ${id}`;
  }
  await tx`
    insert into item_thread (thread_id, dev_item_id) values (${ctx.threadId}, ${id})
    on conflict (thread_id, dev_item_id) where dev_item_id is not null do nothing`;
  return id;
}

async function findDuplicateBulk(tx: Tx, companyId: string, b: BulkOrderExtraction): Promise<string | null> {
  const rows = await tx<{ id: string; po_number: string | null; pi_number: string | null; product_code: string | null; brand: string | null }[]>`
    select id, po_number, pi_number, product_code, brand from bulk_order
    where company_id = ${companyId} and status not in ('completed','cancelled')
    order by updated_at desc limit 100`;
  for (const key of ['po_number', 'pi_number'] as const) {
    const v = codeKey(b[key]);
    if (v) {
      const hit = rows.find((r) => codeKey(r[key]) === v);
      if (hit) return hit.id;
    }
  }
  const code = codeKey(b.product_code);
  if (code) {
    const hit = rows.find((r) => codeKey(r.product_code) === code && (!b.brand || !r.brand || r.brand.toLowerCase() === b.brand.toLowerCase()));
    if (hit) return hit.id;
  }
  return null;
}

async function upsertBulkOrder(
  tx: Tx,
  ctx: { threadId: string; companyId: string | null; meta: ApplyMeta },
  b: BulkOrderExtraction,
): Promise<string> {
  let id = b.existing_order_id && ctx.meta.bulkIds.has(b.existing_order_id) ? b.existing_order_id : null;
  if (!id && ctx.companyId) id = await findDuplicateBulk(tx, ctx.companyId, b);
  const values = {
    brand: truncate(b.brand, 200),
    product_code: truncate(b.product_code, 200),
    description: truncate(b.description, 2000),
    qty_mtrs: typeof b.qty_mtrs === 'number' && Number.isFinite(b.qty_mtrs) ? b.qty_mtrs : null,
    pi_number: truncate(b.pi_number, 100),
    po_number: truncate(b.po_number, 100),
    status: b.status,
    current_stage: b.current_stage && ctx.meta.stageKeys.has(b.current_stage) ? b.current_stage : null,
    next_action: truncate(b.next_action, 1000),
    summary: truncate(b.summary, 2000),
  };

  if (!id) {
    const [row] = await tx<{ id: string }[]>`
      insert into bulk_order ${tx({
        ...values,
        company_id: ctx.companyId,
        primary_thread_id: ctx.threadId,
        last_activity_at: ctx.meta.extractedThrough,
        ai_confidence: clamp01(b.confidence),
        source: 'ai',
      })}
      returning id`;
    id = row!.id;
  } else {
    const [cur] = await tx<{ locked_fields: string[]; company_id: string | null }[]>`
      select locked_fields, company_id from bulk_order where id = ${id} for update`;
    const patch = patchFor(values, cur?.locked_fields ?? []);
    patch.last_activity_at = ctx.meta.extractedThrough;
    patch.ai_confidence = clamp01(b.confidence);
    if (!cur?.company_id && ctx.companyId) patch.company_id = ctx.companyId;
    await tx`update bulk_order set ${tx(patch)} where id = ${id}`;
  }

  for (const s of b.stages) {
    if (!ctx.meta.stageKeys.has(s.key) || !s.value?.trim()) continue;
    await tx`
      insert into bulk_order_stage (bulk_order_id, stage_key, value, done_on, source)
      values (${id}, ${s.key}, ${truncate(s.value, 300)}, ${normalizeIsoDate(s.date)}, 'ai')
      on conflict (bulk_order_id, stage_key) do update
        set value = excluded.value, done_on = coalesce(excluded.done_on, bulk_order_stage.done_on), source = 'ai'
        where not bulk_order_stage.locked`;
  }

  if (b.from_dev_item_id && ctx.meta.devIds.has(b.from_dev_item_id)) {
    await tx`update bulk_order set dev_item_id = coalesce(dev_item_id, ${b.from_dev_item_id}) where id = ${id}`;
    await tx`
      update dev_item set converted_to_bulk_id = ${id},
             stage = case when 'stage' = any(locked_fields) then stage else 'converted_to_bulk'::dev_stage end
      where id = ${b.from_dev_item_id}`;
  }

  await tx`
    insert into item_thread (thread_id, bulk_order_id) values (${ctx.threadId}, ${id})
    on conflict (thread_id, bulk_order_id) where bulk_order_id is not null do nothing`;
  return id;
}

/** Writes one extraction result. Everything in one transaction; human-edited fields are never overwritten. */
export async function applyExtraction(sql: Sql, threadId: string, x: ThreadExtraction, meta: ApplyMeta): Promise<void> {
  await retryOnConflict(() => sql.begin(async (tx) => {
    const [t] = await tx<{ company_id: string | null; company_locked: boolean; category_locked: boolean; category: ThreadCategory; sorted: boolean }[]>`
      select company_id, company_locked, category_locked, category, classified_at is not null as sorted from email_thread where id = ${threadId} for update`;
    if (!t) return;

    let companyId = t.company_id ? await canonicalCompanyId(tx, t.company_id) : null;
    let createdCompany = false;
    if (!companyId && !t.company_locked && x.company.name?.trim()) {
      const r = await findOrCreateCompany(tx, { name: x.company.name, city: x.company.city, country: x.company.country }, { needsReview: true });
      companyId = r.id;
      createdCompany = r.created;
    }
    if (companyId) {
      await tx`
        update contact set company_id = ${companyId}
        where company_id is null
          and email in (select from_email from email_message where thread_id = ${threadId} and direction = 'inbound')`;
    }

    let handledBy: string | null = null;
    if (x.handled_by_email) {
      const [tm] = await tx<{ id: string }[]>`select id from team_member where email = ${x.handled_by_email.toLowerCase()}`;
      handledBy = tm?.id ?? null;
    }

    // Once a person or the conversation-level sort decided the type, extraction can't change it.
    const decided = t.category_locked || t.sorted;
    const category: ThreadCategory = decided ? t.category : x.thread_category === 'mixed' ? 'bulk' : x.thread_category;
    const confidence = clamp01(x.confidence) ?? 0;
    const needsReview = confidence < 0.55 || createdCompany || (!companyId && TRACKED_CATEGORIES.includes(category));

    await tx`
      update email_thread set
        company_id        = coalesce(company_id, ${companyId}),
        category          = ${category},
        handled_by        = coalesce(${handledBy}, handled_by),
        summary           = ${truncate(x.summary, 3000)},
        next_action       = ${truncate(x.next_action, 1000)},
        waiting_on        = ${x.waiting_on},
        ai_state          = ${tx.json(x as never)},
        extracted_through = ${meta.extractedThrough},
        ai_confidence     = ${confidence},
        needs_review      = ${needsReview},
        ai_updated_at     = now()
      where id = ${threadId}`;

    // The model sees the whole conversation, so its view of the latest customer email wins over triage.
    await tx`
      update email_message set needs_reply = ${x.latest_customer_email_needs_reply}
      where id = (select id from email_message
                  where thread_id = ${threadId} and direction = 'inbound' and sent_at <= ${meta.extractedThrough}
                  order by sent_at desc limit 1)`;

    const ctx = { threadId, companyId, meta };
    // Orders are one type: a bulk conversation gets bulk orders (plus the "became an order" update
    // of an existing development item); a development conversation gets development items only.
    // (Applies once the type is decided by the conversation-level sort or a person.)
    const devItems = decided && category === 'bulk' ? x.dev_items.filter((d) => d.existing_item_id && d.stage === 'converted_to_bulk') : x.dev_items;
    const bulkOrders = decided && category === 'development' ? [] : x.bulk_orders;
    for (const d of devItems) await upsertDevItem(tx, ctx, d);
    for (const b of bulkOrders) await upsertBulkOrder(tx, ctx, b);
  }));
}

export type { Db };
