import { DEV_STAGE_CLOSED, type BulkOrderView, type BulkStageDefRow } from '@grc/core';
import { SheetPage, SheetTabs, type TabItem } from '@/components/sheet';
import { buttonClass, Empty, PageHeader, Stats } from '@/components/ui';
import { WorkSheet, type BulkChecklist } from '@/components/work-sheet';
import { fetchAll, getSettings, getThumbnails } from '@/lib/data';
import { isWaiting, type SheetRow } from '@/lib/sheet';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Orders' };

const BULK_DONE = ['completed', 'cancelled'];
const closed = (r: SheetRow) =>
  r.source === 'bulk' ? BULK_DONE.includes(r.stage ?? '') : r.stage !== null && (DEV_STAGE_CLOSED as readonly string[]).includes(r.stage);

/** Development inquiries and bulk orders in one sheet; the Type column tells them apart. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'all' } = await searchParams;
  const supabase = await createSupabase();
  const [fetched, settings, companies, bulkRows, stageDefs] = await Promise.all([
    fetchAll<SheetRow>((a, b) => supabase.from('v_sheet_rows').select('*').order('row_id').range(a, b)),
    getSettings(supabase),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).eq('approval', 'approved').order('name').range(a, b)),
    fetchAll<Pick<BulkOrderView, 'id' | 'stages' | 'current_stage'>>((a, b) => supabase.from('v_bulk_orders').select('id, stages, current_stage').order('id').range(a, b)),
    supabase.from('bulk_stage_def').select('*').order('sort_order'),
  ]);

  // Items and bulk orders (not of ignored clients), plus approved clients' conversations that aren't a row yet.
  const all = fetched.filter((r) =>
    r.source === 'thread' ? r.company_approval === 'approved' : r.company_approval !== 'rejected',
  );
  const cutoff = Date.now() - settings.non_moving_days * 86_400_000;
  const open = all.filter((r) => !closed(r));
  const notMoving = open.filter((r) => r.stage !== 'on_hold' && (r.last_at ? new Date(r.last_at).getTime() : 0) < cutoff);
  const regions = [...new Set(open.map((r) => r.company_region).filter(Boolean) as string[])].sort();

  const tabs: (TabItem & { rows: SheetRow[] })[] = [
    { key: 'all', label: 'All open', rows: open, active: false },
    ...regions.map((reg) => ({ key: `region:${reg}`, label: reg, rows: open.filter((r) => r.company_region === reg), active: false })),
    { key: 'not-moving', label: `Not moving ${settings.non_moving_days}+ days`, rows: notMoving, active: false },
    { key: 'done', label: 'Done', rows: all.filter(closed), active: false },
  ].map((t) => ({ ...t, count: t.rows.length, href: t.key === 'all' ? '/orders' : `/orders?tab=${encodeURIComponent(t.key)}`, active: t.key === tab }));
  const current = tabs.find((t) => t.active) ?? tabs[0]!;
  current.active = true;

  const thumbnails = await getThumbnails(current.rows.map((r) => r.thread_id ?? ''));
  const bulk: Record<string, BulkChecklist> = Object.fromEntries(
    bulkRows.map((b) => [
      b.id,
      { current_stage: b.current_stage, stages: Object.fromEntries(Object.entries(b.stages ?? {}).map(([k, v]) => [k, { value: v.value, locked: v.locked }])) },
    ]),
  );
  const defs = ((stageDefs.data ?? []) as BulkStageDefRow[]).map((d) => ({ key: d.key, label: d.label, optional: d.optional }));

  return (
    <SheetPage>
      <PageHeader
        title="Orders"
        detail="Development inquiries and bulk orders together, one row each, under the client’s name. The Type column shows which is which. Click a cell to type in it."
        actions={
          <>
            <a href="/api/export/development" className={buttonClass('secondary')}>Download development (Excel)</a>
            <a href="/api/export/bulk" className={buttonClass('secondary')}>Download bulk (Excel)</a>
          </>
        }
      />
      <Stats
        items={[
          { label: 'Development inquiries open', value: open.filter((r) => r.row_kind !== 'bulk').length, tone: 'indigo' },
          { label: 'Bulk orders in progress', value: open.filter((r) => r.row_kind === 'bulk').length, tone: 'teal' },
          { label: 'Waiting for our reply', value: open.filter(isWaiting).length, tone: 'red' },
          { label: `Not moving for ${settings.non_moving_days}+ days`, value: notMoving.length, tone: 'mustard', href: '/orders?tab=not-moving' },
        ]}
      />
      <WorkSheet
        mode="orders"
        rows={current.rows}
        thumbnails={thumbnails}
        labels={settings.column_labels}
        companies={companies}
        bulk={bulk}
        stageDefs={defs}
        empty={
          <Empty title={current.key === 'done' ? 'Nothing finished yet' : 'No orders yet'}>
            Rows appear after you approve a client under New clients and the AI reads their emails, or when you click Add an inquiry.
          </Empty>
        }
        tabs={<SheetTabs tabs={tabs.map(({ rows: _rows, ...t }) => t)} />}
      />
    </SheetPage>
  );
}
