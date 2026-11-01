'use client';
import Link from 'next/link';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { setClientApproval } from '@/app/actions/approvals';
import { addDevItem, updateBulkField, updateDevField } from '@/app/actions/items';
import type { ActionResult } from '@/app/actions/result';
import { cx } from '@/lib/format';
import { CITY_LABEL, COMPANY_LABEL, groupByCompany, isWaiting, label, SHEET_COLUMNS, type SheetColumn, type SheetRow } from '@/lib/sheet';
import { EditableCell } from './editable-cell';
import { BulkStatusText, EmailLinks, ReplyCell, shortDate, Thumbs, TypeChip } from './sheet';
import { Button, inputClass } from './ui';

export interface ApprovalInfo {
  conversations: number;
  cost: number;
  approvedAt?: string | null;
}

interface Props {
  rows: SheetRow[];
  thumbnails: Record<string, string[]>;
  labels: Record<string, string>;
  mode: 'development' | 'client' | 'approvals';
  approvalTab?: 'pending' | 'approved' | 'rejected';
  approvals?: Record<string, ApprovalInfo>;
  canApprove?: boolean;
  companies?: { id: string; name: string }[];
  footer?: ReactNode;
  note?: ReactNode;
  empty: ReactNode;
}

const GROUPS_PER_PAGE = 60;

/**
 * GRC's sheet: one row per inquiry or conversation, the client's name in a yellow cell
 * merged down its rows, GRC's own column names, plus Type / Reply / Last email / Email.
 */
export function WorkSheet({ rows, thumbnails, labels, mode, approvalTab, approvals, canApprove, companies, footer, note, empty }: Props) {
  const [q, setQ] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState(GROUPS_PER_PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, start] = useTransition();

  const showCompany = mode !== 'client';
  // Type sits right after City (first on a client's page). On Development every row is development, so it's left out.
  const base = SHEET_COLUMNS.filter((c) => (!c.extra || more) && c.key !== 'type');
  const typeCol = SHEET_COLUMNS.find((c) => c.key === 'type')!;
  const cols = mode === 'development' ? base : [typeCol, ...base];
  const waitingCount = rows.filter(isWaiting).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyWaiting && !isWaiting(r)) return false;
      if (!needle) return true;
      return [r.company_name, r.company_city, r.merchant, r.brand, r.inquiry, r.thread_subject, r.team_status, r.brand_status, r.owner_remark, r.product_code, r.awb, r.po_number, r.summary]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, onlyWaiting]);
  const groups = useMemo(() => groupByCompany(filtered), [filtered]);
  const shown = groups.slice(0, limit);

  const act = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      after?.();
    });

  const pickable = mode === 'approvals' && approvalTab === 'pending' && canApprove;
  const selectedInfo = [...selected].reduce(
    (acc, id) => {
      const a = approvals?.[id];
      return { n: acc.n + (a?.conversations ?? 0), cost: acc.cost + (a?.cost ?? 0) };
    },
    { n: 0, cost: 0 },
  );

  let rowNo = 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-ground px-4 py-2">
        <label className="relative">
          <span className="sr-only">Search</span>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this sheet"
            className="h-9 w-72 max-w-full rounded-full border border-line bg-surface pl-9 pr-3 text-[14px] outline-none focus:border-indigo"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[14px]">
          <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} className="size-4 accent-[#d93025]" />
          Only customers waiting for our reply <span className="font-bold text-red">{waitingCount}</span>
        </label>
        {mode !== 'approvals' && (
          <label className="flex cursor-pointer items-center gap-2 text-[14px]">
            <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} className="size-4 accent-[#188038]" />
            More columns
          </label>
        )}
        {pickable && groups.length > 1 && (
          <button className="text-[14px] text-indigo hover:underline" onClick={() => setSelected(new Set(groups.map((g) => g.companyId).filter(Boolean) as string[]))}>
            Select all {groups.length} clients
          </button>
        )}
        {mode === 'development' && companies && (
          <Button size="sm" onClick={() => setAdding((a) => !a)}>
            Add a row
          </Button>
        )}
        <span className="ml-auto text-[13px] text-muted">
          {filtered.length} {filtered.length === 1 ? 'row' : 'rows'}
          {showCompany && `, ${groups.length} ${groups.length === 1 ? 'client' : 'clients'}`}
        </span>
      </div>

      {adding && companies && <AddRow companies={companies} onDone={() => setAdding(false)} />}
      {note}

      {groups.length === 0 ? (
        <div className="flex-1">{q || onlyWaiting ? <p className="px-5 py-10 text-center text-[14px] text-muted">Nothing matches. Clear the search box or untick the filter.</p> : empty}</div>
      ) : (
        <div className="sheet-wrap min-h-0 flex-1">
          <table className="sheet">
            <thead>
              <tr>
                <th className="rn" aria-label="Row" />
                {showCompany && <th className="co">{COMPANY_LABEL}</th>}
                {showCompany && <th style={{ minWidth: 90 }}>{CITY_LABEL}</th>}
                {cols.map((c) => (
                  <th key={c.key} style={{ width: c.width, minWidth: c.width, maxWidth: c.width + 40 }}>
                    {label(c, labels)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((g) =>
                g.rows.map((r, i) => {
                  rowNo++;
                  return (
                    <tr key={r.row_id}>
                      <td className={cx('rn', isWaiting(r) && 'alert')} title={isWaiting(r) ? 'Customer is waiting for GRC’s reply' : undefined}>
                        {rowNo}
                      </td>
                      {showCompany && i === 0 && (
                        <td className={cx('co', !g.companyId && 'unknown')} rowSpan={g.rows.length}>
                          <CompanyCell
                            group={g}
                            mode={mode}
                            tab={approvalTab}
                            info={g.companyId ? approvals?.[g.companyId] : undefined}
                            canApprove={Boolean(canApprove)}
                            selected={g.companyId ? selected.has(g.companyId) : false}
                            onSelect={
                              pickable && g.companyId
                                ? (on) =>
                                    setSelected((s) => {
                                      const n = new Set(s);
                                      if (on) n.add(g.companyId!);
                                      else n.delete(g.companyId!);
                                      return n;
                                    })
                                : undefined
                            }
                            busy={busy}
                            act={act}
                          />
                        </td>
                      )}
                      {showCompany && i === 0 && (
                        <td className="city" rowSpan={g.rows.length}>
                          {g.city ?? ''}
                        </td>
                      )}
                      {cols.map((c) => (
                        <td key={c.key} style={{ maxWidth: c.width + 40 }} className={cx(['sample_collected', 'type', 'last_email', 'picture'].includes(c.key) && 'center', c.key === 'picture' && 'pic')}>
                          <Cell col={c} r={r} thumbs={r.thread_id ? thumbnails[r.thread_id] ?? [] : []} />
                        </td>
                      ))}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
          {groups.length > limit && (
            <div className="px-5 py-4">
              <Button onClick={() => setLimit((l) => l + GROUPS_PER_PAGE)}>Show {Math.min(GROUPS_PER_PAGE, groups.length - limit)} more clients</Button>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t-2 border-go bg-go-soft px-4 py-2.5">
          <span className="text-[14px]">
            <span className="font-bold">{selected.size} {selected.size === 1 ? 'client' : 'clients'} ticked</span>, {selectedInfo.n} conversations, about ${selectedInfo.cost.toFixed(2)} for the AI to read
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([...selected], 'approved'), `Approved ${selected.size}. Reading their emails now.`, () => setSelected(new Set()))}>
              Approve {selected.size}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act(() => setClientApproval([...selected], 'rejected'), `Ignored ${selected.size}`, () => setSelected(new Set()))}>
              Ignore {selected.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Untick all
            </Button>
          </div>
        </div>
      )}
      {footer}
    </div>
  );
}

function CompanyCell({
  group,
  mode,
  tab,
  info,
  canApprove,
  selected,
  onSelect,
  busy,
  act,
}: {
  group: ReturnType<typeof groupByCompany>[number];
  mode: Props['mode'];
  tab: Props['approvalTab'];
  info?: ApprovalInfo;
  canApprove: boolean;
  selected: boolean;
  onSelect?: (on: boolean) => void;
  busy: boolean;
  act: (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) => void;
}) {
  const id = group.companyId;
  const name = id ? (
    <Link href={`/clients/${id}`} className="block">
      {group.name}
    </Link>
  ) : (
    <span>{group.name}</span>
  );
  if (mode !== 'approvals' || !id) return name;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-start gap-2">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[#188038]"
            aria-label={`Tick ${group.name}`}
          />
        )}
        {name}
      </div>
      {canApprove && tab === 'pending' && (
        <>
          {info && <span className="text-[11.5px] font-normal">about ${info.cost.toFixed(2)} to read</span>}
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), `${group.name} approved. Reading their emails now.`)}>
              Approve
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act(() => setClientApproval([id], 'rejected'), `${group.name} ignored`)}>
              Ignore
            </Button>
          </div>
        </>
      )}
      {canApprove && tab === 'approved' && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => setClientApproval([id], 'pending'), 'Moved back to waiting')}>
          Move back to waiting
        </Button>
      )}
      {canApprove && tab === 'rejected' && (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), `${group.name} approved`)}>
          Approve
        </Button>
      )}
    </div>
  );
}

/** One cell. Items and bulk orders can be typed into; conversations not yet read are read-only. */
function Cell({ col, r, thumbs }: { col: SheetColumn; r: SheetRow; thumbs: string[] }) {
  switch (col.key) {
    case 'picture':
      return <Thumbs urls={thumbs} />;
    case 'type':
      return <TypeChip kind={r.row_kind} />;
    case 'reply':
      return <ReplyCell state={r.reply_state} waitingOn={r.waiting_on} dueAt={r.reply_due_at} />;
    case 'last_email':
      return <span className="text-[12.5px]">{shortDate(r.last_at)}</span>;
    case 'email':
      return <EmailLinks threadId={r.thread_id} emailCount={r.email_count} gmailThreadId={r.gmail_thread_id} mailboxEmail={r.mailbox_email} />;
  }

  if (r.source === 'thread') {
    if (col.key === 'merchant_name') return <span className="px-0.5">{r.merchant ?? ''}</span>;
    if (col.key === 'inquiry')
      return (
        <div className="px-0.5">
          <div className="font-bold">{r.thread_subject || '(no subject)'}</div>
          {r.summary && <div className="mt-0.5 line-clamp-3 text-[12.5px] text-ink-2">{r.summary}</div>}
          {r.company_approval === 'approved' && !r.is_read && <div className="mt-0.5 text-[12px] italic text-muted">AI is reading this now</div>}
        </div>
      );
    if (col.key === 'enquiry_date') return <span>{shortDate(r.enquiry_date)}</span>;
    return null;
  }

  if (r.source === 'bulk') {
    if (col.key === 'team_status') return <BulkStatusText status={r.stage} />;
    if (!col.bulkField) return null;
    const value = (r as unknown as Record<string, string | null>)[col.key === 'inquiry' ? 'inquiry' : col.key] ?? null;
    return (
      <div>
        <EditableCell value={value} kind={col.kind === 'longtext' ? 'longtext' : 'text'} onSave={(v) => updateBulkField(r.item_id!, col.bulkField!, v)} locked={r.locked_fields.includes(col.bulkField)} />
        {col.key === 'inquiry' && (r.po_number || r.qty_mtrs) && (
          <div className="px-0.5 text-[12px] text-muted">{[r.po_number && `PO ${r.po_number}`, r.qty_mtrs && `${Number(r.qty_mtrs).toLocaleString('en-IN')} mtrs`].filter(Boolean).join(', ')}</div>
        )}
      </div>
    );
  }

  // development item
  if (!col.devField) return null;
  const raw = (r as unknown as Record<string, string | null>)[col.key === 'merchant_name' ? 'merchant' : col.key] ?? null;
  return (
    <EditableCell
      value={raw}
      kind={col.kind ?? 'text'}
      options={col.options?.map((o) => ({ value: o, label: o }))}
      display={col.kind === 'date' && raw ? <span>{shortDate(raw)}</span> : undefined}
      onSave={(v) => updateDevField(r.item_id!, col.devField!, v)}
      locked={r.locked_fields.includes(col.devField)}
    />
  );
}

function AddRow({ companies, onDone }: { companies: { id: string; name: string }[]; onDone: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [brand, setBrand] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-b border-line bg-go-soft px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await addDevItem(companyId || null, inquiry, brand || null);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success('Row added');
        onDone();
      }}
    >
      <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={cx(inputClass, 'w-56')} aria-label="Company" required>
        <option value="">Choose the client</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="brand" className={cx(inputClass, 'w-36')} aria-label="Brand" />
      <input value={inquiry} onChange={(e) => setInquiry(e.target.value)} placeholder="Inquiry, e.g. 30MM knitted elastic, 4 colours" className={cx(inputClass, 'min-w-72 flex-1')} aria-label="Inquiry" required />
      <Button type="submit" variant="primary" disabled={busy}>
        Add row
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
