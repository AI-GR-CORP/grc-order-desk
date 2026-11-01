import type { BulkOrderView, BulkStageDefRow } from '@grc/core';
import { BulkTable } from '@/components/bulk-table';
import { buttonClass, PageHeader } from '@/components/ui';
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
    <>
      <PageHeader
        title="Bulk orders"
        detail="From PI to LC acceptance. The highlighted cell is the latest step reached."
        actions={<a href="/api/export/bulk" className={buttonClass('secondary')}>Download Excel</a>}
      />
      <BulkTable rows={rows} stages={(defs.data ?? []) as BulkStageDefRow[]} />
    </>
  );
}
