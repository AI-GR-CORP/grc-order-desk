import type { Ctx } from '../context';
import { getSettings } from '../db';
import { recomputeReply } from '../pipeline/reply';
import { mapLimit } from '../util';

/**
 * After GRC's list changes: recompute which emails are GRC's (one statement), then every
 * conversation's last customer / last GRC email and reply state with the app's own rule.
 * Idempotent: an interrupted run is simply run again.
 */
export async function runRefreshDirections(ctx: Ctx, mailboxId: string): Promise<void> {
  const { sql } = ctx;
  const settings = await getSettings(sql, true);
  const moved = await sql<{ thread_id: string }[]>`select thread_id from refresh_message_directions(${mailboxId}::uuid)`;
  const threads = await sql<{ id: string }[]>`select id from email_thread where mailbox_id = ${mailboxId}`;
  await mapLimit(threads, 8, async (t) => recomputeReply(sql, settings, t.id));
  await sql`update mailbox set backfill_progress = backfill_progress || ${sql.json({ directions: { conversationsMoved: moved.length, conversationsChecked: threads.length, finishedAt: new Date().toISOString() } } as never)} where id = ${mailboxId}`;
  ctx.log.info({ conversationsMoved: moved.length, conversationsChecked: threads.length }, 'directions: refreshed');
}
