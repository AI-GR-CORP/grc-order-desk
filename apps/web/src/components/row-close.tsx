'use client';
import Link from 'next/link';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { setRowsClosed, skipThreads, type CloseTarget } from '@/app/actions/threads';
import { gmailLink } from '@/lib/format';
import type { SheetRow } from '@/lib/sheet';
import { shortDate } from './sheet';
import { Button } from './ui';

/** What closing a row covers: a subject closes all its conversations; a product row closes that product. */
function targetOf(r: SheetRow): CloseTarget {
  if (r.members) return { threads: r.members.map((m) => m.thread_id).filter(Boolean) as string[] };
  if (r.source === 'item' && r.item_id) return { devItems: [r.item_id] };
  if (r.source === 'bulk' && r.item_id) return { bulkOrders: [r.item_id] };
  return { threads: r.thread_id ? [r.thread_id] : [] };
}

/** Close / reopen, and skip (not order work), for a row in the details panel. */
export function RowCloseActions({ row, onDone }: { row: SheetRow; onDone: () => void }) {
  const [busy, start] = useTransition();
  const closed = Boolean(row.closed_at);
  const threads = (row.members ?? [row]).filter((m) => m.source === 'thread').map((m) => m.thread_id).filter(Boolean) as string[];
  const what = row.members ? 'subject' : row.source === 'thread' ? 'subject' : 'enquiry';
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? 'Something went wrong');
      toast.success(ok);
      onDone();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setRowsClosed(targetOf(row), !closed), closed ? 'Reopened' : `Closed. A new email from the customer reopens it.`)}>
        {closed ? `Reopen ${what}` : `Close ${what}`}
      </Button>
      {threads.length > 0 && !closed && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => skipThreads(threads), 'Skipped. The AI will remember this.')}>
          Skip: not order work
        </Button>
      )}
    </div>
  );
}

/** A subject's conversations, each with its pointers, the latest from each side, and its own Close. */
export function SubjectEnquiryList({ members, onDone }: { members: SheetRow[]; onDone: () => void }) {
  const [busy, start] = useTransition();
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold text-muted">In this subject ({members.length})</h3>
      <ol className="space-y-3">
        {members.map((m, i) => (
          <li key={m.row_id} className="rounded-lg border border-line px-3.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">
                  {i + 1}. {m.is_meeting ? 'Meeting: ' : ''}
                  {m.thread_subject || '(no subject)'}
                </p>
                <p className="text-[12.5px] text-muted">
                  {[m.enquiry_ref, `${m.email_count} ${m.email_count === 1 ? 'email' : 'emails'}`, `last ${shortDate(m.last_at)}`].filter(Boolean).join(' · ')}
                  {m.closed_at ? ' · Closed' : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !m.thread_id}
                onClick={() =>
                  start(async () => {
                    const r = await setRowsClosed({ threads: [m.thread_id!] }, !m.closed_at);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(m.closed_at ? 'Reopened' : 'Closed');
                    onDone();
                  })
                }
              >
                {m.closed_at ? 'Reopen' : 'Close'}
              </Button>
            </div>
            {m.points?.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[13px] leading-snug text-ink-2">
                {m.points.slice(0, 5).map((p, j) => (
                  <li key={j} className="flex gap-1.5">
                    <span aria-hidden className="text-faint">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
              <dt className="text-muted">Customer</dt>
              <dd className="text-ink-2">{m.customer_status ?? '—'}</dd>
              <dt className="text-muted">GRC</dt>
              <dd className="text-ink-2">{m.grc_status ?? (m.reply_state === 'awaiting' ? 'No reply yet' : '—')}</dd>
            </dl>
            <div className="mt-2 flex gap-3 text-[13px] font-medium">
              {m.gmail_thread_id && (
                <a className="text-indigo hover:underline" href={gmailLink(m.mailbox_email, m.gmail_thread_id)} target="_blank" rel="noreferrer">
                  Open in Gmail
                </a>
              )}
              {m.thread_id && (
                <Link className="text-indigo hover:underline" href={`/threads/${m.thread_id}`}>
                  Read the emails
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
