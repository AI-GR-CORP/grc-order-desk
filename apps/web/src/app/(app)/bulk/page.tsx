import type { BulkOrderView, BulkStageDefRow } from '@grc/core';
import { BulkTable } from '@/components/bulk-table';
import { SheetPage } from '@/components/sheet';
import { buttonClass, PageHeader, Stats } from '@/components/ui';
import { fetchAll } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Bulk orders' };

export default async function BulkPage() {
  const supabase = await createSupabase();
  const [rows, defs] = await Promise.all([
    fetchAll<BulkOrderView>((a, b) => supabase.from('v_bulk_orders').select('*').order('id').range(a, b)),
    supabase.from('bulk_stage_def').select('*').order('sort_order'),
  ]);
  return (
    <SheetPage>
      <PageHeader
        title="Bulk orders"
        detail="Tripti’s checklist, one row per order, from PI to LC. The highlighted step is the latest one reached."
        actions={<a href="/api/export/bulk" className={buttonClass('secondary')}>Download Excel</a>}
      />
      <Stats
        items={[
          { label: 'Orders in progress', value: rows.filter((r) => !['completed', 'cancelled'].includes(r.status)).length, tone: 'indigo' },
          { label: 'In production', value: rows.filter((r) => r.status === 'in_production').length, tone: 'indigo' },
          { label: 'Dispatched', value: rows.filter((r) => r.status === 'dispatched').length, tone: 'teal' },
          { label: 'Finished', value: rows.filter((r) => r.status === 'completed').length, tone: 'teal' },
        ]}
      />
      <BulkTable rows={rows} stages={(defs.data ?? []) as BulkStageDefRow[]} />
    </SheetPage>
  );
}
