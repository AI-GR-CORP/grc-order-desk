import { TriageSchema } from '@grc/core/ai';
import { getProvider } from '../ai/provider';
import { recordAiRun } from '../ai/record';
import { config } from '../config';
import type { Ctx } from '../context';
import { getKnowledgeProfile, getSettings, type Db } from '../db';
import { errorMessage, NonRetryableError } from '../errors';
import { gmailFor, loadMailbox, type MailboxRow } from '../gmail-session';
import { resolveThreadCompany } from '../pipeline/companies';
import { runDiscovery } from '../pipeline/discovery';
import { ingestThread } from '../pipeline/ingest';
import { loadMessages } from '../pipeline/messages';
import { recomputeReply } from '../pipeline/reply';
import { applyTriage, triageCall, triageMessages, updateThreadCategory } from '../pipeline/triage';
import { parseStructured } from '../ai/provider';
import { savePayload, type Job } from '../queue';
import { mapLimit, sleep } from '../util';

async function setStage(sql: Db, mailboxId: string, stage: string, progress: Record<string, unknown> = {}) {
  await sql`
    update mailbox set backfill_stage = ${stage},
           backfill_progress = backfill_progress || ${sql.json(progress as never)}
    where id = ${mailboxId}`;
}

/**
 * First import, resumable stage by stage:
 *   ingesting → triaging → discovery → awaiting_review
 * Extraction starts separately (extract_backfill) after someone reviews the client directory.
 */
export async function runBackfill(ctx: Ctx, job: Job): Promise<void> {
  const { sql } = ctx;
  if (!job.mailbox_id) throw new NonRetryableError('backfill job without mailbox');
  let mb = await loadMailbox(sql, job.mailbox_id);
  if (mb.status === 'needs_reconnect') throw new NonRetryableError('Gmail needs to be reconnected');

  if (mb.backfill_stage === 'pending' || mb.backfill_stage === 'ingesting') {
    await ingestStage(ctx, mb);
    mb = await loadMailbox(sql, mb.id);
  }
  if (mb.backfill_stage === 'triaging') {
    await triageStage(ctx, mb, job);
    mb = await loadMailbox(sql, mb.id);
  }
  if (mb.backfill_stage === 'discovery') {
    await discoveryStage(ctx, mb);
  }
}

async function ingestStage(ctx: Ctx, mb: MailboxRow): Promise<void> {
  const { sql } = ctx;
  const settings = await getSettings(sql, true);
  const api = gmailFor(sql, mb);
  await sql`update mailbox set status = 'backfilling', backfill_stage = 'ingesting', last_error = null where id = ${mb.id}`;

  // Checkpoint BEFORE listing, so nothing that arrives during the import is missed by live sync.
  if (!mb.history_id) {
    const profile = await api.getProfile();
    await sql`update mailbox set history_id = ${profile.historyId} where id = ${mb.id}`;
  }

  const progress = mb.backfill_progress as { pageToken?: string | null; threads?: number; messages?: number };
  let pageToken = progress.pageToken ?? undefined;
  let threads = progress.threads ?? 0;
  let messages = progress.messages ?? 0;

  while (messages < mb.backfill_target) {
    const list = await api.listThreads({ q: config().BACKFILL_QUERY, pageToken, maxResults: 50 });
    const ids = (list.threads ?? []).map((t) => t.id);
    const results = await mapLimit(ids, 4, async (id) => {
      const g = await api.getThread(id);
      return (await ingestThread(sql, settings, mb.id, g))?.messageCount ?? 0;
    });
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) throw failed.error; // retry resumes from the same page; ingest is idempotent
    for (const r of results) if (r.ok) {
      messages += r.value;
      threads += 1;
    }
    pageToken = list.nextPageToken;
    await setStage(sql, mb.id, 'ingesting', { pageToken: pageToken ?? null, threads, messages });
    ctx.log.info({ mailbox: mb.email, threads, messages }, 'backfill: ingested page');
    if (!pageToken) break;
  }
  await setStage(sql, mb.id, 'triaging', { threads, messages });
}

async function triageStage(ctx: Ctx, mb: MailboxRow, job: Job): Promise<void> {
  const { sql } = ctx;
  const settings = await getSettings(sql, true);
  const profile = await getKnowledgeProfile(sql);
  const cfg = config();
  const ai = getProvider();

  const pending = async () =>
    (
      await sql<{ id: string }[]>`
        select m.id from email_message m join email_thread t on t.id = m.thread_id
        where t.mailbox_id = ${mb.id} and m.triaged_at is null and m.direction in ('inbound','outbound')`
    ).map((r) => r.id);

  let ids = await pending();
  if (ids.length >= cfg.AI_BATCH_MIN && ai.supportsBatch) {
    let batchId = job.payload.triageBatchId as string | undefined;
    if (!batchId) {
      const msgs = await loadMessages(sql, ids);
      batchId = await ai.batchCreate(msgs.map((m) => ({ customId: m.id, opts: triageCall(settings, profile, m) })));
      job.payload.triageBatchId = batchId;
      await savePayload(sql, job.id, job.payload);
      ctx.log.info({ batchId, requests: msgs.length }, 'backfill: triage batch submitted');
    }
    for (;;) {
      const st = await ai.batchStatus(batchId);
      await setStage(sql, mb.id, 'triaging', { triageBatch: { id: batchId, ...st } });
      if (st.ended) break;
      await sleep(30_000);
    }
    const direction = new Map(
      (await sql<{ id: string; direction: 'inbound' | 'outbound' | 'internal'; thread_id: string }[]>`
        select id, direction, thread_id from email_message where id = any(${ids}::uuid[])`).map((r) => [r.id, r]),
    );
    for await (const item of ai.batchResults(batchId)) {
      const m = direction.get(item.customId);
      if (!m) continue;
      const model = item.usage?.model ?? settings.ai_models.triage;
      if (item.ok && item.text) {
        try {
          const data = parseStructured(item.text, TriageSchema, item.usage);
          await applyTriage(sql, m, data);
          await recordAiRun(sql, { purpose: 'triage', model, threadId: m.thread_id, batchId, usage: item.usage, ok: true });
          continue;
        } catch (e) {
          await recordAiRun(sql, { purpose: 'triage', model, threadId: m.thread_id, batchId, usage: item.usage, ok: false, error: errorMessage(e) });
        }
      }
      // Leave failures untriaged; the direct pass below picks them up.
    }
    ids = await pending();
  }
  if (ids.length) await triageMessages(ctx, settings, profile, ids);

  const threads = await sql<{ id: string }[]>`select id from email_thread where mailbox_id = ${mb.id}`;
  for (const t of threads) {
    await updateThreadCategory(sql, t.id);
    await resolveThreadCompany(sql, settings, t.id);
  }
  await setStage(sql, mb.id, 'discovery');
}

async function discoveryStage(ctx: Ctx, mb: MailboxRow): Promise<void> {
  const { sql } = ctx;
  const settings = await getSettings(sql, true);
  await runDiscovery(ctx, settings, mb.id);

  const threads = await sql<{ id: string }[]>`select id from email_thread where mailbox_id = ${mb.id}`;
  for (const t of threads) {
    await resolveThreadCompany(sql, settings, t.id);
    await recomputeReply(sql, settings, t.id);
  }
  // Live sync starts now (reply tracking works before extraction); summaries wait for review.
  await sql`
    update mailbox set status = 'active', backfill_stage = 'awaiting_review',
           backfill_progress = backfill_progress || ${sql.json({ discoveredAt: new Date().toISOString() } as never)}
    where id = ${mb.id}`;
  ctx.log.info({ mailbox: mb.email }, 'backfill: ready for review');
}
