'use client';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { columnLabel, DEV_COLUMNS, DEV_STAGE_CLOSED, DEV_STAGES, type DevItemView } from '@grc/core';
import { addDevItem, updateDevField } from '@/app/actions/items';
import { cx, fmtDate } from '@/lib/format';
import { EditableCell } from './editable-cell';
import { ReplyBadge, Selvedge, StageChip } from './stage';
import { Button, Empty, inputClass } from './ui';

const STAGE_OPTIONS = DEV_STAGES.map((s) => ({ value: s.key, label: s.label }));
const PAGE = 40;

interface Props {
  rows: DevItemView[];
  thumbnails: Record<string, string[]>;
  labels: Record<string, string>;
  companies: { id: string; name: string }[];
  nonMovingDays: number;
  initialView: 'open' | 'all' | 'non-moving';
}

/** GRC's development sheet: one row per item, grouped under the company like the workbook. */
export function DevTable({ rows, thumbnails, labels, companies, nonMovingDays, initialView }: Props) {
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [stage, setStage] = useState('');
  const [view, setView] = useState(initialView);
  const [waitingOnUs, setWaitingOnUs] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);

  const regions = useMemo(() => [...new Set(rows.map((r) => r.company_region).filter(Boolean))].sort() as string[], [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cutoff = Date.now() - nonMovingDays * 86_400_000;
    return rows.filter((r) => {
      if (view === 'open' && DEV_STAGE_CLOSED.includes(r.stage)) return false;
      if (view === 'non-moving') {
        if (DEV_STAGE_CLOSED.includes(r.stage) || r.stage === 'on_hold') return false;
        if (new Date(r.last_activity_at ?? r.created_at).getTime() > cutoff) return false;
      }
      if (region && r.company_region !== region) return false;
      if (stage && r.stage !== stage) return false;
      if (waitingOnUs && r.thread_waiting_on !== 'us' && r.thread_reply_state !== 'awaiting') return false;
      if (!needle) return true;
      return [r.company_name, r.brand, r.inquiry, r.product_code, r.merchant_name, r.team_status, r.awb]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, region, stage, view, waitingOnUs, nonMovingDays]);

  const groups = useMemo(() => {
    const map = new Map<string, { id: string | null; name: string; region: string | null; city: string | null; items: DevItemView[]; last: number }>();
    for (const r of filtered) {
      const key = r.company_id ?? 'none';
      const g = map.get(key) ?? { id: r.company_id, name: r.company_name ?? 'No company yet', region: r.company_region, city: r.company_city, items: [], last: 0 };
      g.items.push(r);
      g.last = Math.max(g.last, new Date(r.last_activity_at ?? r.created_at).getTime());
      map.set(key, g);
    }
    for (const g of map.values()) g.items.sort((a, b) => (b.enquiry_date ?? '').localeCompare(a.enquiry_date ?? ''));
    return [...map.values()].sort((a, b) => b.last - a.last);
  }, [filtered]);

  const save = (id: string, field: string) => (v: string | null) => updateDevField(id, field, v);
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    fn(n);
  };
  const colCount = DEV_COLUMNS.length + 3;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-3 lg:px-8">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company, brand, code, AWB…"
          className={cx(inputClass, 'max-w-72')}
          aria-label="Search"
        />
        <select value={view} onChange={(e) => setView(e.target.value as Props['initialView'])} className={cx(inputClass, 'w-auto')} aria-label="Which items">
          <option value="open">Open items</option>
          <option value="non-moving">Not moving ({nonMovingDays}+ days)</option>
          <option value="all">All items</option>
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={cx(inputClass, 'w-auto')} aria-label="Stage">
          <option value="">Any stage</option>
          {STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={cx(inputClass, 'w-auto')} aria-label="Region">
          <option value="">All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={waitingOnUs} onChange={(e) => setWaitingOnUs(e.target.checked)} />
          Waiting on us
        </label>
        <span className="ml-auto text-[12.5px] text-muted">{filtered.length} items, {groups.length} companies</span>
        <Button size="sm" onClick={() => setAdding((a) => !a)}>Add inquiry</Button>
      </div>

      {adding && <AddInquiry companies={companies} onDone={() => setAdding(false)} />}

      {groups.length === 0 ? (
        <Empty title="Nothing matches these filters">Clear the search or pick “All items” to see closed and approved work too.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="sheet-cell w-max min-w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-ground text-left text-[12px] text-muted">
              <tr>
                <th className="w-8 border-b border-line px-2 py-2" />
                <th className="border-b border-line px-2 py-2 font-medium">Picture</th>
                {DEV_COLUMNS.map((c) => (
                  <th key={c.key} style={{ minWidth: c.width }} className="border-b border-line px-2 py-2 font-medium" title={`Sheet: ${c.sheet}`}>
                    {columnLabel(c, labels)}
                  </th>
                ))}
                <th className="border-b border-line px-2 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {groups.slice(0, limit).map((g) => {
                const key = g.id ?? 'none';
                const isCollapsed = collapsed.has(key);
                const awaiting = g.items.filter((i) => i.thread_reply_state === 'awaiting').length;
                return (
                  <Fragment key={key}>
                    <tr className="bg-surface">
                      <td colSpan={colCount} className="border-b border-line-2 px-2 pb-2 pt-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <button
                            onClick={() => toggle(collapsed, key, setCollapsed)}
                            className="text-[12px] text-muted hover:text-ink"
                            aria-expanded={!isCollapsed}
                            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                          >
                            {isCollapsed ? '▸' : '▾'}
                          </button>
                          {g.id ? (
                            <Link href={`/clients/${g.id}`} className="font-sans text-[14.5px] font-semibold hover:underline">{g.name}</Link>
                          ) : (
                            <span className="font-sans text-[14.5px] font-semibold text-muted">{g.name}</span>
                          )}
                          <span className="text-[12.5px] text-muted">{[g.city, g.region].filter(Boolean).join(', ')}</span>
                          <span className="text-[12.5px] text-muted">{g.items.length} {g.items.length === 1 ? 'item' : 'items'}</span>
                          {awaiting > 0 && <span className="rounded bg-red-soft px-1.5 text-[12px] font-medium text-red">{awaiting} need reply</span>}
                          <Selvedge stages={g.items.map((i) => i.stage)} className="w-40" />
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed &&
                      g.items.map((r) => {
                        const open = expanded.has(r.id);
                        const pics = r.primary_thread_id ? thumbnails[r.primary_thread_id] ?? [] : [];
                        return (
                          <Fragment key={r.id}>
                            <tr className="align-top hover:bg-indigo-soft/25">
                              <td className="border-b border-line-2 px-2 py-1.5">
                                <button
                                  onClick={() => toggle(expanded, r.id, setExpanded)}
                                  className="text-[12px] text-muted hover:text-ink"
                                  aria-label={open ? 'Hide summary' : 'Show summary'}
                                  aria-expanded={open}
                                >
                                  {open ? '−' : '+'}
                                </button>
                              </td>
                              <td className="border-b border-line-2 px-2 py-1.5">
                                <div className="flex gap-1">
                                  {pics.slice(0, 2).map((src) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="Customer photo or swatch" className="size-9 rounded object-cover" /></a>
                                  ))}
                                </div>
                              </td>
                              {DEV_COLUMNS.map((c) => {
                                const raw = (r as unknown as Record<string, string | null>)[c.key] ?? null;
                                return (
                                  <td key={c.key} className="border-b border-line-2 px-1 py-1" style={{ maxWidth: c.width + 80 }}>
                                    <EditableCell
                                      value={raw}
                                      onSave={save(r.id, c.key)}
                                      locked={r.locked_fields.includes(c.key)}
                                      kind={c.kind === 'stage' ? 'select' : c.kind === 'select' ? 'select' : c.kind === 'longtext' ? 'longtext' : c.kind === 'date' ? 'date' : 'text'}
                                      options={c.kind === 'stage' ? STAGE_OPTIONS : c.options?.map((o) => ({ value: o, label: o }))}
                                      display={c.kind === 'stage' ? <StageChip stage={r.stage} /> : c.kind === 'date' && raw ? fmtDate(raw) : undefined}
                                    />
                                  </td>
                                );
                              })}
                              <td className="border-b border-line-2 px-2 py-1.5">
                                <div className="flex flex-col items-start gap-1">
                                  <ReplyBadge state={r.thread_reply_state} />
                                  {r.primary_thread_id && (
                                    <Link href={`/threads/${r.primary_thread_id}`} className="text-[12.5px] text-indigo hover:underline">
                                      {r.thread_count > 1 ? `${r.thread_count} threads` : 'Thread'}
                                    </Link>
                                  )}
                                  {r.source === 'sheet_import' && <span className="text-[11.5px] text-muted">from old sheet</span>}
                                  {r.source === 'manual' && <span className="text-[11.5px] text-muted">added by hand</span>}
                                </div>
                              </td>
                            </tr>
                            {open && (
                              <tr>
                                <td />
                                <td colSpan={colCount - 1} className="border-b border-line-2 bg-ground/60 px-3 py-2.5 font-sans text-[13px]">
                                  <p className="max-w-3xl">{r.summary ?? 'No summary yet. It appears after the AI reads this item’s emails.'}</p>
                                  {r.thread_subject && <p className="mt-1 text-[12.5px] text-muted">Latest thread: {r.thread_subject}</p>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {groups.length > limit && (
            <div className="px-6 py-4 lg:px-8">
              <Button onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, groups.length - limit)} more companies</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddInquiry({ companies, onDone }: { companies: { id: string; name: string }[]; onDone: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [brand, setBrand] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-b border-line bg-indigo-soft/40 px-6 py-3 lg:px-8"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await addDevItem(companyId || null, inquiry, brand || null);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success('Inquiry added');
        onDone();
      }}
    >
      <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={cx(inputClass, 'w-56')} aria-label="Company">
        <option value="">Company…</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" className={cx(inputClass, 'w-36')} aria-label="Brand" />
      <input value={inquiry} onChange={(e) => setInquiry(e.target.value)} placeholder="What do they need? e.g. 30MM knitted elastic, 4 combos" className={cx(inputClass, 'min-w-72 flex-1')} aria-label="Inquiry" required />
      <Button type="submit" variant="primary" disabled={busy}>Add inquiry</Button>
      <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}
