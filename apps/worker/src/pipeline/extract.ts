import type { AppSettings } from '@grc/core';
import {
  extractionSystem,
  extractionUserContent,
  fitThreadToBudget,
  ThreadExtractionSchema,
  type ExistingItemRef,
} from '@grc/core/ai';
import { getProvider } from '../ai/provider';
import { recordAiRun } from '../ai/record';
import { config } from '../config';
import type { Ctx } from '../context';
import type { Db } from '../db';
import { errorMessage } from '../errors';
import type { GmailApi } from '@grc/core/gmail';
import { applyExtraction } from './apply';
import { getLearningContext } from './learning';
import { loadThreadPdfs } from './pdfs';
import { loadThreadMessages } from './messages';

export async function loadBulkStages(sql: Db): Promise<{ key: string; label: string }[]> {
  return sql<{ key: string; label: string }[]>`select key, label from bulk_stage_def order by sort_order`;
}

/**
 * Runs the extraction model over one thread and writes the result.
 * Returns false (and flags the thread for review) if the model call fails.
 */
export async function extractThread(
  ctx: Ctx,
  settings: AppSettings,
  profile: string,
  threadId: string,
  /** When given, PDF attachments (PI/PO/test reports) are read too. */
  api?: GmailApi,
): Promise<boolean> {
  const { sql } = ctx;
  const [t] = await sql<{ company_id: string | null; summary: string | null; company_name: string | null; category: string; decided: boolean; topics: string[] }[]>`
    select t.company_id, t.summary, c.name as company_name, t.category::text as category,
           (t.category_locked or t.classified_at is not null) as decided, t.topics
    from email_thread t left join company c on c.id = t.company_id where t.id = ${threadId}`;
  if (!t) return false;

  const messages = (await loadThreadMessages(sql, threadId)).filter((m) => m.triageCategory !== 'marketing');
  if (messages.length === 0) return false;

  const dev = await sql<{ id: string; brand: string | null; inquiry: string | null; product_code: string | null; stage: string; merchant_name: string | null; team_status: string | null }[]>`
    select id, brand, inquiry, product_code, stage::text, merchant_name, team_status from dev_item
    where (company_id = ${t.company_id} and stage <> 'closed')
       or id in (select dev_item_id from item_thread where thread_id = ${threadId} and dev_item_id is not null)
    order by updated_at desc limit 60`;
  const bulk = await sql<{ id: string; brand: string | null; description: string | null; product_code: string | null; current_stage: string | null }[]>`
    select id, brand, description, product_code, current_stage from bulk_order
    where (company_id = ${t.company_id} and status not in ('completed','cancelled'))
       or id in (select bulk_order_id from item_thread where thread_id = ${threadId} and bulk_order_id is not null)
    order by updated_at desc limit 30`;
  const existing: ExistingItemRef[] = [
    ...dev.map((d) => ({
      id: d.id,
      kind: 'dev' as const,
      brand: d.brand,
      // Rows from GRC's sheet sometimes have only a picture: describe them by merchant and status.
      label: d.inquiry?.slice(0, 120) ?? ([d.merchant_name && `merchant ${d.merchant_name}`, d.team_status && `status "${d.team_status.slice(0, 60)}"`].filter(Boolean).join(', ') || null),
      product_code: d.product_code,
      stage: d.stage,
    })),
    ...bulk.map((b) => ({ id: b.id, kind: 'bulk' as const, brand: b.brand, label: b.description?.slice(0, 120) ?? null, product_code: b.product_code, stage: b.current_stage })),
  ];

  const stages = await loadBulkStages(sql);
  const learning = await getLearningContext(sql);
  const documents = api ? await loadThreadPdfs(ctx, api, threadId) : [];
  const fit = fitThreadToBudget(messages, 60_000);
  const model = settings.ai_models.extract;
  const call = {
    purpose: 'extract' as const,
    model,
    system: extractionSystem({ internalDomains: settings.internal_domains, knowledgeProfile: profile, learning }, stages),
    user: orderTypeNote(t) + extractionUserContent({
      companyName: t.company_name,
      existing,
      previousSummary: fit.omitted > 0 ? t.summary : null,
      omittedCount: fit.omitted,
      messages: fit.kept,
    }),
    documents,
    schema: ThreadExtractionSchema,
    maxTokens: 32_000,
    effort: config().AI_EFFORT_EXTRACT || undefined,
  };

  try {
    const r = await getProvider().call(call);
    await recordAiRun(sql, { purpose: 'extract', model, threadId, usage: r.usage, ok: true });
    await applyExtraction(sql, threadId, r.data, {
      extractedThrough: messages[messages.length - 1]!.sentAt,
      devIds: new Set(dev.map((d) => d.id)),
      bulkIds: new Set(bulk.map((b) => b.id)),
      stageKeys: new Set(stages.map((s) => s.key)),
    });
    return true;
  } catch (e) {
    const msg = errorMessage(e);
    ctx.log.warn({ threadId, err: msg }, 'extraction failed');
    await recordAiRun(sql, { purpose: 'extract', model, threadId, ok: false, error: msg });
    await sql`update email_thread set needs_review = true where id = ${threadId}`;
    return false;
  }
}

/** Tells the extraction model which order type GRC has already decided for this conversation. */
function orderTypeNote(t: { category: string; decided: boolean; topics: string[] }): string {
  if (!t.decided || (t.category !== 'bulk' && t.category !== 'development')) return '';
  const topics = t.topics.length ? ` Topics: ${t.topics.join(', ')}.` : '';
  return t.category === 'bulk'
    ? `<order_type>This conversation is BULK (decided by GRC). Put the work under bulk_orders. Do not create new development items; only update an existing development item if it has now become this order (stage converted_to_bulk). Set thread_category to "bulk".${topics}</order_type>\n\n`
    : `<order_type>This conversation is DEVELOPMENT (decided by GRC). Put the work under dev_items and leave bulk_orders empty. Set thread_category to "development".${topics}</order_type>\n\n`;
}
