'use client';
import Link from 'next/link';
import { useCallback, useMemo, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { setClientApproval } from '@/app/actions/approvals';
import { addDevItem, updateBulkField, updateDevField } from '@/app/actions/items';
import type { ActionResult } from '@/app/actions/result';
import { cx, gmailLink } from '@/lib/format';
import {
  cellValue,
  CITY_LABEL,
  COMPANY_LABEL,
  DEFAULT_COLUMNS,
  groupByCompany,
  isWaiting,
  label,
  replyRank,
  SHEET_COLUMNS,
  type GridMode,
  type SheetColumn,
  type SheetGroup,
  type SheetRow,
} from '@/lib/sheet';
import { EditableCell } from './editable-cell';
import { ariaSort, ColumnsMenu, SortHeader, useColumns, type SortState } from './grid-controls';
import { RowPanel } from './row-panel';
import { BulkStatusText, GridCard, ReplyCell, SearchBox, shortDate, Thumbs, ToggleChip, TypeChip } from './sheet';
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
  mode: GridMode;
  approvalTab?: 'pending' | 'approved' | 'rejected';
  approvals?: Record<string, ApprovalInfo>;
  canApprove?: boolean;
  companies?: { id: string; name: string }[];
  tabs?: ReactNode;
  note?: ReactNode;
  empty: ReactNode;
}

const GROUPS_PER_PAGE = 60;

const titleOf = (r: SheetRow) => (r.source === 'thread' ? r.thread_subject || '(no subject)' : r.inquiry || r.thread_subject || 'Untitled row');

function compare(sort: SortState, a: SheetRow, b: SheetRow): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'reply') return (replyRank(a) - replyRank(b)) * dir;
  if (sort.key === 'last_email') return ((a.last_at ?? '').localeCompare(b.last_at ?? '')) * dir;
  const av = sort.key === 'inquiry' ? titleOf(a) : cellValue(a, sort.key);
  const bv = sort.key === 'inquiry' ? titleOf(b) : cellValue(b, sort.key);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av.localeCompare(bv, 'en', { sensitivity: 'base' }) * dir;
}

/**
 * The main grid. One header row per client with their rows underneath; the Inquiry column stays
 * in view while scrolling sideways and opens a details panel; Open and Gmail stay pinned on the right.
 */
export function WorkSheet({ rows, thumbnails, labels, mode, approvalTab, approvals, canApprove, companies, tabs, note, empty }: Props) {
  const [q, setQ] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const [limit, setLimit] = useState(GROUPS_PER_PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [visible, setVisible] = useColumns(`grc.columns.${mode}.v2`, DEFAULT_COLUMNS[mode]);

  const showCompany = mode !== 'client';
  const cols = SHEET_COLUMNS.filter((c) => c.key === 'inquiry' || visible.includes(c.key));
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

  const groups = useMemo(() => {
    const g = groupByCompany(filtered);
    if (!sort) return g;
    for (const grp of g) grp.rows.sort((a, b) => compare(sort, a, b));
    return [...g].sort((a, b) => compare(sort, a.rows[0]!, b.rows[0]!));
  }, [filtered, sort]);
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
    (acc, id) => ({ n: acc.n + (approvals?.[id]?.conversations ?? 0), cost: acc.cost + (approvals?.[id]?.cost ?? 0) }),
    { n: 0, cost: 0 },
  );
  const openRow = openId ? rows.find((r) => r.row_id === openId) ?? null : null;
  const closePanel = useCallback(() => setOpenId(null), []);
  let rowNo = 0;

  return (
    <>
      <GridCard>
        {tabs}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <ToggleChip on={onlyWaiting} onChange={setOnlyWaiting} tone="red">
            Waiting for our reply
            <span className={cx('rounded-full px-1.5 text-[12.5px] font-semibold tabular-nums', onlyWaiting ? 'bg-red text-white' : 'bg-red-soft text-red')}>{waitingCount}</span>
          </ToggleChip>
          <ColumnsMenu
            columns={SHEET_COLUMNS.map((c) => ({ key: c.key, label: label(c, labels), locked: c.key === 'inquiry' }))}
            visible={cols.map((c) => c.key)}
            onChange={setVisible}
            defaults={DEFAULT_COLUMNS[mode]}
          />
          {pickable && groups.length > 1 && (
            <button type="button" className="h-9 rounded-lg px-2.5 text-[14px] font-medium text-indigo hover:bg-indigo-soft" onClick={() => setSelected(new Set(groups.map((g) => g.companyId).filter(Boolean) as string[]))}>
              Select all {groups.length}
            </button>
          )}
          {mode === 'development' && companies && (
            <Button size="sm" variant="secondary" className="h-9" onClick={() => setAdding((a) => !a)}>
              <span aria-hidden className="text-[16px] leading-none">+</span> Add a row
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[13.5px] text-muted">
              {filtered.length} {filtered.length === 1 ? 'row' : 'rows'}
              {showCompany && `, ${groups.length} ${groups.length === 1 ? 'client' : 'clients'}`}
            </span>
            <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, brand, inquiry" />
          </div>
        </div>

        {adding && companies && <AddRow companies={companies} onDone={() => setAdding(false)} />}
        {note}

        {groups.length === 0 ? (
          <div className="flex-1 border-t border-line">
            {q || onlyWaiting ? (
              <div className="px-5 py-14 text-center">
                <p className="font-medium">Nothing matches</p>
                <button className="mt-2 text-[14px] font-medium text-indigo hover:underline" onClick={() => { setQ(''); setOnlyWaiting(false); }}>
                  Clear the search and filters
                </button>
              </div>
            ) : (
              empty
            )}
          </div>
        ) : (
          <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="rn" aria-label="Row" />
                  {showCompany && <th className="co">{COMPANY_LABEL}</th>}
                  {showCompany && <th style={{ width: 112, minWidth: 112 }}>{CITY_LABEL}</th>}
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className={cx(['sample_collected', 'picture'].includes(c.key) && 'center')}
                      style={{ width: c.width, minWidth: c.width, maxWidth: c.width + 40 }}
                      aria-sort={c.sortable ? ariaSort(sort, c.key) : undefined}
                    >
                      {c.sortable ? <SortHeader label={label(c, labels)} colKey={c.key} sort={sort} onSort={setSort} /> : label(c, labels)}
                    </th>
                  ))}
                  <th className="act" style={{ width: 132, minWidth: 132 }}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) =>
                  g.rows.map((r, i) => {
                    rowNo++;
                    return (
                      <tr
                        key={r.row_id}
                        className={cx('row', rowNo % 2 === 0 && 'alt', isWaiting(r) && 'waiting', openId === r.row_id && 'selected', i === g.rows.length - 1 && 'group-last')}
                      >
                        <td className="rn" title={isWaiting(r) ? 'Customer is waiting for GRC’s reply' : undefined}>{rowNo}</td>
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
                          <td
                            key={c.key}
                            style={{ maxWidth: c.width + 40 }}
                            className={cx(['sample_collected', 'picture'].includes(c.key) && 'center', c.key === 'picture' && 'pic')}
                          >
                            {c.key === 'inquiry' ? (
                              <InquiryCell r={r} onOpen={() => setOpenId(r.row_id)} />
                            ) : (
                              <Cell col={c} r={r} thumbs={r.thread_id ? thumbnails[r.thread_id] ?? [] : []} />
                            )}
                          </td>
                        ))}
                        <td className="act">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setOpenId(r.row_id)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink-2 transition-colors duration-200 hover:border-indigo/40 hover:text-indigo"
                            >
                              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <rect x="3" y="4" width="18" height="16" rx="2" />
                                <path d="M15 4v16" />
                              </svg>
                              Open
                            </button>
                            {r.gmail_thread_id && (
                              <a
                                href={gmailLink(r.mailbox_email, r.gmail_thread_id)}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Open in Gmail"
                                title="Open in Gmail to reply"
                                className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-slate-soft hover:text-ink"
                              >
                                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <rect x="3" y="5" width="18" height="14" rx="2" />
                                  <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
                                </svg>
                              </a>
                            )}
                          </div>
                        </td>
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
      </GridCard>

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 animate-fade-in flex-wrap items-center gap-3 rounded-xl bg-ink px-5 py-3 text-white shadow-[0_12px_32px_rgba(15,23,42,0.3)] lg:ml-[124px]">
          <span className="text-[14px]">
            <span className="font-semibold">{selected.size} {selected.size === 1 ? 'client' : 'clients'} selected</span>
            <span className="text-white/75">, {selectedInfo.n} conversations, about ${selectedInfo.cost.toFixed(2)} to read</span>
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" className="text-white/85 hover:bg-white/10 hover:text-white" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" className="border-white/25 bg-transparent text-white hover:bg-white/10" disabled={busy} onClick={() => act(() => setClientApproval([...selected], 'rejected'), `Ignored ${selected.size}`, () => setSelected(new Set()))}>
              Ignore {selected.size}
            </Button>
            <Button size="sm" className="border-transparent bg-white text-ink hover:bg-white/90" disabled={busy} onClick={() => act(() => setClientApproval([...selected], 'approved'), `Approved ${selected.size}. Reading their emails now.`, () => setSelected(new Set()))}>
              Approve {selected.size}
            </Button>
          </div>
        </div>
      )}

      {openRow && (
        <RowPanel
          row={openRow}
          labels={labels}
          thumbs={openRow.thread_id ? thumbnails[openRow.thread_id] ?? [] : []}
          onClose={closePanel}
          approveSlot={
            canApprove && openRow.company_id && openRow.company_approval === 'pending' ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-mustard/25 bg-mustard-soft px-4 py-3">
                <span className="flex-1 text-[14px] text-ink-2">{openRow.company_name} is waiting for approval.</span>
                <Button size="sm" disabled={busy} onClick={() => act(() => setClientApproval([openRow.company_id!], 'rejected'), 'Ignored', closePanel)}>Ignore</Button>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([openRow.company_id!], 'approved'), 'Approved. Reading their emails now.', closePanel)}>Approve client</Button>
              </div>
            ) : null
          }
        />
      )}
    </>
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
  group: SheetGroup<SheetRow>;
  mode: GridMode;
  tab: Props['approvalTab'];
  info?: ApprovalInfo;
  canApprove: boolean;
  selected: boolean;
  onSelect?: (on: boolean) => void;
  busy: boolean;
  act: (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) => void;
}) {
  const id = group.companyId;
  const n = group.rows.length;
  const name = id ? (
    <Link href={`/clients/${id}`} className="text-[14.5px] font-semibold leading-snug text-ink hover:text-indigo">
      {group.name}
    </Link>
  ) : (
    <span className="text-[14.5px] font-semibold leading-snug text-ink">{group.name}</span>
  );
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-start gap-2.5">
        {onSelect && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[#1e40af]" aria-label={`Select ${group.name}`} />
        )}
        <div>
          {name}
          <div className="mt-0.5 text-[12.5px] text-muted">
            {n} {mode === 'approvals' ? (n === 1 ? 'conversation' : 'conversations') : n === 1 ? 'row' : 'rows'}
            {group.region && group.region !== group.city ? `, ${group.region}` : ''}
          </div>
        </div>
      </div>
      {group.waiting > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-soft px-2 py-[2px] text-[12.5px] font-medium text-red">
          <span className="size-1.5 rounded-full bg-red" aria-hidden />
          {group.waiting} waiting for reply
        </span>
      )}
      {mode === 'approvals' && id && canApprove && tab === 'pending' && (
        <>
          {info && <span className="text-[12.5px] text-muted">About ${info.cost.toFixed(2)} for the AI to read</span>}
          <span className="flex gap-1.5">
            <Button size="xs" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), `${group.name} approved. Reading their emails now.`)}>
              Approve
            </Button>
            <Button size="xs" disabled={busy} onClick={() => act(() => setClientApproval([id], 'rejected'), `${group.name} ignored`)}>
              Ignore
            </Button>
          </span>
        </>
      )}
      {mode === 'approvals' && id && canApprove && tab === 'approved' && (
        <Button size="xs" variant="ghost" className="-ml-2" disabled={busy} onClick={() => act(() => setClientApproval([id], 'pending'), 'Moved back to waiting')}>
          Move back to waiting
        </Button>
      )}
      {mode === 'approvals' && id && canApprove && tab === 'rejected' && (
        <Button size="xs" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), `${group.name} approved`)}>
          Approve
        </Button>
      )}
    </div>
  );
}

/** The Inquiry column: what it's about; a click opens the details panel. */
function InquiryCell({ r, onOpen }: { r: SheetRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group/p block w-full text-left" title="Open the details">
      <span className={cx('line-clamp-2 text-ink group-hover/p:text-indigo group-hover/p:underline group-hover/p:decoration-indigo/30 group-hover/p:underline-offset-2', r.source === 'thread' && 'font-medium')}>
        {titleOf(r)}
      </span>
      {r.source === 'bulk' && (r.po_number || r.qty_mtrs) && (
        <span className="mt-0.5 block text-[13px] text-muted">
          {[r.po_number && `PO ${r.po_number}`, r.qty_mtrs && `${Number(r.qty_mtrs).toLocaleString('en-IN')} mtrs`].filter(Boolean).join(', ')}
        </span>
      )}
      {r.source === 'thread' && r.summary && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-muted">{r.summary}</span>}
      {r.source === 'thread' && r.company_approval === 'approved' && !r.is_read && <span className="mt-1 block text-[12.5px] font-medium text-indigo">AI is reading this now</span>}
    </button>
  );
}

/** Any other cell. Rows that are items or orders can be typed into; conversations are read-only. */
function Cell({ col, r, thumbs }: { col: SheetColumn; r: SheetRow; thumbs: string[] }) {
  switch (col.key) {
    case 'picture':
      return <Thumbs urls={thumbs} />;
    case 'type':
      return <TypeChip kind={r.row_kind} />;
    case 'reply':
      return <ReplyCell state={r.reply_state} waitingOn={r.waiting_on} dueAt={r.reply_due_at} />;
    case 'last_email':
      return <span className="whitespace-nowrap text-[13.5px] text-muted">{shortDate(r.last_at)}</span>;
  }
  if (r.source === 'thread') {
    if (col.key === 'merchant_name') return <span>{r.merchant ?? ''}</span>;
    if (col.key === 'enquiry_date') return <span className="text-muted">{shortDate(r.enquiry_date)}</span>;
    return null;
  }
  if (r.source === 'bulk') {
    if (col.key === 'team_status') return <BulkStatusText status={r.stage} />;
    if (!col.bulkField) return null;
    return (
      <EditableCell
        value={cellValue(r, col.key)}
        kind={col.kind === 'longtext' ? 'longtext' : 'text'}
        onSave={(v) => updateBulkField(r.item_id!, col.bulkField!, v)}
        locked={r.locked_fields.includes(col.bulkField)}
      />
    );
  }
  if (!col.devField) return null;
  const raw = cellValue(r, col.key);
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
      className="flex flex-wrap items-end gap-2 border-y border-line bg-indigo-soft/60 px-5 py-3"
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
      <label className="text-[13px] font-medium text-ink-2">
        Client
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={cx(inputClass, 'mt-1 w-56')} required>
          <option value="">Choose the client</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="text-[13px] font-medium text-ink-2">
        Brand
        <input value={brand} onChange={(e) => setBrand(e.target.value)} className={cx(inputClass, 'mt-1 w-40')} />
      </label>
      <label className="min-w-72 flex-1 text-[13px] font-medium text-ink-2">
        Inquiry
        <input value={inquiry} onChange={(e) => setInquiry(e.target.value)} placeholder="e.g. 30MM knitted elastic, 4 colours" className={cx(inputClass, 'mt-1')} required />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>Add row</Button>
      <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}
