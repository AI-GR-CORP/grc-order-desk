import { messageDirection } from '@grc/core/mail';
import type { Ctx } from '../context';
import { getSettings } from '../db';
import { recomputeReply } from '../pipeline/reply';

/**
 * After GRC staff addresses are added to GRC's list: recompute which emails are GRC's, each
 * affected conversation's last customer / last GRC email, and its reply state.
 */
export async function runRefreshDirections(ctx: Ctx, mailboxId: string): Promise<void> {
  const { sql } = ctx;
  const settings = await getSettings(sql, true);
  const msgs = await sql<{ id: string; thread_id: string; from_email: string; to_emails: string[]; cc_emails: string[]; direction: string }[]>`
    select m.id, m.thread_id, m.from_email, m.to_emails, m.cc_emails, m.direction
    from email_message m join email_thread t on t.id = m.thread_id
    where t.mailbox_id = ${mailboxId}`;
  const threads = new Set<string>();
  let changed = 0;
  for (const m of msgs) {
    const d = messageDirection(m.from_email, [...(m.to_emails ?? []), ...(m.cc_emails ?? [])], settings.internal_domains);
    if (d === m.direction) continue;
    await sql`update email_message set direction = ${d} where id = ${m.id}`;
    threads.add(m.thread_id);
    changed++;
  }
  for (const t of threads) {
    await sql`
      update email_thread set
        last_inbound_at  = (select max(sent_at) from email_message where thread_id = ${t} and direction = 'inbound'),
        last_outbound_at = (select max(sent_at) from email_message where thread_id = ${t} and direction = 'outbound')
      where id = ${t}`;
    await recomputeReply(sql, settings, t);
  }
  await sql`update mailbox set backfill_progress = backfill_progress || ${sql.json({ directions: { messages: changed, conversations: threads.size, finishedAt: new Date().toISOString() } } as never)} where id = ${mailboxId}`;
  ctx.log.info({ messages: changed, conversations: threads.size }, 'directions: refreshed');
}
