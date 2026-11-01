'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ClientApproval, ClientQueueRow, ThreadBriefRow } from '@grc/core';
import { addThreadsToClient, approveAsNewClient, ignoreThreads, setClientApproval } from '@/app/actions/approvals';
import { mergeCompany, updateCompany } from '@/app/actions/companies';
import type { ActionResult } from '@/app/actions/result';
import { ago, cx, fmtDate, gmailLink } from '@/lib/format';
import { Button, inputClass } from './ui';

const TYPE: Record<string, { label: string; cls: string }> = {
  development: { label: 'Development', cls: 'bg-indigo-soft text-indigo' },
  bulk: { label: 'Bulk order', cls: 'bg-teal-soft text-teal' },
  mixed: { label: 'Development + bulk', cls: 'bg-mustard-soft text-mustard' },
};

function useAct() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        after?.();
      } else toast.error(r.error);
    });
  return { pending, act };
}

/** One conversation, readable without opening Gmail: first customer email, what it's about, latest message. */
export function ThreadBrief({ t }: { t: ThreadBriefRow }) {
  const type = TYPE[t.category] ?? { label: t.category, cls: 'bg-slate-soft text-ink-2' };
  const lastWho = t.last_direction === 'outbound' || t.last_direction === 'internal' ? 'GRC' : (t.last_from_name ?? t.last_from_email ?? 'Customer');
  const sameMessage = t.email_count <= 1;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cx('rounded px-1.5 py-0.5 text-[11.5px] font-medium', type.cls)}>{type.label}</span>
        <span className="font-medium">{t.subject || '(no subject)'}</span>
        {t.reply_state === 'awaiting' && <span className="rounded bg-red-soft px-1.5 py-0.5 text-[11.5px] font-medium text-red">Waiting for our reply</span>}
      </div>
      <p className="mt-0.5 text-[12px] text-muted">
        {t.email_count} {t.email_count === 1 ? 'email' : 'emails'}, {fmtDate(t.first_message_at)}
        {t.last_message_at && t.first_message_at?.slice(0, 10) !== t.last_message_at.slice(0, 10) ? ` to ${fmtDate(t.last_message_at)}` : ''}
      </p>
      {t.first_snippet && (
        <p className="mt-1.5 line-clamp-3 max-w-3xl text-[13px]">
          <span className="font-medium">{t.first_from_name ?? t.first_from_email ?? 'Customer'}:</span> {t.first_snippet}
        </p>
      )}
      {t.first_reason && <p className="mt-1 text-[12.5px] text-muted">About: {t.first_reason}</p>}
      {!sameMessage && t.last_snippet && (
        <p className="mt-1 line-clamp-2 max-w-3xl text-[12.5px] text-ink-2">
          <span className="font-medium">Latest, {lastWho}, {ago(t.last_message_at)}:</span> {t.last_snippet}
        </p>
      )}
      <div className="mt-1.5 flex gap-3 text-[12.5px]">
        <a href={gmailLink(t.mailbox_email, t.gmail_thread_id)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">Open in Gmail</a>
        <Link href={`/threads/${t.id}`} className="text-indigo hover:underline">All emails</Link>
      </div>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'red' }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className={cx('text-[15px] font-semibold tabular-nums', tone === 'red' && 'text-red')}>{value}</dd>
    </div>
  );
}

export interface ClientCardData {
  client: ClientQueueRow;
  threads: ThreadBriefRow[];
  contacts: { name: string | null; email: string }[];
  inSheet: boolean;
}

function ClientCard({
  data,
  tab,
  selected,
  onSelect,
  companies,
  costPerThread,
  canEdit,
}: {
  data: ClientCardData;
  tab: ClientApproval;
  selected: boolean;
  onSelect: (on: boolean) => void;
  companies: { id: string; name: string }[];
  costPerThread: number;
  canEdit: boolean;
}) {
  const { client, threads, contacts, inSheet } = data;
  const { pending, act } = useAct();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [into, setInto] = useState('');
  const shown = showAll ? threads : threads.slice(0, 3);
  const unread = client.tracked_threads - client.read_threads;

  return (
    <article className={cx('rounded-lg border bg-surface', selected ? 'border-indigo ring-2 ring-indigo/15' : 'border-line', pending && 'opacity-60')}>
      <header className="flex flex-wrap items-start gap-3 border-b border-line-2 px-4 py-3">
        {canEdit && tab === 'pending' && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1.5 size-4" aria-label={`Select ${client.name}`} />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex max-w-md gap-2">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Client name" autoFocus />
              <Button size="sm" variant="primary" onClick={() => act(() => updateCompany(client.id, { name }), 'Renamed', () => setEditing(false))}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(client.name); }}>Cancel</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[16px] font-semibold">{client.name}</h3>
              {inSheet && <span className="rounded bg-teal-soft px-1.5 py-0.5 text-[11.5px] font-medium text-teal">In GRC’s sheet</span>}
              {canEdit && <button onClick={() => setEditing(true)} className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">Rename</button>}
            </div>
          )}
          <p className="mt-0.5 text-[12.5px] text-muted">
            {[client.city, client.region].filter(Boolean).join(', ') || 'Location not known'}
            {client.domains.length > 0 && <span className="ml-2">{client.domains.join(', ')}</span>}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'pending' && (
              <>
                <span className="text-[12px] text-muted">about ${(client.tracked_threads * costPerThread).toFixed(2)} to read</span>
                <Button size="sm" variant="primary" onClick={() => act(() => setClientApproval([client.id], 'approved'), `Approved. Reading ${client.tracked_threads} conversations now.`)}>Approve client</Button>
                <Button size="sm" onClick={() => act(() => setClientApproval([client.id], 'rejected'), 'Ignored')}>Ignore</Button>
              </>
            )}
            {tab === 'approved' && (
              <>
                <span className="text-[12px] text-muted">
                  Approved {fmtDate(client.approval_at)}. {unread > 0 ? `${unread} still being read` : 'All conversations read'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => act(() => setClientApproval([client.id], 'pending'), 'Moved back to waiting')}>Move back to waiting</Button>
              </>
            )}
            {tab === 'rejected' && (
              <>
                <Button size="sm" variant="primary" onClick={() => act(() => setClientApproval([client.id], 'approved'), 'Approved')}>Approve client</Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => setClientApproval([client.id], 'pending'), 'Moved back to waiting')}>Move back to waiting</Button>
              </>
            )}
          </div>
        )}
      </header>

      <dl className="grid grid-cols-3 border-b border-line-2 sm:grid-cols-6">
        <Stat label="Conversations" value={client.tracked_threads} />
        <Stat label="Emails" value={client.email_count} />
        <Stat label="Development" value={client.dev_threads + client.mixed_threads} />
        <Stat label="Bulk" value={client.bulk_threads + client.mixed_threads} />
        <Stat label="Waiting for reply" value={client.awaiting_reply} tone={client.awaiting_reply > 0 ? 'red' : undefined} />
        <Stat label="Last email" value={client.last_at ? ago(client.last_at) : '—'} />
      </dl>

      {contacts.length > 0 && (
        <p className="px-4 pt-3 text-[13px]">
          <span className="text-muted">People: </span>
          {contacts.slice(0, 5).map((c) => (c.name ? `${c.name} (${c.email})` : c.email)).join(', ')}
          {contacts.length > 5 && <span className="text-muted">, and {contacts.length - 5} more</span>}
        </p>
      )}

      <ul className="divide-y divide-line-2 px-4">{shown.map((t) => <ThreadBrief key={t.id} t={t} />)}</ul>
      {threads.length > 3 && (
        <button onClick={() => setShowAll((s) => !s)} className="px-4 pb-3 text-[13px] text-indigo hover:underline">
          {showAll ? 'Show fewer' : `Show all ${threads.length} conversations`}
        </button>
      )}

      {canEdit && tab !== 'rejected' && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line-2 px-4 py-2.5 text-[12.5px]">
          <span className="text-muted">Same client as</span>
          <select className={cx(inputClass, 'h-8 w-56 py-0')} value={into} onChange={(e) => setInto(e.target.value)} aria-label="Merge into">
            <option value="">choose…</option>
            {companies.filter((c) => c.id !== client.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {into && <Button size="sm" onClick={() => act(() => mergeCompany(client.id, into), 'Merged')}>Merge</Button>}
        </footer>
      )}
    </article>
  );
}

/** The client cards, with multi-select for approving or ignoring several at once. */
export function ApprovalList({
  cards,
  tab,
  companies,
  costPerThread,
  canEdit,
}: {
  cards: ClientCardData[];
  tab: ClientApproval;
  companies: { id: string; name: string }[];
  costPerThread: number;
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, act } = useAct();
  const ids = [...selected];
  const threads = cards.filter((c) => selected.has(c.client.id)).reduce((n, c) => n + c.client.tracked_threads, 0);

  return (
    <div className="space-y-4">
      {canEdit && tab === 'pending' && cards.length > 1 && (
        <div className="flex items-center gap-3 text-[13px]">
          <button className="text-indigo hover:underline" onClick={() => setSelected(new Set(cards.map((c) => c.client.id)))}>Select all {cards.length}</button>
          {selected.size > 0 && <button className="text-muted hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>}
        </div>
      )}
      {cards.map((c) => (
        <ClientCard
          key={c.client.id}
          data={c}
          tab={tab}
          selected={selected.has(c.client.id)}
          onSelect={(on) => setSelected((s) => {
            const n = new Set(s);
            if (on) n.add(c.client.id);
            else n.delete(c.client.id);
            return n;
          })}
          companies={companies}
          costPerThread={costPerThread}
          canEdit={canEdit}
        />
      ))}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-ink px-4 py-3 text-white shadow-lg">
          <span className="text-[13.5px]">
            {selected.size} {selected.size === 1 ? 'client' : 'clients'} selected, {threads} conversations, about ${(threads * costPerThread).toFixed(2)} to read
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => setClientApproval(ids, 'approved'), `Approved ${ids.length}. Reading now.`, () => setSelected(new Set()))}>
              Approve {selected.size}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => act(() => setClientApproval(ids, 'rejected'), `Ignored ${ids.length}`, () => setSelected(new Set()))}>
              Ignore {selected.size}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface UnmatchedGroup {
  key: string;
  label: string;
  senders: string[];
  threads: ThreadBriefRow[];
}

/** Conversations the system couldn't tie to a client (usually personal Gmail/Yahoo senders). */
export function UnmatchedGroupCard({ group, companies, canEdit }: { group: UnmatchedGroup; companies: { id: string; name: string }[]; canEdit: boolean }) {
  const { pending, act } = useAct();
  const [name, setName] = useState(group.label);
  const [existing, setExisting] = useState('');
  const [showAll, setShowAll] = useState(false);
  const ids = group.threads.map((t) => t.id);
  const shown = showAll ? group.threads : group.threads.slice(0, 2);
  return (
    <article className={cx('rounded-lg border border-dashed border-line bg-surface', pending && 'opacity-60')}>
      <header className="border-b border-line-2 px-4 py-3">
        <p className="text-[12px] text-muted">From {group.senders.slice(0, 3).join(', ')}{group.senders.length > 3 ? ` and ${group.senders.length - 3} more` : ''}</p>
        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={cx(inputClass, 'w-64')} value={name} onChange={(e) => setName(e.target.value)} aria-label="Client name" />
            <Button size="sm" variant="primary" onClick={() => act(() => approveAsNewClient(ids, name), `Created ${name} and started reading`)}>Approve as new client</Button>
            <span className="text-[12px] text-muted">or</span>
            <select className={cx(inputClass, 'h-8 w-52 py-0')} value={existing} onChange={(e) => setExisting(e.target.value)} aria-label="Existing client">
              <option value="">add to existing client…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {existing && <Button size="sm" onClick={() => act(() => addThreadsToClient(ids, existing), 'Added to client')}>Add</Button>}
            <Button size="sm" variant="ghost" onClick={() => act(() => ignoreThreads(ids), 'Marked as not client work')}>Not client work</Button>
          </div>
        ) : (
          <h3 className="mt-1 font-semibold">{group.label}</h3>
        )}
      </header>
      <ul className="divide-y divide-line-2 px-4">{shown.map((t) => <ThreadBrief key={t.id} t={t} />)}</ul>
      {group.threads.length > 2 && (
        <button onClick={() => setShowAll((s) => !s)} className="px-4 pb-3 text-[13px] text-indigo hover:underline">
          {showAll ? 'Show fewer' : `Show all ${group.threads.length} conversations`}
        </button>
      )}
    </article>
  );
}
