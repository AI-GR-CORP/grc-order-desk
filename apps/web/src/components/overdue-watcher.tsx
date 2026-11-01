'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { NeedsReplyRow } from '@grc/core';
import { markHandledOffline, snoozeThread } from '@/app/actions/threads';
import { duration, gmailLink } from '@/lib/format';
import { browserSupabase } from '@/lib/supabase/browser';
import { buttonClass } from './ui';

const SEEN_KEY = 'grc.overdue.lastAlert';

/**
 * The 1-hour pop-up. Watches threads that owe a reply (live via Supabase Realtime, plus a
 * one-minute clock because "due" is time-based) and opens one grouped alert, repeating every
 * `realertMinutes` while anything stays overdue. Also sends a desktop notification if allowed.
 */
export function OverdueWatcher({ realertMinutes }: { realertMinutes: number }) {
  const [rows, setRows] = useState<NeedsReplyRow[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await browserSupabase()
      .from('v_needs_reply')
      .select('*')
      .eq('reply_state', 'awaiting')
      .order('reply_due_at', { ascending: true })
      .limit(100);
    setRows((data ?? []) as NeedsReplyRow[]);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    void load();
    const tick = setInterval(() => void load(), 60_000);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const channel = browserSupabase()
      .channel('thread-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_thread' }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void load(), 1500);
      })
      .subscribe();
    return () => {
      clearInterval(tick);
      clearTimeout(debounce);
      void browserSupabase().removeChannel(channel);
    };
  }, [load]);

  const overdue = rows.filter((r) => r.reply_due_at && new Date(r.reply_due_at).getTime() <= now);

  useEffect(() => {
    if (overdue.length === 0) return;
    const last = Number(sessionStorage.getItem(SEEN_KEY) ?? 0);
    const seenIds = new Set((sessionStorage.getItem(SEEN_KEY + '.ids') ?? '').split(','));
    const hasNew = overdue.some((r) => !seenIds.has(r.id));
    if (!hasNew && now - last < realertMinutes * 60_000) return;
    sessionStorage.setItem(SEEN_KEY, String(now));
    sessionStorage.setItem(SEEN_KEY + '.ids', overdue.map((r) => r.id).join(','));
    setOpen(true);
    if (permission === 'granted' && document.hidden) {
      const first = overdue[0]!;
      new Notification(`${overdue.length} customer ${overdue.length === 1 ? 'email needs' : 'emails need'} a reply`, {
        body: `${first.company ?? 'Unknown company'}: ${first.subject ?? '(no subject)'}`,
        tag: 'grc-overdue',
      });
    }
  }, [overdue, now, permission, realertMinutes]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function act(p: Promise<{ ok: boolean; error?: string }>, done: string) {
    const r = await p;
    if (!r.ok) toast.error(r.error ?? 'Could not update');
    else {
      toast.success(done);
      void load();
    }
  }

  if (!open || overdue.length === 0) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="overdue-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-surface shadow-xl outline-none"
      >
        <div className="border-b border-line-2 bg-red px-5 py-4 text-white">
          <h2 id="overdue-title" className="text-[17px] font-semibold">
            {overdue.length} {overdue.length === 1 ? 'customer is' : 'customers are'} waiting for a reply
          </h2>
          <p className="mt-0.5 text-[13px] text-white/85">No one from GRC has answered within the reply time.</p>
        </div>
        <ul className="max-h-[55dvh] divide-y divide-line-2 overflow-y-auto">
          {overdue.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{r.company ?? 'Unknown company'}</div>
                  <div className="truncate text-[13px] text-muted">{r.subject ?? '(no subject)'}</div>
                </div>
                <span className="text-[12.5px] font-medium text-red">waiting {duration(r.awaiting_reply_since, now)}</span>
              </div>
              {r.next_action && <p className="mt-1 text-[13px]">{r.next_action}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Link href={`/threads/${r.id}`} className={buttonClass('secondary', 'sm')} onClick={() => setOpen(false)}>Open thread</Link>
                <a href={gmailLink(r.mailbox_email, r.gmail_thread_id)} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>Reply in Gmail</a>
                <button className={buttonClass('ghost', 'sm')} onClick={() => act(snoozeThread(r.id, 30), 'Snoozed for 30 minutes')}>Snooze 30 min</button>
                <button className={buttonClass('ghost', 'sm')} onClick={() => act(markHandledOffline(r.id, 'Handled on WhatsApp/phone'), 'Marked as handled')}>Handled on WhatsApp/phone</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-5 py-3">
          {permission === 'default' ? (
            <button
              className={buttonClass('ghost', 'sm')}
              onClick={async () => setPermission(await Notification.requestPermission())}
            >
              Also alert me when this tab is in the background
            </button>
          ) : (
            <span />
          )}
          <button className={buttonClass('primary', 'sm')} onClick={() => setOpen(false)}>
            Remind me in {realertMinutes} min
          </button>
        </div>
      </div>
    </div>
  );
}
