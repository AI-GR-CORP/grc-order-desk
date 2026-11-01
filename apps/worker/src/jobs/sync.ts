import { GmailApiError, isSkippableMessage } from '@grc/core/gmail';
import { config } from '../config';
import type { Ctx } from '../context';
import { getKnowledgeProfile, getSettings } from '../db';
import { errorMessage } from '../errors';
import { gmailFor, loadMailbox } from '../gmail-session';
import { processThread } from '../pipeline/process-thread';
import { enqueue } from '../queue';
import { mapLimit } from '../util';

/** The 5-minute job: asks Gmail only for what changed since the last checkpoint. */
export async function runSync(ctx: Ctx, mailboxId: string): Promise<void> {
  const { sql } = ctx;
  const mb = await loadMailbox(sql, mailboxId);
  if (mb.status !== 'active' || !mb.history_id) return;

  const settings = await getSettings(sql);
  const profile = await getKnowledgeProfile(sql);
  const api = gmailFor(sql, mb);
  // Extraction runs once the learning pass is done; process-thread only reads approved clients.
  const extract = ['awaiting_review', 'extracting', 'done'].includes(mb.backfill_stage);

  const threadIds = new Set<string>();
  let latest = mb.history_id;
  try {
    let pageToken: string | undefined;
    do {
      const h = await api.listHistory({ startHistoryId: mb.history_id, pageToken });
      for (const rec of h.history ?? []) {
        for (const added of rec.messagesAdded ?? []) {
          if (!isSkippableMessage(added.message.labelIds ?? [])) threadIds.add(added.message.threadId);
        }
      }
      latest = h.historyId ?? latest;
      pageToken = h.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (!(e instanceof GmailApiError && e.status === 404)) throw e;
    // Checkpoint too old (worker was down for days): re-read the last week instead.
    ctx.log.warn({ mailbox: mb.email }, 'history checkpoint expired; resyncing last 7 days');
    latest = (await api.getProfile()).historyId;
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const list = await api.listThreads({ q: `newer_than:7d ${config().BACKFILL_QUERY}`, pageToken, maxResults: 100 });
      for (const t of list.threads ?? []) threadIds.add(t.id);
      pageToken = list.nextPageToken;
      if (!pageToken) break;
    }
  }

  const ids = [...threadIds];
  const results = await mapLimit(ids, 3, (id) => processThread(ctx, api, mb, settings, profile, id, { extract }));
  let failed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.ok) continue;
    failed++;
    ctx.log.warn({ gmailThreadId: ids[i], err: errorMessage(r.error) }, 'sync: thread failed, queued for retry');
    const [t] = await sql<{ id: string }[]>`select id from email_thread where mailbox_id = ${mb.id} and gmail_thread_id = ${ids[i]!}`;
    await enqueue(sql, {
      kind: 'reprocess_thread',
      mailboxId: mb.id,
      payload: { gmailThreadId: ids[i], threadId: t?.id ?? null, force: false },
      dedupeKey: `reprocess:${ids[i]}`,
      runAfter: new Date(Date.now() + 2 * 60_000),
    });
  }

  await sql`update mailbox set history_id = ${latest}, last_synced_at = now(), last_error = null where id = ${mb.id}`;
  if (ids.length) ctx.log.info({ mailbox: mb.email, threads: ids.length, failed }, 'sync done');
}
