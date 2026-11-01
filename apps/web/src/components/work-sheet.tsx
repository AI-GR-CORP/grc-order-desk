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
import { BulkStatusText, EmailLinks, GridCard, ReplyCell, SearchBox, shortDate, Thumbs, ToggleChip, TypeChip } from './sheet';
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
  tabs?: ReactNode;
  note?: ReactNode;
  empty: ReactNode;
}

const GROUPS_PER_PAGE = 60;

/**
 * GRC's sheet: one row per inquiry or conversation, the client's name in a yellow cell
 * merged down its rows, GRC's own column names, plus Type / Reply / Last email / Email.
 */
export function WorkSheet({ rows, thumbnails, labels, mode, approvalTab, approvals, canApprove, companies, tabs, note, empty }: Props) {
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
    <GridCard>
      {tabs}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <ToggleChip on={onlyWaiting} onChange={setOnlyWaiting} tone="red">
          Waiting for our reply
          <span className={cx('rounded-full px-1.5 text-[12px] font-semibold tabular-nums', onlyWaiting ? 'bg-red text-white' : 'bg-red-soft text-red')}>{waitingCount}</span>
        </ToggleChip>
        {mode !== 'approvals' && (
          <ToggleChip on={more} onChange={setMore}>
            More columns
          </ToggleChip>
        )}
        {pickable && groups.length > 1 && (
          <button className="h-9 px-2 text-[13.5px] font-medium text-indigo hover:underline" onClick={() => setSelected(new Set(groups.map((g) => g.companyId).filter(Boolean) as string[]))}>
            Select all {groups.length}
          </button>
        )}
        {mode === 'development' && companies && (
          <Button size="sm" variant="secondary" className="h-9" onClick={() => setAdding((a) => !a)}>
            <span aria-hidden className="text-[16px] leading-none">+</span> Add a row
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[13px] text-muted">
            {filtered.length} {filtered.length === 1 ? 'row' : 'rows'}
            {showCompany && `, ${groups.length} ${groups.length === 1 ? 'client' : 'clients'}`}
          </span>
          <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, brand, inquiry" />
        </div>
      </div>

      {adding && companies && <AddRow companies={companies} onDone={() => setAdding(false)} />}
      {note}

      {groups.length === 0 ? (
        <div className="flex-1 border-t border-line">{q || onlyWaiting ? <p className="px-5 py-12 text-center text-[14px] text-muted">Nothing matches. Clear the search box or switch off the filter.</p> : empty}</div>
      ) : (
        <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
          <table className="sheet">
            <thead>
              <tr>
                <th className="rn" aria-label="Row" />
                {showCompany && <th className="co">{COMPANY_LABEL}</th>}
                {showCompany && <th style={{ minWidth: 90 }}>{CITY_LABEL}</th>}
                {cols.map((c) => (
                  <th key={c.key} className={cx(['sample_collected', 'picture'].includes(c.key) && 'center')} style={{ width: c.width, minWidth: c.width, maxWidth: c.width + 40 }}>
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
                    <tr key={r.row_id} className={cx(i === g.rows.length - 1 && 'group-last')}>
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
                        <td key={c.key} style={{ maxWidth: c.width + 40 }} className={cx(['sample_collected', 'picture'].includes(c.key) && 'center', c.key === 'picture' && 'pic')}>
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
        <div className="fixed bottom-6 left-1/2 z-40 flex w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl bg-ink px-5 py-3 text-white shadow-[0_12px_32px_rgba(27,34,54,0.28)] lg:ml-[124px]">
          <span className="text-[14px]">
            <span className="font-semibold">{selected.size} {selected.size === 1 ? 'client' : 'clients'} selected</span>
            <span className="text-white/70">, {selectedInfo.n} conversations, about ${selectedInfo.cost.toFixed(2)} to read</span>
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" disabled={busy} onClick={() => act(() => setClientApproval([...selected], 'rejected'), `Ignored ${selected.size}`, () => setSelected(new Set()))}>
              Ignore {selected.size}
            </Button>
            <Button size="sm" variant="primary" className="bg-white text-ink hover:bg-white/90" disabled={busy} onClick={() => act(() => setClientApproval([...selected], 'approved'), `Approved ${selected.size}. Reading their emails now.`, () => setSelected(new Set()))}>
              Approve {selected.size}
            </Button>
          </div>
        </div>
      )}
    </GridCard>
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
    <Link href={`/clients/${id}`} className="block text-[14px] font-semibold leading-snug text-ink hover:text-indigo">
      {group.name}
    </Link>
  ) : (
    <span className="block text-[14px] font-semibold leading-snug text-ink">{group.name}</span>
  );
  const meta = (
    <span className="mt-0.5 block text-[12.5px] text-muted">
      {group.rows.length} {group.rows.length === 1 ? 'row' : 'rows'}
      {group.region ? `, ${group.region}` : ''}
    </span>
  );
  if (mode !== 'approvals' || !id)
    return (
      <div>
        {name}
        {meta}
      </div>
    );

  return (
    <div className="flex flex-col items-start gap-2.5">
      <div className="flex items-start gap-2.5">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[#3446a8]"
            aria-label={`Select ${group.name}`}
          />
        )}
        <div>
          {name}
          <span className="mt-0.5 block text-[12.5px] text-muted">
            {group.rows.length} {group.rows.length === 1 ? 'conversation' : 'conversations'}
            {info ? `, about $${info.cost.toFixed(2)} to read` : ''}
          </span>
        </div>
      </div>
      {canApprove && tab === 'pending' && (
        <>
          <div className="flex gap-1.5 pl-[26px]">
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
        <Button size="sm" variant="ghost" className="-ml-2" disabled={busy} onClick={() => act(() => setClientApproval([id], 'pending'), 'Moved back to waiting')}>
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
      return <span className="whitespace-nowrap text-[13px] text-muted">{shortDate(r.last_at)}</span>;
    case 'email':
      return <EmailLinks threadId={r.thread_id} emailCount={r.email_count} gmailThreadId={r.gmail_thread_id} mailboxEmail={r.mailbox_email} />;
  }

  if (r.source === 'thread') {
    if (col.key === 'merchant_name') return <span>{r.merchant ?? ''}</span>;
    if (col.key === 'inquiry')
      return (
        <div>
          <div className="font-medium text-ink">{r.thread_subject || '(no subject)'}</div>
          {r.summary && <div className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-muted">{r.summary}</div>}
          {r.company_approval === 'approved' && !r.is_read && <div className="mt-1 text-[12px] text-indigo">AI is reading this now</div>}
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
          <div className="px-1 text-[12.5px] text-muted">{[r.po_number && `PO ${r.po_number}`, r.qty_mtrs && `${Number(r.qty_mtrs).toLocaleString('en-IN')} mtrs`].filter(Boolean).join(', ')}</div>
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
      className="flex flex-wrap items-end gap-2 border-y border-line bg-indigo-soft/50 px-5 py-3"
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
