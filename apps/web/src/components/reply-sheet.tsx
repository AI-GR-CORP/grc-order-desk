'use client';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { NeedsReplyRow } from '@grc/core';
import { markHandledOffline, snoozeThread } from '@/app/actions/threads';
import { cx, duration, fmtDateTime, gmailLink } from '@/lib/format';
import { TypeChip } from './sheet';
import { buttonClass } from './ui';

/** Customers waiting on GRC, one header row per client, late ones first. */
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
  for (const r of visible) {
    const k = r.company_id ?? r.company ?? r.id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
      <table className="sheet">
        <thead>
          <tr>
            <th className="primary" style={{ width: 360, minWidth: 360 }}>Inquiry</th>
            <th style={{ width: 124, minWidth: 124 }}>Type</th>
            <th style={{ width: 160, minWidth: 160 }}>{maybe ? 'Their email came' : 'Waiting for'}</th>
            <th style={{ width: 120, minWidth: 120 }}>Person</th>
            <th className="act" style={{ width: 400, minWidth: 400 }}>What to do</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.values()].map((list) => {
            const first = list[0]!;
            return (
              <Fragment key={first.company_id ?? first.id}>
                <tr className="group">
                  <td colSpan={5}>
                    <div className="group-inner">
                      {first.company_id ? (
                        <Link href={`/clients/${first.company_id}`} className="text-[15px] font-semibold text-ink hover:text-indigo">{first.company ?? 'Client'}</Link>
                      ) : (
                        <span className="text-[15px] font-semibold">{first.company ?? 'Client not known'}</span>
                      )}
                      <span className="rounded-full bg-red-soft px-2 py-[1px] text-[12.5px] font-medium text-red">
                        {list.length} {maybe ? 'to check' : 'waiting for reply'}
                      </span>
                    </div>
                  </td>
                </tr>
                {list.map((r) => {
                  const late = r.reply_due_at ? new Date(r.reply_due_at).getTime() <= now : false;
                  return (
                    <tr key={r.id} className={cx('row', !maybe && 'waiting')}>
                      <td className="primary" style={{ maxWidth: 360 }}>
                        <Link href={`/threads/${r.id}`} className="line-clamp-2 font-medium text-ink hover:text-indigo">{r.subject || '(no subject)'}</Link>
                        {(r.next_action || r.summary) && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{r.next_action ?? r.summary}</div>}
                      </td>
                      <td><TypeChip kind={r.category} /></td>
                      <td>
                        {maybe ? (
                          <span className="text-[13.5px] text-muted">{fmtDateTime(r.awaiting_reply_since)}</span>
                        ) : (
                          <>
                            <div className={cx('font-semibold', late ? 'text-red' : 'text-mustard')}>
                              {duration(r.awaiting_reply_since, now)}
                              {late ? ', late' : ''}
                            </div>
                            <div className="text-[13px] text-muted">since {fmtDateTime(r.awaiting_reply_since)}</div>
                          </>
                        )}
                      </td>
                      <td className="text-muted">{r.handled_by ?? ''}</td>
                      <td className="act">
                        <div className="flex flex-wrap gap-1.5">
                          {maybe ? (
                            <button className={buttonClass('secondary', 'sm')} onClick={() => act(r.id, markHandledOffline(r.id, 'Answered in another thread'), 'Marked as answered')}>
                              Yes, it’s answered
                            </button>
                          ) : (
                            <>
                              <a href={gmailLink(r.mailbox_email, r.gmail_thread_id)} target="_blank" rel="noreferrer" className={buttonClass('primary', 'sm')}>Reply in Gmail</a>
                              <button className={buttonClass('secondary', 'sm')} onClick={() => act(r.id, snoozeThread(r.id, 120), 'Snoozed for 2 hours')}>Remind in 2 h</button>
                              <button className={buttonClass('secondary', 'sm')} onClick={() => act(r.id, markHandledOffline(r.id, 'Handled on WhatsApp/phone'), 'Marked as done on phone')}>Done on phone</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
