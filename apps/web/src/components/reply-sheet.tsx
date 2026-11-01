'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { NeedsReplyRow } from '@grc/core';
import { markHandledOffline, snoozeThread } from '@/app/actions/threads';
import { cx, duration, fmtDateTime, gmailLink } from '@/lib/format';
import { COMPANY_LABEL } from '@/lib/sheet';
import { TypeChip } from './sheet';
import { buttonClass } from './ui';

/** Customers waiting on GRC, grouped under the client like the sheet. Late ones first. */
export function ReplySheet({ rows, maybe }: { rows: NeedsReplyRow[]; maybe: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (!r.ok) return toast.error(r.error ?? 'Could not save');
    setHidden((h) => new Set(h).add(id));
    toast.success(msg);
  };

  const visible = rows.filter((r) => !hidden.has(r.id));
  const groups = new Map<string, NeedsReplyRow[]>();
  for (const r of visible) groups.set(r.company_id ?? r.company ?? r.id, [...(groups.get(r.company_id ?? r.company ?? r.id) ?? []), r]);
  let rowNo = 0;

  return (
    <div className="sheet-wrap min-h-0 flex-1">
      <table className="sheet">
        <thead>
          <tr>
            <th className="rn" aria-label="Row" />
            <th className="co">{COMPANY_LABEL}</th>
            <th style={{ width: 270, minWidth: 270, maxWidth: 310 }}>Inquiry</th>
            <th style={{ width: 100, minWidth: 100 }}>Type</th>
            <th style={{ width: 130, minWidth: 130 }}>{maybe ? 'Their email came' : 'Waiting for'}</th>
            <th style={{ width: 90, minWidth: 90 }}>Person</th>
            <th style={{ width: 350, minWidth: 350 }}>What to do</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.values()].map((list) =>
            list.map((r, i) => {
              rowNo++;
              const late = r.reply_due_at ? new Date(r.reply_due_at).getTime() <= now : false;
              return (
                <tr key={r.id}>
                  <td className={cx('rn', !maybe && 'alert')}>{rowNo}</td>
                  {i === 0 && (
                    <td className="co" rowSpan={list.length}>
                      {r.company_id ? <Link href={`/clients/${r.company_id}`}>{r.company ?? 'Client'}</Link> : r.company ?? 'Client not known'}
                    </td>
                  )}
                  <td style={{ maxWidth: 310 }}>
                    <Link href={`/threads/${r.id}`} className="font-bold hover:underline">{r.subject || '(no subject)'}</Link>
                    {(r.next_action || r.summary) && <div className="mt-0.5 line-clamp-3 text-[12.5px] text-ink-2">{r.next_action ?? r.summary}</div>}
                  </td>
                  <td className="center"><TypeChip kind={r.category} /></td>
                  <td>
                    {maybe ? (
                      <span className="text-[12.5px]">{fmtDateTime(r.awaiting_reply_since)}</span>
                    ) : (
                      <>
                        <div className={cx('font-bold', late ? 'text-red' : 'text-mustard')}>{duration(r.awaiting_reply_since, now)}{late ? ', late' : ''}</div>
                        <div className="text-[12px] text-muted">since {fmtDateTime(r.awaiting_reply_since)}</div>
                      </>
                    )}
                  </td>
                  <td>{r.handled_by ?? ''}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {maybe ? (
                        <button className={buttonClass('secondary', 'sm')} onClick={() => act(r.id, markHandledOffline(r.id, 'Answered in another thread'), 'Marked as answered')}>
                          Yes, it’s answered
                        </button>
                      ) : (
                        <>
                          <a href={gmailLink(r.mailbox_email, r.gmail_thread_id)} target="_blank" rel="noreferrer" className={buttonClass('primary', 'sm')}>Reply in Gmail</a>
                          <button className={buttonClass('secondary', 'sm')} onClick={() => act(r.id, snoozeThread(r.id, 120), 'Snoozed for 2 hours')}>Remind in 2 h</button>
                          <button className={buttonClass('ghost', 'sm')} onClick={() => act(r.id, markHandledOffline(r.id, 'Handled on WhatsApp/phone'), 'Marked as done on phone')}>Done on phone</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}
