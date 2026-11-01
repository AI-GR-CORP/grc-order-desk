'use client';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ThreadBriefRow } from '@grc/core';
import { addThreadsToClient, approveAsNewClient, ignoreThreads } from '@/app/actions/approvals';
import type { ActionResult } from '@/app/actions/result';
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
                <th className="co" style={{ minWidth: 280 }}>Which client is this?</th>
                <th style={{ minWidth: 160 }}>Sent by</th>
                <th style={{ minWidth: 320 }}>Inquiry</th>
                <th style={{ minWidth: 106 }}>Type</th>
                <th style={{ minWidth: 132 }}>Reply</th>
                <th style={{ minWidth: 96 }}>Last email</th>
                <th style={{ minWidth: 96 }}>Email</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.threads.map((t, i) => {
                  rowNo++;
                  return (
                    <tr key={t.id} className={cx(i === g.threads.length - 1 && 'group-last')}>
                      <td className={cx('rn', t.reply_state === 'awaiting' && 'alert')}>{rowNo}</td>
                      {i === 0 && (
                        <td className="co unknown" rowSpan={g.threads.length} style={{ maxWidth: 300 }}>
                          <GroupActions group={g} companies={companies} canEdit={canEdit} />
                        </td>
                      )}
                      <td>
                        <div className="font-medium">{t.first_from_name ?? ''}</div>
                        <div className="text-[12.5px] text-muted">{t.first_from_email ?? ''}</div>
                      </td>
                      <td style={{ maxWidth: 440 }}>
                        <div className="font-medium">{t.subject || '(no subject)'}</div>
                        {(t.first_reason || t.summary) && <div className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-muted">{t.summary ?? t.first_reason}</div>}
                      </td>
                      <td><TypeChip kind={t.category} /></td>
                      <td><ReplyCell state={t.reply_state} /></td>
                      <td className="whitespace-nowrap text-[13px] text-muted">{shortDate(t.last_message_at)}</td>
                      <td><EmailLinks threadId={t.id} emailCount={t.email_count} gmailThreadId={t.gmail_thread_id} mailboxEmail={t.mailbox_email} /></td>
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
  if (!canEdit) return <span>{group.label}</span>;
  return (
    <div className={cx('flex flex-col gap-2 text-left text-[13px] font-normal', busy && 'opacity-60')}>
      <input className={cx(inputClass, 'h-9 font-semibold')} value={name} onChange={(e) => setName(e.target.value)} aria-label="Client name" />
      <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={() => act(() => approveAsNewClient(ids, name), `${name} approved. Reading their emails now.`)}>
        Approve as a new client
      </Button>
      <div className="flex gap-1.5">
        <select className={cx(inputClass, 'h-8 py-0 text-[13px]')} value={existing} onChange={(e) => setExisting(e.target.value)} aria-label="Add to a client you already have">
          <option value="">or add to a client…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {existing && <Button size="sm" disabled={busy} onClick={() => act(() => addThreadsToClient(ids, existing), 'Added to the client')}>Add</Button>}
      </div>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => ignoreThreads(ids), 'Marked as not client work')}>
        Not client work
      </Button>
    </div>
  );
}
