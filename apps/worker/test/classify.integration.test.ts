/**
 * Conversation sorting (development / bulk + topics) on a real Postgres with the migrations applied.
 * Runs only when TEST_DATABASE_URL is set. Uses a fake AI provider.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmailThread } from '@grc/core/gmail';
import type { ThreadExtraction, ThreadType } from '@grc/core/ai';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

process.env.DATABASE_URL = url ?? 'postgres://unused';
process.env.DATABASE_SSL = 'disable';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const T0 = Date.UTC(2026, 9, 21, 5, 0);
const STAFF = '11111111-1111-1111-1111-111111111111';

function thread(id: string, subject: string, msgs: { from: string; to: string; body: string; mins: number }[]): GmailThread {
  return {
    id,
    messages: msgs.map((m, i) => ({
      id: `${id}-m${i}`,
      threadId: id,
      labelIds: ['INBOX'],
      internalDate: String(T0 + m.mins * 60_000),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: m.from },
          { name: 'To', value: m.to },
          { name: 'Subject', value: subject },
        ],
        body: { data: b64(m.body) },
      },
    })),
  } as GmailThread;
}

d('conversation sorting (integration)', () => {
  let sql: import('../src/db').Sql;
  let classification: ThreadType;
  let extraction: ThreadExtraction | null = null;
  let lastClassify: { system: string; user: string } | null = null;
  const mods = {} as {
    db: typeof import('../src/db');
    ingest: typeof import('../src/pipeline/ingest');
    triage: typeof import('../src/pipeline/triage');
    companies: typeof import('../src/pipeline/companies');
    classify: typeof import('../src/pipeline/classify');
    extract: typeof import('../src/pipeline/extract');
    provider: typeof import('../src/ai/provider');
    job: typeof import('../src/jobs/classify-backfill');
    log: typeof import('../src/log');
  };
  let ctx: import('../src/context').Ctx;
  let mailboxId: string;
  let companyId: string;

  beforeAll(async () => {
    mods.db = await import('../src/db');
    mods.ingest = await import('../src/pipeline/ingest');
    mods.triage = await import('../src/pipeline/triage');
    mods.companies = await import('../src/pipeline/companies');
    mods.classify = await import('../src/pipeline/classify');
    mods.extract = await import('../src/pipeline/extract');
    mods.provider = await import('../src/ai/provider');
    mods.job = await import('../src/jobs/classify-backfill');
    mods.log = await import('../src/log');
    sql = mods.db.createDb();
    await sql`truncate mailbox, company, contact, team_member, job, ai_run, knowledge_profile, correction cascade`;
    ctx = { sql, log: mods.log.log, storage: null } as never;

    mods.provider.setProvider({
      name: 'fake',
      supportsBatch: false,
      async call(opts) {
        const usage = { model: opts.model, input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 };
        if (opts.purpose === 'triage') {
          const inbound = opts.user.includes('[CUSTOMER/EXTERNAL]');
          const category = /order|PO/i.test(opts.user) ? 'bulk' : 'development';
          return { data: { category, is_customer: inbound, needs_reply: inbound, company_name: null, contact_name: null, confidence: 0.9, reason: 'x' } as never, usage };
        }
        if (opts.purpose === 'classify') {
          lastClassify = { system: opts.system, user: opts.user };
          return { data: classification as never, usage };
        }
        return { data: extraction as never, usage };
      },
      batchCreate: async () => 'x',
      batchStatus: async () => ({ ended: true, processing: 0, succeeded: 0, errored: 0 }),
      async *batchResults() {},
    });

    const [mb] = await sql<{ id: string }[]>`insert into mailbox (email, status) values ('yash@grcorporation.co.in', 'active') returning id`;
    mailboxId = mb!.id;
    const [co] = await sql<{ id: string }[]>`
      insert into company (name, name_key, domains, approval) values ('Triple Holdings', 'triple holdings', '{triple.holdings}', 'approved') returning id`;
    companyId = co!.id;
    await sql`insert into auth.users (id, email) values (${STAFF}, 'staff@grcorporation.co.in') on conflict do nothing`;
    await sql`insert into app_user (user_id, email, role) values (${STAFF}, 'staff@grcorporation.co.in', 'staff') on conflict (user_id) do update set role = 'staff'`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  async function ingestAndTriage(t: GmailThread): Promise<string> {
    const settings = await mods.db.getSettings(sql, true);
    const ing = (await mods.ingest.ingestThread(sql, settings, mailboxId, t))!;
    await mods.triage.triageMessages(ctx, settings, '', ing.needsTriageIds);
    await mods.triage.updateThreadCategory(sql, ing.threadId);
    await mods.companies.resolveThreadCompany(sql, settings, ing.threadId);
    return ing.threadId;
  }

  async function asStaff<T>(fn: (tx: import('../src/db').Tx) => Promise<T>): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${STAFF}, true)`;
      return fn(tx);
    }) as Promise<T>;
  }

  let primark: string;

  it('sorts the whole conversation: the PRIMARK top-quantities thread is bulk, never "mixed"', async () => {
    primark = await ingestAndTriage(
      thread('g-primark', "SS27 - PRIMARK Men's Elastic - GRC TOP Qtys", [
        { from: 'Amila Fernando <amila@triple.holdings>', to: 'yash@grcorporation.co.in', body: 'Hi Rashimi, Please find attached the new order with the top quantities. Kindly proceed with bulk production and arrange delivery accordingly.', mins: 0 },
        { from: 'Andrew <andrew@grcorporation.co.in>', to: 'amila@triple.holdings', body: 'Hi Amila, Pls revise POs for unit price $0.078/ meter', mins: 600 },
        { from: 'Amila Fernando <amila@triple.holdings>', to: 'yash@grcorporation.co.in', body: 'Noted, will check the price with the buyer.', mins: 900 },
      ]),
    );
    const settings = await mods.db.getSettings(sql, true);
    expect(await mods.classify.needsClassification(sql, primark)).toBe(true);

    classification = { is_order: true, order_type: 'bulk', topics: [], evidence: 'Kindly proceed with bulk production', confidence: 0.97, reason: 'The customer placed an order with top quantities.' };
    const o = await mods.classify.classifyThread(ctx, settings, '', primark);
    expect(o).toMatchObject({ category: 'bulk', needsCheck: false });

    const [t] = await sql`select category::text, topics, type_needs_check, classified_at is not null as sorted, type_reason from email_thread where id = ${primark}`;
    expect(t).toMatchObject({ category: 'bulk', topics: [], type_needs_check: false, sorted: true });
    expect(t!.type_reason).toContain('Evidence: "Kindly proceed with bulk production"');

    // The model saw GRC's rules, the whole conversation and the keyword clues.
    expect(lastClassify!.system).toContain('ORDER TYPE: exactly one of these two');
    expect(lastClassify!.system).toContain('GRC treats PP approval and sample approval as the same thing');
    expect(lastClassify!.user).toContain('<clues>');
    expect(lastClassify!.user).toMatch(/order \/ bulk: ".*proceed with bulk production/);
    expect(lastClassify!.user).toContain('Pls revise POs for unit price');

    // Nothing new since: no second call.
    expect(await mods.classify.needsClassification(sql, primark)).toBe(false);
  });

  it('flags a doubtful answer for a person: an answer that contradicts a PO, or a low confidence', async () => {
    const clues = await mods.classify.threadClues(sql, primark);
    const wrong = await mods.classify.applyClassification(sql, primark,
      { is_order: true, order_type: 'development', topics: [], evidence: 'revise unit price', confidence: 0.9, reason: 'Price discussion.' }, clues);
    expect(wrong).toMatchObject({ category: 'development', needsCheck: true });
    const [t] = await sql`select type_needs_check, type_reason from email_thread where id = ${primark}`;
    expect(t!.type_needs_check).toBe(true);
    expect(t!.type_reason).toContain('Please check: marked Development, but the emails mention a PO or a bulk order');

    const unsure = await mods.classify.applyClassification(sql, primark,
      { is_order: true, order_type: 'bulk', topics: [], evidence: 'order', confidence: 0.6, reason: 'Probably an order.' }, clues);
    expect(unsure).toMatchObject({ category: 'bulk', needsCheck: true });
  });

  it("a person's correction is locked, recorded with context, and taught to the AI", async () => {
    await asStaff((tx) => tx`select set_thread_type(${primark}::uuid, 'bulk', array['payment_followup'])`);
    const [t] = await sql`select category::text, topics, category_locked, topics_locked, type_needs_check, type_checked_at is not null as checked from email_thread where id = ${primark}`;
    expect(t).toMatchObject({ category: 'bulk', topics: ['payment_followup'], category_locked: true, topics_locked: true, type_needs_check: false, checked: true });

    const fixes = await sql`select field, ai_value, human_value, context from correction where entity_id = ${primark}`;
    expect(fixes.map((f) => f.field)).toEqual(['topics']); // the type was already bulk; only the topic was added
    expect(fixes[0]!.context).toContain("SS27 - PRIMARK Men's Elastic");

    // The AI never changes it again, even when it would answer differently.
    expect(await mods.classify.needsClassification(sql, primark)).toBe(false);
    await mods.classify.applyClassification(sql, primark,
      { is_order: true, order_type: 'development', topics: [], evidence: '', confidence: 0.99, reason: '' }, []);
    const [after] = await sql`select category::text, topics, type_needs_check from email_thread where id = ${primark}`;
    expect(after).toMatchObject({ category: 'bulk', topics: ['payment_followup'], type_needs_check: false });

    // The next conversation from this client is sorted with that lesson in front of the AI.
    mods.classify.resetLessonCache();
    const next = await ingestAndTriage(
      thread('g-ss27-pay', 'SS27 PRIMARK payment', [
        { from: 'Amila Fernando <amila@triple.holdings>', to: 'yash@grcorporation.co.in', body: 'Please confirm when the balance payment is due for the last shipment.', mins: 2000 },
      ]),
    );
    const settings = await mods.db.getSettings(sql, true);
    const req = (await mods.classify.buildClassifyCall(sql, settings, '', next))!;
    expect(req.call.system).toContain('<team_corrections>');
    expect(req.call.system).toContain('correct topics: "payment_followup"');
    expect(req.call.user).toContain('<this_client_corrections>');
    expect(req.call.user).toContain('Conversations with this client that GRC\'s team checked: 1 bulk, 0 development.');
  });

  it('switching the type converts rows: the AI-made row goes, the person-edited row is kept as the new type', async () => {
    const settings = await mods.db.getSettings(sql, true);
    const dev = await ingestAndTriage(
      thread('g-dev', 'Waistband 35MM development', [
        { from: 'Amila Fernando <amila@triple.holdings>', to: 'yash@grcorporation.co.in', body: 'Need 35MM waistband sample, reference sample sent.', mins: 3000 },
      ]),
    );
    classification = { is_order: true, order_type: 'development', topics: [], evidence: 'reference sample sent', confidence: 0.95, reason: 'New sample request.' };
    await mods.classify.classifyThread(ctx, settings, '', dev);
    await sql`insert into dev_item (company_id, primary_thread_id, inquiry, source) values (${companyId}, ${dev}, 'AI row', 'ai')`;
    await sql`insert into dev_item (company_id, primary_thread_id, inquiry, owner_remark, source, locked_fields) values (${companyId}, ${dev}, 'Edited row', 'Yash note', 'ai', '{owner_remark}')`;

    await asStaff((tx) => tx`select set_thread_type(${dev}::uuid, 'bulk', null)`);
    const devLeft = await sql`select inquiry from dev_item where primary_thread_id = ${dev}`;
    const bulk = await sql`select description, owner_remark, locked_fields from bulk_order where primary_thread_id = ${dev}`;
    expect(devLeft).toHaveLength(0);
    expect(bulk).toEqual([{ description: 'Edited row', owner_remark: 'Yash note', locked_fields: ['owner_remark'] }]);
    const [c] = await sql`select ai_value, human_value from correction where entity_id = ${dev} and field = 'order_type'`;
    expect(c).toEqual({ ai_value: 'development', human_value: 'bulk' });
    const [j] = await sql`select kind from job where dedupe_key = ${'reprocess:' + dev}`;
    expect(j!.kind).toBe('reprocess_thread');
  });

  it('extraction only fills rows of the decided type', async () => {
    const settings = await mods.db.getSettings(sql, true);
    const before = await sql`select count(*)::int as n from dev_item where primary_thread_id = ${primark}`;
    extraction = {
      thread_category: 'mixed',
      company: { name: 'Triple Holdings', city: 'Colombo', country: 'Sri Lanka' },
      primary_contact: { name: 'Amila', email: 'amila@triple.holdings' },
      summary: 'Top quantities ordered; price revision requested on POs.',
      next_action: 'Revise POs',
      waiting_on: 'customer',
      latest_customer_email_needs_reply: false,
      handled_by_email: null,
      dev_items: [{ existing_item_id: null, brand: 'Primark', inquiry: 'Should not appear', product_code: null, colours: null, merchant_name: null, enquiry_date: null, sample_collected: null, grc_rate: null, sample_dispatch_date: null, courier: null, awb: null, edd: null, brand_status: null, team_status: null, next_action: null, stage: 'inquiry_received', summary: 'x', confidence: 0.9 }],
      bulk_orders: [{ existing_order_id: null, from_dev_item_id: null, brand: 'Primark', product_code: 'SS27-MEN', description: "Men's elastic top quantities", qty_mtrs: 54000, pi_number: null, po_number: '4512', status: 'open', current_stage: null, stages: [], next_action: 'Revise POs', summary: 'Order placed', confidence: 0.9 }],
      confidence: 0.9,
    };
    expect(await mods.extract.extractThread(ctx, settings, '', primark)).toBe(true);
    const [t] = await sql`select category::text from email_thread where id = ${primark}`;
    expect(t!.category).toBe('bulk'); // the extraction's "mixed" is ignored
    const after = await sql`select count(*)::int as n from dev_item where primary_thread_id = ${primark}`;
    expect(after[0]!.n).toBe(before[0]!.n);
    const bulk = await sql`select po_number from bulk_order where primary_thread_id = ${primark}`;
    expect(bulk.map((b) => b.po_number)).toEqual(['4512']);
  });

  it('the re-sort job sorts every unsorted conversation and re-reads approved ones whose type changed', async () => {
    const lab = await ingestAndTriage(
      thread('g-lab', 'BV test report PO 4512', [
        { from: 'Amila Fernando <amila@triple.holdings>', to: 'yash@grcorporation.co.in', body: 'BV test report attached for PO 4512. Colour fastness failed on navy.', mins: 4000 },
      ]),
    );
    await sql`update email_thread set category = 'development', classified_at = null where id = ${lab}`;
    classification = { is_order: true, order_type: 'bulk', topics: ['lab_approval', 'complaint'], evidence: 'BV test report attached for PO 4512', confidence: 0.93, reason: 'Lab report on an order lot.' };
    const [job] = await sql<{ id: number }[]>`insert into job (kind, mailbox_id, payload) values ('classify_backfill', ${mailboxId}, '{"all": false}') returning id`;
    await mods.job.runClassifyBackfill(ctx, { id: job!.id, kind: 'classify_backfill', mailbox_id: mailboxId, payload: { all: false }, attempts: 1 } as never);

    const [t] = await sql`select category::text, topics, type_needs_check from email_thread where id = ${lab}`;
    expect(t).toMatchObject({ category: 'bulk', topics: ['complaint', 'lab_approval'], type_needs_check: false });
    const [p] = await sql`select backfill_progress->'classify' as p from mailbox where id = ${mailboxId}`;
    expect(p!.p).toMatchObject({ changed: 1 });
    expect(p!.p.done).toBeGreaterThanOrEqual(1);
    const [rj] = await sql`select kind from job where dedupe_key = ${'reprocess:' + lab}`;
    expect(rj!.kind).toBe('reprocess_thread');
  });
});
