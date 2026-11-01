import { computeReplyState, type AppSettings } from '@grc/core';
import type { Db } from '../db';

/** Recomputes reply_state / reply_due_at for one thread. Cheap; run after every change. */
export async function recomputeReply(sql: Db, settings: AppSettings, threadId: string): Promise<void> {
  const [t] = await sql<{ handled_offline_at: Date | null }[]>`
    select handled_offline_at from email_thread where id = ${threadId}`;
  if (!t) return;
  const msgs = await sql<{ id: string; direction: 'inbound' | 'outbound' | 'internal'; sent_at: Date; needs_reply: boolean | null; from_email: string }[]>`
    select id, direction, sent_at, needs_reply, from_email from email_message where thread_id = ${threadId}`;

  const input = {
    messages: msgs,
    handledOfflineAt: t.handled_offline_at,
    slaMinutes: settings.reply_sla_minutes,
    hours: settings.business_hours,
  };
  let r = computeReplyState(input);

  if (r.state === 'awaiting' && r.pendingMessageId && r.awaitingSince) {
    const sender = msgs.find((m) => m.id === r.pendingMessageId)?.from_email;
    if (sender) {
      const [hit] = await sql<{ found: boolean }[]>`
        select exists (
          select 1 from email_message
          where direction = 'outbound' and thread_id <> ${threadId} and sent_at > ${r.awaitingSince}
            and (${sender} = any(to_emails) or ${sender} = any(cc_emails))
        ) as found`;
      if (hit?.found) r = computeReplyState({ ...input, outboundElsewhereAfterPending: true });
    }
  }

  await sql`
    update email_thread set
      reply_state          = ${r.state},
      awaiting_reply_since = ${r.awaitingSince},
      reply_due_at         = ${r.dueAt},
      last_inbound_at      = ${r.lastInboundAt},
      last_outbound_at     = ${r.lastOutboundAt}
    where id = ${threadId}`;
}
