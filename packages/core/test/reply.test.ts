import { describe, expect, it } from 'vitest';
import { computeReplyState, type ReplyMessage } from '../src/reply';
import { BusinessHoursSchema } from '../src/settings';

const hours = BusinessHoursSchema.parse({ days: [] }); // 24/7 to keep the arithmetic obvious
const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
const msg = (id: string, direction: ReplyMessage['direction'], at: Date, needs_reply: boolean | null = true): ReplyMessage => ({
  id,
  direction,
  sent_at: at,
  needs_reply,
});
const run = (messages: ReplyMessage[], extra: Partial<Parameters<typeof computeReplyState>[0]> = {}) =>
  computeReplyState({ messages, handledOfflineAt: null, slaMinutes: 60, hours, ...extra });

describe('computeReplyState', () => {
  it('awaits the first unanswered customer email', () => {
    const r = run([msg('a', 'outbound', t(9)), msg('b', 'inbound', t(10)), msg('c', 'inbound', t(10, 30))]);
    expect(r.state).toBe('awaiting');
    expect(r.pendingMessageId).toBe('b');
    expect(r.dueAt?.toISOString()).toBe(t(11).toISOString());
  });
  it('is replied once GRC answers', () => {
    expect(run([msg('a', 'inbound', t(10)), msg('b', 'outbound', t(10, 40))]).state).toBe('replied');
  });
  it('ignores customer emails that need no reply', () => {
    expect(run([msg('a', 'outbound', t(9)), msg('b', 'inbound', t(10), false)]).state).toBe('not_needed');
  });
  it('treats untriaged mail as needing a reply', () => {
    expect(run([msg('a', 'inbound', t(10), null)]).state).toBe('awaiting');
  });
  it('skips the "thanks" and waits on the real question', () => {
    const r = run([msg('a', 'outbound', t(9)), msg('b', 'inbound', t(10), false), msg('c', 'inbound', t(11), true)]);
    expect(r.pendingMessageId).toBe('c');
  });
  it('internal notes do not count as a reply', () => {
    expect(run([msg('a', 'inbound', t(10)), msg('b', 'internal', t(10, 20))]).state).toBe('awaiting');
  });
  it('respects "handled on WhatsApp" until a newer email arrives', () => {
    const base = [msg('a', 'inbound', t(10))];
    expect(run(base, { handledOfflineAt: t(10, 30) }).state).toBe('handled_offline');
    const r = run([...base, msg('b', 'inbound', t(12))], { handledOfflineAt: t(10, 30) });
    expect(r.state).toBe('awaiting');
    expect(r.pendingMessageId).toBe('b');
  });
  it('marks possibly replied when GRC wrote from another thread', () => {
    const r = run([msg('a', 'inbound', t(10))], { outboundElsewhereAfterPending: true });
    expect(r.state).toBe('possibly_replied');
    expect(r.dueAt).toBeNull();
  });
  it('threads started by GRC with no answer are not awaiting', () => {
    expect(run([msg('a', 'outbound', t(10))]).state).toBe('replied');
  });
});
