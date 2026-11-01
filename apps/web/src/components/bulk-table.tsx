'use client';
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { BULK_STATUSES, type BulkOrderView, type BulkStageDefRow } from '@grc/core';
import { setBulkStage, updateBulkField } from '@/app/actions/items';
import { cx } from '@/lib/format';
import { EditableCell } from './editable-cell';
import { BulkStatusChip } from './stage';
import { Empty, inputClass } from './ui';

const STATUS_OPTIONS = BULK_STATUSES.map((s) => ({ value: s.key, label: s.label }));

/** Tripti's bulk checklist, turned sideways: one row per order, one column per checklist step. */
export function BulkTable({ rows, stages }: { rows: BulkOrderView[]; stages: BulkStageDefRow[] }) {
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [showOptional, setShowOptional] = useState(true);

  const cols = showOptional ? stages : stages.filter((s) => !s.optional);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showDone && (r.status === 'completed' || r.status === 'cancelled')) return false;
      if (!needle) return true;
      return [r.company_name, r.brand, r.product_code, r.po_number, r.pi_number, r.description].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, showDone]);

  const groups = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; items: BulkOrderView[] }>();
    for (const r of filtered) {
      const k = r.company_id ?? 'none';
      const g = m.get(k) ?? { id: r.company_id, name: r.company_name ?? 'No company yet', items: [] };
      g.items.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const field = (id: string, f: string) => (v: string | null) => updateBulkField(id, f, v);
  const stageSave = (id: string, key: string) => (v: string | null) => setBulkStage(id, key, v);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3 lg:px-8">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, code, PO, PI…" className={cx(inputClass, 'max-w-72')} aria-label="Search" />
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
        </label>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={showOptional} onChange={(e) => setShowOptional(e.target.checked)} /> Garment approvals and LC
        </label>
        <span className="ml-auto text-[12.5px] text-muted">{filtered.length} orders</span>
      </div>
      {groups.length === 0 ? (
        <Empty title="No bulk orders here yet">Orders appear when a PI or PO shows up in the mailbox, or when they’re imported from the old sheet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="sheet-cell w-max min-w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-ground text-left text-[12px] text-muted">
              <tr>
                {['Brand', 'Product code', 'Qty (mtrs)', 'Status'].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-medium">{h}</th>
                ))}
                {cols.map((s) => (
                  <th key={s.key} className="min-w-28 border-b border-line px-2 py-2 font-medium">{s.label}</th>
                ))}
                <th className="min-w-52 border-b border-line px-2 py-2 font-medium">Next action</th>
                <th className="min-w-52 border-b border-line px-2 py-2 font-medium">Owner remark</th>
                <th className="border-b border-line px-2 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.id ?? 'none'}>
                  <tr>
                    <td colSpan={cols.length + 7} className="border-b border-line-2 bg-surface px-2 pb-2 pt-4 font-sans">
                      {g.id ? <Link href={`/clients/${g.id}`} className="text-[14.5px] font-semibold hover:underline">{g.name}</Link> : <span className="text-[14.5px] font-semibold text-muted">{g.name}</span>}
                    </td>
                  </tr>
                  {g.items.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-indigo-soft/25">
                      <td className="border-b border-line-2 px-1 py-1"><EditableCell value={r.brand} onSave={field(r.id, 'brand')} locked={r.locked_fields.includes('brand')} /></td>
                      <td className="border-b border-line-2 px-1 py-1"><EditableCell value={r.product_code} onSave={field(r.id, 'product_code')} locked={r.locked_fields.includes('product_code')} /></td>
                      <td className="border-b border-line-2 px-1 py-1"><EditableCell value={r.qty_mtrs == null ? null : String(r.qty_mtrs)} onSave={field(r.id, 'qty_mtrs')} locked={r.locked_fields.includes('qty_mtrs')} /></td>
                      <td className="border-b border-line-2 px-1 py-1">
                        <EditableCell value={r.status} kind="select" options={STATUS_OPTIONS} onSave={field(r.id, 'status')} display={<BulkStatusChip status={r.status} />} />
                      </td>
                      {cols.map((s) => {
                        const v = r.stages[s.key];
                        const isCurrent = r.current_stage === s.key;
                        return (
                          <td key={s.key} className={cx('border-b border-line-2 px-1 py-1', isCurrent && 'bg-teal-soft/60')}>
                            <EditableCell value={v?.value ?? null} onSave={stageSave(r.id, s.key)} locked={v?.locked} placeholder="·" className={v?.value ? 'text-teal' : undefined} />
                          </td>
                        );
                      })}
                      <td className="border-b border-line-2 px-1 py-1"><EditableCell kind="longtext" value={r.next_action} onSave={field(r.id, 'next_action')} locked={r.locked_fields.includes('next_action')} /></td>
                      <td className="border-b border-line-2 px-1 py-1"><EditableCell kind="longtext" value={r.owner_remark} onSave={field(r.id, 'owner_remark')} /></td>
                      <td className="border-b border-line-2 px-2 py-1.5">
                        {r.primary_thread_id ? <Link href={`/threads/${r.primary_thread_id}`} className="text-[12.5px] text-indigo hover:underline">Thread</Link> : <span className="text-[11.5px] text-muted">{r.source === 'sheet_import' ? 'from old sheet' : ''}</span>}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
