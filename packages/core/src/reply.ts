import { addBusinessMinutes } from './business-hours';
import type { ReplyState } from './constants';
import type { BusinessHours } from './settings';

export interface ReplyMessage {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  sent_at: Date;
  /** From triage. null = not triaged yet, treated as "needs a reply" so nothing slips through. */
  needs_reply: boolean | null;
}

export interface ReplyInput {
  messages: readonly ReplyMessage[];
  /** Set when someone pressed "Handled on WhatsApp/phone". */
  handledOfflineAt: Date | null;
  /** True if GRC emailed the same contact from another thread after the pending email. */
  outboundElsewhereAfterPending?: boolean;
  slaMinutes: number;
  hours: BusinessHours;
}

export interface ReplyComputation {
  state: ReplyState;
  /** The first customer email we still owe a reply to. */
  pendingMessageId: string | null;
  awaitingSince: Date | null;
  /** When the pop-up should fire. Only set for state = awaiting. */
  dueAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}

/**
 * Decides whether GRC owes the customer a reply in this thread.
 *
 * The clock starts at the EARLIEST customer email after our last outbound email that needs a
 * reply: if a customer writes at 10:00 and again at 10:30, we have owed them since 10:00.
 */
export function computeReplyState(input: ReplyInput): ReplyComputation {
  const msgs = [...input.messages].sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime());
  let lastInboundAt: Date | null = null;
  let lastOutboundAt: Date | null = null;
  for (const m of msgs) {
    if (m.direction === 'inbound') lastInboundAt = m.sent_at;
    if (m.direction === 'outbound') lastOutboundAt = m.sent_at;
  }

  const base = { lastInboundAt, lastOutboundAt };
  if (!lastInboundAt) {
    return { ...base, state: lastOutboundAt ? 'replied' : 'not_needed', pendingMessageId: null, awaitingSince: null, dueAt: null };
  }

  const afterOurLast = msgs.filter(
    (m) => m.direction === 'inbound' && (!lastOutboundAt || m.sent_at.getTime() > lastOutboundAt.getTime()),
  );
  const pending = afterOurLast.find((m) => m.needs_reply !== false) ?? null;

  if (!pending) {
    const state: ReplyState = afterOurLast.length === 0 ? 'replied' : 'not_needed';
    return { ...base, state, pendingMessageId: null, awaitingSince: null, dueAt: null };
  }

  if (input.handledOfflineAt && pending.sent_at.getTime() <= input.handledOfflineAt.getTime()) {
    // Only the emails that arrived after someone marked it handled count again.
    const newer = afterOurLast.find(
      (m) => m.needs_reply !== false && m.sent_at.getTime() > input.handledOfflineAt!.getTime(),
    );
    if (!newer) {
      return { ...base, state: 'handled_offline', pendingMessageId: null, awaitingSince: null, dueAt: null };
    }
    return awaiting(newer, input, base);
  }

  if (input.outboundElsewhereAfterPending) {
    return { ...base, state: 'possibly_replied', pendingMessageId: pending.id, awaitingSince: pending.sent_at, dueAt: null };
  }

  return awaiting(pending, input, base);
}

function awaiting(
  pending: ReplyMessage,
  input: ReplyInput,
  base: Pick<ReplyComputation, 'lastInboundAt' | 'lastOutboundAt'>,
): ReplyComputation {
  return {
    ...base,
    state: 'awaiting',
    pendingMessageId: pending.id,
    awaitingSince: pending.sent_at,
    dueAt: addBusinessMinutes(pending.sent_at, input.slaMinutes, input.hours),
  };
}
