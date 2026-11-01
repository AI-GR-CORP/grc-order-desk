'use client';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ThreadBriefRow } from '@grc/core';
import { addThreadsToClient, approveAsNewClient, ignoreThreads } from '@/app/actions/approvals';
import type { ActionResult } from '@/app/actions/result';
import Link from 'next/link';
import { cx } from '@/lib/format';
import { EmailLinks, GridCard, ReplyCell, shortDate, TypeChip } from './sheet';
import { Button, inputClass } from './ui';

export interface UnmatchedGroup {
  key: string;
  label: string;
  senders: string[];
  threads: ThreadBriefRow[];
}

/** Conversations from senders the system couldn't tie to a client (usually personal Gmail/Yahoo addresses). */
export function UnmatchedSheet({ groups, companies, canEdit, tabs, empty }: { groups: UnmatchedGroup[]; companies: { id: string; name: string }[]; canEdit: boolean; tabs: ReactNode; empty: ReactNode }) {
  let rowNo = 0;
  return (
    <GridCard>
      {tabs}
      <p className="px-5 py-3 text-[14px] text-muted">
        These people wrote about development or bulk work, but their email address doesn’t match a client. Type the client’s name and approve, add them to a client you already have, or mark them as not client work.
      </p>
      {groups.length === 0 ? (
        <div className="flex-1 border-t border-line">{empty}</div>
      ) : (
        <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
          <table className="sheet">
            <thead>
              <tr>
                <th className="rn" aria-label="Row" />
                <th className="co" style={{ width: 280, minWidth: 280, maxWidth: 280 }}>Which client is this?</th>
                <th style={{ minWidth: 200 }}>Sent by</th>
                <th style={{ width: 340, minWidth: 340 }}>Inquiry</th>
                <th style={{ minWidth: 128 }}>Type</th>
                <th style={{ minWidth: 156 }}>Reply</th>
                <th style={{ minWidth: 116 }}>Last email</th>
                <th className="act" style={{ width: 120, minWidth: 120 }}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.threads.map((t, i) => {
                  rowNo++;
                  return (
                    <tr key={t.id} className={cx('row', rowNo % 2 === 0 && 'alt', t.reply_state === 'awaiting' && 'waiting', i === g.threads.length - 1 && 'group-last')}>
                      <td className="rn">{rowNo}</td>
                      {i === 0 && (
                        <td className="co unknown" rowSpan={g.threads.length} style={{ width: 280, minWidth: 280, maxWidth: 280 }}>
                          <GroupActions group={g} companies={companies} canEdit={canEdit} />
                        </td>
                      )}
                      <td>
                        <div className="font-medium">{t.first_from_name ?? ''}</div>
                        <div className="text-[13px] text-muted">{t.first_from_email ?? ''}</div>
                      </td>
                      <td style={{ maxWidth: 340 }}>
                        <Link href={`/threads/${t.id}`} className="line-clamp-2 font-medium text-ink hover:text-indigo">{t.subject || '(no subject)'}</Link>
                        {(t.first_reason || t.summary) && <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{t.summary ?? t.first_reason}</div>}
                      </td>
                      <td><TypeChip kind={t.category} /></td>
                      <td><ReplyCell state={t.reply_state} /></td>
                      <td className="whitespace-nowrap text-[13.5px] text-muted">{shortDate(t.last_message_at)}</td>
                      <td className="act">
                        <EmailLinks threadId={t.id} emailCount={t.email_count} gmailThreadId={t.gmail_thread_id} mailboxEmail={t.mailbox_email} />
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </GridCard>
  );
}

function GroupActions({ group, companies, canEdit }: { group: UnmatchedGroup; companies: { id: string; name: string }[]; canEdit: boolean }) {
  const [name, setName] = useState(group.label);
  const [existing, setExisting] = useState('');
  const [busy, start] = useTransition();
  const ids = group.threads.map((t) => t.id);
  const act = (fn: () => Promise<ActionResult<unknown>>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });
  if (!canEdit) return <span className="text-[14.5px] font-semibold">{group.label}</span>;
  return (
    <div className={cx('flex flex-col gap-2', busy && 'opacity-60')}>
      <label className="text-[12.5px] font-medium text-muted" htmlFor={`name-${group.key}`}>Client name</label>
      <input id={`name-${group.key}`} className={cx(inputClass, 'h-9 py-0 font-semibold')} value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={() => act(() => approveAsNewClient(ids, name), `${name} approved. Reading their emails now.`)}>
        Approve as a new client
      </Button>
      <label className="sr-only" htmlFor={`add-${group.key}`}>Or add to a client you already have</label>
      <div className="flex gap-1.5">
        <select id={`add-${group.key}`} className={cx(inputClass, 'h-9 py-0 text-[13.5px]')} value={existing} onChange={(e) => setExisting(e.target.value)}>
          <option value="">Or add to a client…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {existing && <Button size="sm" disabled={busy} onClick={() => act(() => addThreadsToClient(ids, existing), 'Added to the client')}>Add</Button>}
      </div>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => ignoreThreads(ids), 'Marked as not client work')}>Not client work</Button>
    </div>
  );
}
