'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { markAllRead } from '@/app/actions/inbox';
import { setThreadCategory, setThreadType } from '@/app/actions/threads';
import type { ActionResult } from '@/app/actions/result';
import { cx, duration } from '@/lib/format';
import { GridBar, SearchBox, ToggleChip } from './sheet';
import { TypeBadges } from './type-cell';
import { Button } from './ui';

export interface InboxRow {
  thread_id: string;
  subject: string | null;
  category: string;
  topics: string[];
  type_needs_check: boolean;
  type_checked_at: string | null;
  company_id: string | null;
  company_name: string | null;
  company_approval: string | null;
  reply_state: string | null;
  reply_due_at: string | null;
  last_inbound_at: string;
  first_message_at: string | null;
  last_from: string;
  last_from_email: string;
  preview: string;
  last_triage_category: string | null;
  last_triage_reason: string | null;
  started_by_customer: boolean;
  is_reply: boolean;
  email_count: number;
  attachment_count: number;
  unread: boolean;
  bucket: 'customer' | 'filtered' | 'dismissed';
  is_noise: boolean;
}

/** "10:42" today, "Mon 10:42" this week, "3 Nov" before that. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (day(d) === day(now)) return time;
  if (now.getTime() - d.getTime() < 6 * 864e5) return `${d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })} ${time}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function Status({ r }: { r: InboxRow }) {
  if (r.reply_state === 'awaiting') {
    const late = r.reply_due_at && new Date(r.reply_due_at).getTime() < Date.now();
    return <span className={cx('text-[13px] font-medium', late ? 'text-red' : 'text-mustard')}>{late ? 'Reply late' : 'Reply needed'}<span className="block text-[12px] font-normal text-muted">waiting {duration(r.last_inbound_at)}</span></span>;
  }
  if (r.reply_state === 'replied') return <span className="text-[13px] text-green">Replied</span>;
  if (r.reply_state === 'handled_offline') return <span className="text-[13px] text-muted">Handled outside email</span>;
  if (r.reply_state === 'possibly_replied') return <span className="text-[13px] text-muted">Maybe answered</span>;
  return <span className="text-[13px] text-faint">No reply needed</span>;
}

export function InboxList({ rows, tabs, filtered, empty }: { rows: InboxRow[]; tabs: React.ReactNode; filtered: boolean; empty: React.ReactNode }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  const [busy, start] = useTransition();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyUnread && !r.unread) return false;
      if (filtered && !showNoise && r.is_noise) return false;
      if (!s) return true;
      return [r.company_name, r.subject, r.last_from, r.last_from_email, r.preview].some((v) => v?.toLowerCase().includes(s));
    });
  }, [rows, q, onlyUnread, showNoise, filtered]);
  const unread = rows.filter((r) => r.unread).length;
  const noise = rows.filter((r) => r.is_noise).length;

  const act = (fn: () => Promise<ActionResult<unknown>>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });

  return (
    <>
      <GridBar tabs={tabs}>
        {!filtered && (
          <ToggleChip on={onlyUnread} onChange={setOnlyUnread}>
            Unread
            <span className={cx('rounded-full px-1.5 text-[12px] font-semibold tabular-nums', onlyUnread ? 'bg-indigo text-white' : 'bg-indigo-soft text-indigo')}>{unread}</span>
          </ToggleChip>
        )}
        {filtered && noise > 0 && (
          <ToggleChip on={showNoise} onChange={setShowNoise}>
            Newsletters and couriers
            <span className="rounded-full bg-slate-soft px-1.5 text-[12px] font-semibold tabular-nums text-muted">{noise}</span>
          </ToggleChip>
        )}
        {!filtered && unread > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(markAllRead, 'All marked as read')}>
            Mark all read
          </Button>
        )}
        <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search client, sender, subject or text" />
      </GridBar>

      {shown.length === 0 ? (
        <div className="flex-1">{empty}</div>
      ) : (
        <div className={cx('sheet-wrap', busy && 'opacity-70')}>
          <table className="sheet inbox-table">
            <thead>
              <tr>
                <th className="w-8" aria-label="Unread" />
                <th className="w-[200px]">Client</th>
                <th>Conversation</th>
                <th className="w-[170px]">{filtered ? 'Why it was set aside' : 'Type'}</th>
                <th className={filtered ? 'w-[190px]' : 'w-[150px]'}>{filtered ? 'Is this customer mail?' : 'Status'}</th>
                <th className="w-[92px] text-right">Received</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const open = () => router.push(`/threads/${r.thread_id}`);
                return (
                  <tr key={r.thread_id} className={cx('cursor-pointer', r.unread && 'is-unread')} onClick={open}>
                    <td className="text-center align-middle">
                      {r.unread && <span className="inline-block size-2.5 rounded-full bg-indigo" aria-label="Unread" />}
                    </td>
                    <td>
                      <span className={cx('block text-[14px]', r.unread ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>{r.company_name ?? r.last_from}</span>
                      {r.company_approval === 'pending' && <span className="mt-0.5 inline-block rounded-full bg-mustard-soft px-2 py-[1px] text-[11.5px] font-medium text-mustard">New client</span>}
                      {!r.company_name && <span className="block truncate text-[12px] text-muted">{r.last_from_email}</span>}
                    </td>
                    <td>
                      <Link
                        href={`/threads/${r.thread_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className={cx('block text-[14px] leading-snug hover:underline', r.unread ? 'font-semibold text-ink' : 'text-ink-2')}
                      >
                        {r.subject || '(no subject)'}
                        {r.email_count > 1 && <span className="ml-1.5 text-[12px] font-normal text-muted">{r.email_count}</span>}
                        {r.attachment_count > 0 && (
                          <span className="ml-1.5 inline-flex translate-y-[2px] text-muted" title={`${r.attachment_count} attachment${r.attachment_count > 1 ? 's' : ''}`}>
                            <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                            </svg>
                          </span>
                        )}
                      </Link>
                      <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
                        <span className="font-medium text-ink-2">{r.last_from}:</span> {r.preview || '(no text)'}
                      </span>
                      <span className={cx('mt-1 flex flex-wrap gap-1', filtered && 'hidden')}>
                        {r.is_reply ? (
                          <span className="rounded-md bg-slate-soft px-1.5 py-[1px] text-[11.5px] font-medium text-ink-2">Reply on ongoing</span>
                        ) : (
                          r.started_by_customer &&
                          r.first_message_at &&
                          Date.now() - new Date(r.first_message_at).getTime() < 14 * 864e5 && (
                            <span className="rounded-md bg-indigo-soft px-1.5 py-[1px] text-[11.5px] font-medium text-indigo">New enquiry</span>
                          )
                        )}
                      </span>
                    </td>
                    <td onClick={(e) => filtered && e.stopPropagation()}>
                      {filtered ? (
                        <span className="text-[13px] leading-snug text-muted">{r.last_triage_reason ?? 'Not recognised as a customer'}</span>
                      ) : r.category === 'development' || r.category === 'bulk' || r.category === 'mixed' ? (
                        <TypeBadges info={{ kind: r.category, topics: r.topics, needsCheck: r.type_needs_check, checked: Boolean(r.type_checked_at) }} />
                      ) : (
                        <span className="text-[13px] text-faint">Not an order</span>
                      )}
                    </td>
                    <td onClick={(e) => filtered && e.stopPropagation()}>
                      {filtered ? (
                        <span className="flex flex-col items-start gap-1">
                          <button className="text-left text-[13px] font-medium text-indigo hover:underline" disabled={busy} onClick={() => act(() => setThreadType(r.thread_id, 'development', []), 'Tracked as Development. The AI will remember this.')}>
                            Track as Development
                          </button>
                          <button className="text-left text-[13px] font-medium text-teal hover:underline" disabled={busy} onClick={() => act(() => setThreadType(r.thread_id, 'bulk', []), 'Tracked as Bulk. The AI will remember this.')}>
                            Track as Bulk
                          </button>
                          <button className="text-left text-[13px] text-muted hover:underline" disabled={busy} onClick={() => act(() => setThreadCategory(r.thread_id, 'other'), 'Marked as not customer mail')}>
                            Not customer mail
                          </button>
                        </span>
                      ) : (
                        <Status r={r} />
                      )}
                    </td>
                    <td className={cx('whitespace-nowrap text-right text-[13px] tabular-nums', r.unread ? 'font-semibold text-ink' : 'text-muted')}>{when(r.last_inbound_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
