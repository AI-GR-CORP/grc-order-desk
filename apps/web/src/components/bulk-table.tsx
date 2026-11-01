'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BULK_STATUSES, type BulkOrderView, type BulkStageDefRow } from '@grc/core';
import { setBulkStage, updateBulkField } from '@/app/actions/items';
import { cx } from '@/lib/format';
import { COMPANY_LABEL } from '@/lib/sheet';
import { EditableCell } from './editable-cell';
import { BulkStatusText, GridCard, SearchBox, SheetTabs, ToggleChip } from './sheet';
import { Empty } from './ui';

const STATUS_OPTIONS = BULK_STATUSES.map((s) => ({ value: s.key, label: s.label }));
const DONE = new Set(['completed', 'cancelled']);

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
  let rowNo = 0;

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
                <th className="rn" aria-label="Row" />
                <th className="co">{COMPANY_LABEL}</th>
                <th style={{ minWidth: 110 }}>Brand</th>
                <th style={{ minWidth: 120 }}>Product code</th>
                <th style={{ minWidth: 90 }}>Qty (mtrs)</th>
                <th style={{ minWidth: 120 }}>Status</th>
                {cols.map((s) => (
                  <th key={s.key} style={{ minWidth: 112 }}>{s.label}</th>
                ))}
                <th style={{ minWidth: 200 }}>Work to be done</th>
                <th style={{ minWidth: 200 }}>Yash remark</th>
                <th style={{ minWidth: 90 }}>Email</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.items.map((r, i) => {
                  rowNo++;
                  return (
                    <tr key={r.id} className={cx(i === g.items.length - 1 && 'group-last')}>
                      <td className="rn">{rowNo}</td>
                      {i === 0 && (
                        <td className={cx('co', !g.id && 'unknown')} rowSpan={g.items.length}>
                          {g.id ? <Link href={`/clients/${g.id}`} className="font-semibold hover:text-indigo">{g.name}</Link> : <span className="font-semibold">{g.name}</span>}
                          <span className="mt-0.5 block text-[12.5px] text-muted">{g.items.length} {g.items.length === 1 ? 'order' : 'orders'}</span>
                        </td>
                      )}
                      <td><EditableCell value={r.brand} onSave={field(r.id, 'brand')} locked={r.locked_fields.includes('brand')} /></td>
                      <td><EditableCell value={r.product_code} onSave={field(r.id, 'product_code')} locked={r.locked_fields.includes('product_code')} /></td>
                      <td><EditableCell value={r.qty_mtrs == null ? null : String(r.qty_mtrs)} onSave={field(r.id, 'qty_mtrs')} locked={r.locked_fields.includes('qty_mtrs')} /></td>
                      <td><EditableCell value={r.status} kind="select" options={STATUS_OPTIONS} onSave={field(r.id, 'status')} display={<BulkStatusText status={r.status} />} /></td>
                      {cols.map((s) => {
                        const v = r.stages[s.key];
                        return (
                          <td key={s.key} className={cx(r.current_stage === s.key && 'bg-indigo-soft!')}>
                            <EditableCell value={v?.value ?? null} onSave={stageSave(r.id, s.key)} locked={v?.locked} className={v?.value ? 'font-medium text-teal' : undefined} />
                          </td>
                        );
                      })}
                      <td><EditableCell kind="longtext" value={r.next_action} onSave={field(r.id, 'next_action')} locked={r.locked_fields.includes('next_action')} /></td>
                      <td><EditableCell kind="longtext" value={r.owner_remark} onSave={field(r.id, 'owner_remark')} /></td>
                      <td>
                        {r.primary_thread_id ? (
                          <Link href={`/threads/${r.primary_thread_id}`} className="text-[13px] font-medium text-indigo hover:underline">Emails</Link>
                        ) : (
                          <span className="text-[12px] text-muted">{r.source === 'sheet_import' ? 'from old sheet' : ''}</span>
                        )}
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
