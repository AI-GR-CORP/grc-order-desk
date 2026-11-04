'use client';
import Link from 'next/link';
import { useCallback, useMemo, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { setClientApproval } from '@/app/actions/approvals';
import { setRowsClosed, type CloseTarget } from '@/app/actions/threads';
import { setClientType } from '@/app/actions/threads';
import { addDevItem, updateBulkField, updateDevField } from '@/app/actions/items';
import type { ActionResult } from '@/app/actions/result';
import { cx, gmailLink } from '@/lib/format';
import {
  cellValue,
  CITY_LABEL,
  COMPANY_LABEL,
  DEFAULT_COLUMNS,
  groupByCompany,
  fallbackHeading,
  subjectBlocks,
  type SubjectInfo,
  isWaiting,
  label,
  needsTypeCheck,
  replyRank,
  typeInfo,
  SHEET_COLUMNS,
  type GridMode,
  type SheetColumn,
  type SheetGroup,
  type SheetRow,
} from '@/lib/sheet';
import { EditableCell } from './editable-cell';
import { ariaSort, ColumnsMenu, SortHeader, useColumns, type SortState } from './grid-controls';
import { RowPanel } from './row-panel';
import type { RowPic } from '@/lib/pictures';
import { TypeCell } from './type-cell';
import { BulkStatusText, GridBar, GridCard, ReplyCell, SearchBox, shortDate, Thumbs, ToggleChip } from './sheet';
import { Button, inputClass } from './ui';

/** Tripti's checklist for one bulk order: step key -> what was written, and the latest step reached. */
export interface BulkChecklist {
  stages: Record<string, { value: string | null; locked?: boolean }>;
  current_stage: string | null;
}
export interface StageDef {
  key: string;
  label: string;
  optional?: boolean;
}

export interface ApprovalInfo {
  conversations: number;
  cost: number;
  approvedAt?: string | null;
}

interface Props {
  rows: SheetRow[];
  pictures: Record<string, RowPic[]>;
  labels: Record<string, string>;
  mode: GridMode;
  approvalTab?: 'pending' | 'approved' | 'rejected';
  approvals?: Record<string, ApprovalInfo>;
  canApprove?: boolean;
  companies?: { id: string; name: string }[];
  bulk?: Record<string, BulkChecklist>;
  stageDefs?: StageDef[];
  tabs?: ReactNode;
  note?: ReactNode;
  empty: ReactNode;
}

const GROUPS_PER_PAGE = 60;

const titleOf = (r: SheetRow) => (r.source === 'thread' ? r.thread_subject || '(no subject)' : r.inquiry || fallbackHeading(r));

function compare(sort: SortState, a: SheetRow, b: SheetRow): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'reply') return (replyRank(a) - replyRank(b)) * dir;
  if (sort.key === 'type') return a.row_kind.localeCompare(b.row_kind) * dir;
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
export function WorkSheet({ rows, pictures, labels, mode, approvalTab, approvals, canApprove, companies, bulk, stageDefs, tabs, note, empty }: Props) {
  const [q, setQ] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [onlyCheck, setOnlyCheck] = useState(false);
  const [kind, setKind] = useState<'all' | 'development' | 'bulk'>('all');
  const [showClosed, setShowClosed] = useState(false);
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
  const checkCount = rows.filter(needsTypeCheck).length;
  const closedCount = rows.filter((r) => r.closed_at).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showClosed && r.closed_at) return false;
      if (kind !== 'all' && r.row_kind !== kind) return false;
      if (onlyWaiting && !isWaiting(r)) return false;
      if (onlyCheck && !needsTypeCheck(r)) return false;
      if (!needle) return true;
      return [r.company_name, r.company_city, r.merchant, r.brand, r.inquiry, r.thread_subject, r.brand_status, r.customer_status, r.grc_status, r.enquiry_ref, ...(r.points ?? []), r.product_code, r.awb, r.po_number, r.summary]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, onlyWaiting, onlyCheck, kind, showClosed]);

  const groups = useMemo(() => {
    const g = groupByCompany(filtered);
    if (sort) for (const grp of g) grp.rows.sort((a, b) => compare(sort, a, b));
    const sorted = sort ? [...g].sort((a, b) => compare(sort, a.rows[0]!, b.rows[0]!)) : g;
    // Each client's rows: one row per enquiry, rows of the same brand subject together.
    return sorted.map((grp) => {
      const { rows: ordered, info } = subjectBlocks(grp.rows);
      return { ...grp, rows: ordered, subjects: info };
    });
  }, [filtered, sort]);
  const shown = groups.slice(0, limit);
  const picsOf = (r: SheetRow): RowPic[] => pictures[r.row_id] ?? [];

  /** Close / reopen one row (an enquiry, a conversation or a product), with Undo. */
  const closeRow = (r: SheetRow) => {
    const target = closeTarget(r);
    const closing = !r.closed_at;
    start(async () => {
      const res = await setRowsClosed(target, closing);
      if (!res.ok) return void toast.error(res.error);
      toast.success(closing ? 'Closed' : 'Reopened', closing ? { action: { label: 'Undo', onClick: () => void setRowsClosed(target, false) } } : undefined);
    });
  };
  /** Close every row of a subject. */
  const closeSubject = (s: SubjectInfo) => {
    const target = mergeTargets(s.rows.filter((r) => !r.closed_at).map(closeTarget));
    start(async () => {
      const res = await setRowsClosed(target, true);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${s.brand}: all ${s.size} closed`, { action: { label: 'Undo', onClick: () => void setRowsClosed(target, false) } });
    });
  };

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
  const stepLabel = (r: SheetRow) => {
    if (r.source !== 'bulk' || !r.item_id) return null;
    const cur = bulk?.[r.item_id]?.current_stage;
    return cur ? stageDefs?.find((d) => d.key === cur)?.label ?? null : null;
  };

  return (
    <>
      <GridCard>
        <GridBar tabs={tabs}>
          <ToggleChip on={onlyWaiting} onChange={setOnlyWaiting} tone="red">
            Reply needed
            <span className={cx('rounded-full px-1.5 text-[12px] font-semibold tabular-nums', onlyWaiting ? 'bg-red text-white' : 'bg-red-soft text-red')}>{waitingCount}</span>
          </ToggleChip>
          {(checkCount > 0 || onlyCheck) && (
            <ToggleChip on={onlyCheck} onChange={setOnlyCheck}>
              To check
              <span className={cx('rounded-full px-1.5 text-[12px] font-semibold tabular-nums', onlyCheck ? 'bg-mustard text-white' : 'bg-mustard-soft text-mustard')}>{checkCount}</span>
            </ToggleChip>
          )}
          <ColumnsMenu
            columns={SHEET_COLUMNS.map((c) => ({ key: c.key, label: label(c, labels), locked: c.key === 'inquiry' }))}
            visible={cols.map((c) => c.key)}
            onChange={setVisible}
            defaults={DEFAULT_COLUMNS[mode]}
          />
          {pickable && groups.length > 1 && (
            <button type="button" className="h-8 rounded-lg px-2 text-[13.5px] font-medium text-indigo hover:bg-indigo-soft" onClick={() => setSelected(new Set(groups.map((g) => g.companyId).filter(Boolean) as string[]))}>
              Select all
            </button>
          )}
          {mode === 'orders' && companies && (
            <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
              <span aria-hidden className="text-[15px] leading-none">+</span> Add inquiry
            </Button>
          )}
          <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search client, brand or inquiry" />
        </GridBar>

        {adding && companies && <AddRow companies={companies} onDone={() => setAdding(false)} />}
        {note}

        {groups.length === 0 ? (
          <div className="flex-1 border-t border-line">
            {q || onlyWaiting || onlyCheck ? (
              <div className="px-5 py-14 text-center">
                <p className="font-medium">Nothing matches</p>
                <button className="mt-2 text-[14px] font-medium text-indigo hover:underline" onClick={() => { setQ(''); setOnlyWaiting(false); setOnlyCheck(false); }}>
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
                      <span className="flex items-center gap-1.5">
                        {c.sortable ? <SortHeader label={label(c, labels)} colKey={c.key} sort={sort} onSort={setSort} /> : label(c, labels)}
                        {c.key === 'type' && (
                          <select
                            aria-label="Show only one type"
                            value={kind}
                            onChange={(e) => setKind(e.target.value as typeof kind)}
                            className={cx('h-6 w-auto rounded-md border px-1 text-[12px] font-medium', kind === 'all' ? 'border-line bg-surface text-muted' : 'border-indigo bg-indigo-soft text-indigo')}
                          >
                            <option value="all">All</option>
                            <option value="development">Development</option>
                            <option value="bulk">Bulk</option>
                          </select>
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="act" style={{ width: 196, minWidth: 196 }}>
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
                        {cols.map((c) => {
                          const subj = g.subjects.get(r.row_id);
                          if (c.key === 'brand' && subj) {
                            if (!subj.first) return null;
                            return (
                              <td key={c.key} rowSpan={subj.size} className="subject" style={{ maxWidth: c.width + 40 }}>
                                <SubjectHeading s={subj} onCloseAll={() => closeSubject(subj)} busy={busy} />
                              </td>
                            );
                          }
                          return (
                          <td
                            key={c.key}
                            style={{ maxWidth: c.width + 40 }}
                            className={cx(['sample_collected', 'picture'].includes(c.key) && 'center', c.key === 'picture' && 'pic')}
                          >
                            {c.key === 'inquiry' ? (
                              <InquiryCell r={r} onOpen={() => setOpenId(r.row_id)} />
                            ) : (
                              <Cell col={c} r={r} pics={picsOf(r)} stepLabel={stepLabel(r)} />
                            )}
                          </td>
                          );
                        })}
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
                            <button
                              type="button"
                              onClick={() => closeRow(r)}
                              disabled={busy}
                              title={r.closed_at ? 'Reopen this row' : 'Close this row (a new customer email reopens it)'}
                              className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] font-medium text-muted transition-colors duration-200 hover:bg-slate-soft hover:text-ink"
                            >
                              {r.closed_at ? 'Reopen' : 'Close'}
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
            {closedCount > 0 && (
              <div className="border-t border-line px-5 py-2.5 text-[13px] text-muted">
                {showClosed ? 'Showing closed rows too. ' : `${closedCount} closed ${closedCount === 1 ? 'row is' : 'rows are'} hidden. `}
                <button type="button" className="font-medium text-indigo hover:underline" onClick={() => setShowClosed((v) => !v)}>
                  {showClosed ? 'Hide closed' : 'Show closed'}
                </button>
              </div>
            )}
            {groups.length > limit && (
              <div className="px-5 py-4">
                <Button onClick={() => setLimit((l) => l + GROUPS_PER_PAGE)}>Show {Math.min(GROUPS_PER_PAGE, groups.length - limit)} more clients</Button>
              </div>
            )}
          </div>
        )}
      </GridCard>

      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 animate-fade-in flex-wrap items-center gap-3 rounded-xl bg-ink px-5 py-3 text-white shadow-[0_12px_32px_rgba(15,23,42,0.3)] lg:ml-[96px]">
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
          checklist={openRow.source === 'bulk' && openRow.item_id ? bulk?.[openRow.item_id] : undefined}
          stageDefs={stageDefs}
          pictures={picsOf(openRow)}
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
      {mode === 'approvals' && id && tab === 'pending' && (
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Set all to
          <select
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-ink-2"
            value=""
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value as 'development' | 'bulk';
              if (v) act(() => setClientType(id, v), `${group.name}: all rows set to ${v === 'bulk' ? 'Bulk' : 'Development'}`);
            }}
          >
            <option value="">choose…</option>
            <option value="development">Development</option>
            <option value="bulk">Bulk</option>
          </select>
        </label>
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

/** "RE: FW: Subject" → "Subject". */
const cleanSubject = (s: string | null) => (s ?? '').replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, '').trim();

/** The merged heading over a subject's rows: brand, type, how many, and Close all. */
function SubjectHeading({ s, onCloseAll, busy }: { s: SubjectInfo; onCloseAll: () => void; busy: boolean }) {
  const open = s.rows.filter((r) => !r.closed_at).length;
  return (
    <div className="sticky top-12 flex flex-col items-start gap-1">
      <span className="text-[14px] font-semibold text-ink">{s.brand}</span>
      <span className="text-[12.5px] text-muted">
        {s.kind === 'bulk' ? 'Bulk' : s.kind === 'development' ? 'Development' : 'Mixed'}
        {s.size > 1 ? ` · ${s.size} ${s.size === 1 ? 'enquiry' : 'enquiries'}` : ''}
      </span>
      {s.size > 1 && open > 0 && (
        <button type="button" onClick={onCloseAll} disabled={busy} className="mt-0.5 text-[12.5px] font-medium text-indigo hover:underline">
          Close all {open}
        </button>
      )}
    </div>
  );
}

/** The Inquiry column: what it's about; a click opens the details panel. */
function InquiryCell({ r, onOpen }: { r: SheetRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group/p block w-full text-left" title="Open the details">
      <span className={cx('line-clamp-2 text-ink group-hover/p:text-indigo group-hover/p:underline group-hover/p:decoration-indigo/30 group-hover/p:underline-offset-2', r.source === 'thread' && 'font-medium')}>
        {r.source === 'thread' ? `${r.is_meeting && !/meeting|call|invite/i.test(r.title ?? '') ? 'Meeting · ' : ''}${r.title || cleanSubject(r.thread_subject) || titleOf(r)}` : titleOf(r)}
      </span>
      {r.source === 'bulk' && (r.po_number || r.qty_mtrs) && (
        <span className="mt-0.5 block text-[13px] text-muted">
          {[r.po_number && `PO ${r.po_number}`, r.qty_mtrs && `${Number(r.qty_mtrs).toLocaleString('en-IN')} mtrs`].filter(Boolean).join(', ')}
        </span>
      )}
      {r.enquiry_ref && r.source === 'thread' && <span className="mt-0.5 block text-[12.5px] text-muted">{r.enquiry_ref}</span>}
      {r.source === 'thread' && r.company_approval === 'approved' && !r.is_read && <span className="mt-1 block text-[12.5px] font-medium text-indigo">AI is reading this now</span>}
    </button>
  );
}

/** What closing a row covers: that product, or that conversation. */
function closeTarget(r: SheetRow): CloseTarget {
  if (r.source === 'item' && r.item_id) return { devItems: [r.item_id] };
  if (r.source === 'bulk' && r.item_id) return { bulkOrders: [r.item_id] };
  return { threads: r.thread_id ? [r.thread_id] : [] };
}
function mergeTargets(ts: CloseTarget[]): CloseTarget {
  return { threads: ts.flatMap((t) => t.threads ?? []), devItems: ts.flatMap((t) => t.devItems ?? []), bulkOrders: ts.flatMap((t) => t.bulkOrders ?? []) };
}

/** What one side said last, and when. */
function SaidCell({ text, at, empty, alert }: { text: string | null; at: string | null; empty: string; alert?: boolean }) {
  if (!text) return <span className={cx('text-[13px]', alert ? 'font-medium text-red' : 'text-faint')}>{empty}</span>;
  return (
    <span className="block text-[13px] leading-snug">
      <span className="line-clamp-3 text-ink-2">{text}</span>
      {at && <span className="mt-0.5 block text-[12px] text-muted">{shortDate(at)}</span>}
    </span>
  );
}

/** Any other cell. Rows that are items or orders can be typed into; conversations are read-only. */
function Cell({ col, r, pics, stepLabel }: { col: SheetColumn; r: SheetRow; pics: RowPic[]; stepLabel?: string | null }) {
  switch (col.key) {
    case 'picture':
      return <Thumbs pics={pics} />;
    case 'type':
      return <TypeCell info={typeInfo(r)} />;
    case 'reply':
      return <ReplyCell state={r.reply_state} waitingOn={r.waiting_on} dueAt={r.reply_due_at} />;
    case 'last_email':
      return <span className="whitespace-nowrap text-[13.5px] text-muted">{shortDate(r.last_at)}</span>;
    case 'customer_reply':
      return <SaidCell text={r.customer_status} at={r.customer_on ?? r.last_in_at} empty="—" />;
    case 'grc_reply':
      return (
        <div className="flex flex-col items-start gap-1">
          {r.source === 'bulk' && r.stage && r.stage !== 'open' && <BulkStatusText status={r.stage} />}
          {r.source === 'bulk' && stepLabel && <span className="text-[13px] text-muted">Latest step: {stepLabel}</span>}
          {(r.reply_state === 'awaiting' || r.awaiting_grc) && !r.closed_at ? (
            <span className="block text-[13px] leading-snug">
              <span className="font-semibold text-red">Pending</span>
              {(r.customer_on || r.last_in_at) && <span className="mt-0.5 block text-[12px] text-muted">customer wrote {shortDate(r.customer_on ?? r.last_in_at)}</span>}
            </span>
          ) : (
            <SaidCell text={r.grc_status} at={r.grc_on ?? r.last_out_at} empty="—" />
          )}
        </div>
      );
  }
  if (r.source === 'thread') {
    if (col.key === 'merchant_name') return <span>{r.merchant ?? ''}</span>;
    if (col.key === 'brand') return <span className="font-medium">{r.brand ?? ''}</span>;
    if (col.key === 'enquiry_date') return <span className="text-muted">{shortDate(r.enquiry_date)}</span>;
    if (col.key === 'price_quoted' || col.key === 'sample_status') return <span>{cellValue(r, col.key) ?? ''}</span>;
    return null;
  }
  if (r.source === 'bulk') {
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
