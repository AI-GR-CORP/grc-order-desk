'use client';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { BULK_STATUSES, type BulkOrderView, type BulkStageDefRow } from '@grc/core';
import { setBulkStage, updateBulkField } from '@/app/actions/items';
import { cx } from '@/lib/format';
import { EditableCell } from './editable-cell';
import { BulkStatusText, GridCard, SearchBox, SheetTabs, ToggleChip } from './sheet';
import { Empty } from './ui';

const STATUS_OPTIONS = BULK_STATUSES.map((s) => ({ value: s.key, label: s.label }));
const DONE = new Set(['completed', 'cancelled']);
const prefixed = (p: string, v: string | null) => (!v ? null : v.toUpperCase().startsWith(p) ? v : `${p} ${v}`);

/** Tripti's bulk checklist, one row per order under the client, one column per checklist step. */
export function BulkTable({ rows, stages }: { rows: BulkOrderView[]; stages: BulkStageDefRow[] }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [showOptional, setShowOptional] = useState(false);

  const cols = showOptional ? stages : stages.filter((s) => !s.optional);
  const inTab = rows.filter((r) => (tab === 'done' ? DONE.has(r.status) : !DONE.has(r.status)));
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inTab.filter((r) => !needle || [r.company_name, r.brand, r.product_code, r.po_number, r.pi_number, r.description].some((v) => v?.toLowerCase().includes(needle)));
  }, [inTab, q]);

  const groups = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; items: BulkOrderView[] }>();
    for (const r of filtered) {
      const k = r.company_id ?? 'none';
      const g = m.get(k) ?? { id: r.company_id, name: r.company_name ?? 'Client not known yet', items: [] };
      g.items.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const field = (id: string, f: string) => (v: string | null) => updateBulkField(id, f, v);
  const stageSave = (id: string, key: string) => (v: string | null) => setBulkStage(id, key, v);

  return (
    <GridCard>
      <SheetTabs
        tabs={[
          { key: 'open', label: 'In progress', count: rows.filter((r) => !DONE.has(r.status)).length, active: tab === 'open', onClick: () => setTab('open') },
          { key: 'done', label: 'Finished', count: rows.filter((r) => DONE.has(r.status)).length, active: tab === 'done', onClick: () => setTab('done') },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <ToggleChip on={showOptional} onChange={setShowOptional}>Garment approval and LC steps</ToggleChip>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[13px] text-muted">{filtered.length} orders</span>
          <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, code, PO, PI" />
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="flex-1 border-t border-line">
          <Empty title={tab === 'done' ? 'No finished orders yet' : 'No bulk orders in progress'}>
            Orders appear when a PI or PO arrives from an approved client.
          </Empty>
        </div>
      ) : (
        <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
          <table className="sheet">
            <thead>
              <tr>
                <th className="primary" style={{ width: 280, minWidth: 280 }}>Order</th>
                <th style={{ minWidth: 140 }}>Status</th>
                <th style={{ minWidth: 110 }}>Qty (mtrs)</th>
                {cols.map((s) => (
                  <th key={s.key} style={{ minWidth: 124 }}>{s.label}</th>
                ))}
                <th style={{ minWidth: 200 }}>Work to be done</th>
                <th style={{ minWidth: 200 }}>Yash remark</th>
                <th className="act" style={{ width: 96, minWidth: 96 }}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.id ?? 'none'}>
                  <tr className="group">
                    <td colSpan={cols.length + 6}>
                      <div className="group-inner">
                        {g.id ? (
                          <Link href={`/clients/${g.id}`} className="text-[15px] font-semibold text-ink hover:text-indigo">{g.name}</Link>
                        ) : (
                          <span className="text-[15px] font-semibold">{g.name}</span>
                        )}
                        <span className="rounded-full bg-slate-soft px-2 py-[1px] text-[12.5px] font-medium text-muted">
                          {g.items.length} {g.items.length === 1 ? 'order' : 'orders'}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {g.items.map((r) => (
                    <tr key={r.id} className="row">
                      <td className="primary" style={{ maxWidth: 280 }}>
                        <div className="space-y-0.5">
                          <EditableCell value={r.brand} onSave={field(r.id, 'brand')} locked={r.locked_fields.includes('brand')} placeholder="Add brand" display={r.brand ? <span className="font-medium">{r.brand}</span> : undefined} />
                          <EditableCell value={r.product_code} onSave={field(r.id, 'product_code')} locked={r.locked_fields.includes('product_code')} placeholder="Add product code" display={r.product_code ? <span className="text-[13px] text-muted">{r.product_code}</span> : undefined} />
                          {(r.po_number || r.pi_number) && (
                            <div className="text-[13px] text-muted">{[prefixed('PI', r.pi_number), prefixed('PO', r.po_number)].filter(Boolean).join(', ')}</div>
                          )}
                        </div>
                      </td>
                      <td><EditableCell value={r.status} kind="select" options={STATUS_OPTIONS} onSave={field(r.id, 'status')} display={<BulkStatusText status={r.status} />} /></td>
                      <td><EditableCell value={r.qty_mtrs == null ? null : String(r.qty_mtrs)} onSave={field(r.id, 'qty_mtrs')} locked={r.locked_fields.includes('qty_mtrs')} /></td>
                      {cols.map((s) => {
                        const v = r.stages[s.key];
                        const current = r.current_stage === s.key;
                        return (
                          <td key={s.key} className={cx(current && 'bg-indigo-soft!')}>
                            <EditableCell
                              value={v?.value ?? null}
                              onSave={stageSave(r.id, s.key)}
                              locked={v?.locked}
                              display={v?.value ? <span className={current ? 'font-semibold text-indigo' : 'font-medium text-green'}>{v.value}</span> : undefined}
                            />
                          </td>
                        );
                      })}
                      <td><EditableCell kind="longtext" value={r.next_action} onSave={field(r.id, 'next_action')} locked={r.locked_fields.includes('next_action')} /></td>
                      <td><EditableCell kind="longtext" value={r.owner_remark} onSave={field(r.id, 'owner_remark')} /></td>
                      <td className="act">
                        {r.primary_thread_id ? (
                          <Link href={`/threads/${r.primary_thread_id}`} className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-[13px] font-medium text-ink-2 hover:border-indigo/40 hover:text-indigo">Emails</Link>
                        ) : (
                          <span className="text-[12.5px] text-muted">{r.source === 'sheet_import' ? 'From old sheet' : ''}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GridCard>
  );
}
