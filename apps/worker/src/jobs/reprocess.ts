import type { Ctx } from '../context';
import { getKnowledgeProfile, getSettings } from '../db';
import { NonRetryableError } from '../errors';
import { gmailFor, loadMailbox } from '../gmail-session';
import { processThread } from '../pipeline/process-thread';

/** Re-fetches one thread and re-runs the AI ("Re-run AI" button, or a retry after a failed sync). */
export async function runReprocess(ctx: Ctx, payload: Record<string, unknown>): Promise<void> {
  const { sql } = ctx;
  let gmailThreadId = payload.gmailThreadId as string | undefined;
  let mailboxId = payload.mailboxId as string | undefined;
  if (payload.threadId) {
    const [t] = await sql<{ gmail_thread_id: string; mailbox_id: string }[]>`
      select gmail_thread_id, mailbox_id from email_thread where id = ${payload.threadId as string}`;
    if (t) {
      gmailThreadId = t.gmail_thread_id;
      mailboxId = t.mailbox_id;
    }
  }
  if (!gmailThreadId || !mailboxId) throw new NonRetryableError('reprocess: thread not found');
  const mb = await loadMailbox(sql, mailboxId);
  const settings = await getSettings(sql);
  const profile = await getKnowledgeProfile(sql);
  await processThread(ctx, gmailFor(sql, mb), mb, settings, profile, gmailThreadId, {
    extract: true,
    forceExtract: payload.force !== false,
  });
}
