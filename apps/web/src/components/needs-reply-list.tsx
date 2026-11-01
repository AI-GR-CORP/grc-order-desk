'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { NeedsReplyRow } from '@grc/core';
import { markHandledOffline, snoozeThread } from '@/app/actions/threads';
import { cx, duration, fmtDateTime, gmailLink } from '@/lib/format';
import { buttonClass } from './ui';

/** The home list. Overdue first, with the actions people actually take. */
export function NeedsReplyList({ rows }: { rows: NeedsReplyRow[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (!r.ok) return toast.error(r.error ?? 'Could not update');
    setHidden((h) => new Set(h).add(id));
    toast.success(msg);
  };

  const visible = rows.filter((r) => !hidden.has(r.id));
  const awaiting = visible.filter((r) => r.reply_state === 'awaiting');
  const maybe = visible.filter((r) => r.reply_state === 'possibly_replied');

  return (
    <div>
      <ul className="divide-y divide-line-2">
        {awaiting.map((r) => {
          const overdue = r.reply_due_at ? new Date(r.reply_due_at).getTime() <= now : false;
          return (
            <li key={r.id} className={cx('relative px-4 py-3.5', overdue && 'bg-red-soft/40')}>
              {overdue && <span className="absolute inset-y-0 left-0 w-1 bg-red" aria-hidden />}
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {r.company_id ? (
                      <Link href={`/clients/${r.company_id}`} className="font-semibold hover:underline">{r.company ?? 'Unknown company'}</Link>
                    ) : (
                      <span className="font-semibold">{r.company ?? 'Unknown company'}</span>
                    )}
                    <Link href={`/threads/${r.id}`} className="min-w-0 truncate text-[13.5px] text-ink-2 hover:underline">{r.subject ?? '(no subject)'}</Link>
                  </div>
                  {(r.next_action || r.summary) && <p className="mt-1 max-w-3xl text-[13px] text-muted">{r.next_action ?? r.summary}</p>}
                </div>
                <div className="text-right">
                  <div className={cx('text-[13px] font-semibold', overdue ? 'text-red' : 'text-mustard')}>
                    {overdue ? 'Overdue' : 'Due soon'} · waiting {duration(r.awaiting_reply_since, now)}
                  </div>
                  <div className="text-[12px] text-muted">since {fmtDateTime(r.awaiting_reply_since)}{r.handled_by ? `, ${r.handled_by}` : ''}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <a href={gmailLink(r.mailbox_email, r.gmail_thread_id)} target="_blank" rel="noreferrer" className={buttonClass('primary', 'sm')}>Reply in Gmail</a>
                <button className={buttonClass('secondary', 'sm')} onClick={() => act(r.id, snoozeThread(r.id, 120), 'Snoozed for 2 hours')}>Snooze 2 h</button>
                <button className={buttonClass('ghost', 'sm')} onClick={() => act(r.id, markHandledOffline(r.id, 'Handled on WhatsApp/phone'), 'Marked as handled')}>Handled on WhatsApp/phone</button>
              </div>
            </li>
          );
        })}
      </ul>
      {maybe.length > 0 && (
        <div className="border-t border-line">
          <h3 className="px-4 pb-1 pt-4 text-[13px] font-semibold text-mustard">Possibly answered from another thread</h3>
          <p className="px-4 text-[12.5px] text-muted">GRC emailed this contact separately after their message. Check, then mark handled.</p>
          <ul className="divide-y divide-line-2">
            {maybe.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="font-medium">{r.company ?? 'Unknown company'}</span>{' '}
                  <Link href={`/threads/${r.id}`} className="text-[13px] text-ink-2 hover:underline">{r.subject}</Link>
                </div>
                <button className={buttonClass('ghost', 'sm')} onClick={() => act(r.id, markHandledOffline(r.id, 'Answered in another thread'), 'Marked as handled')}>It’s answered</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
