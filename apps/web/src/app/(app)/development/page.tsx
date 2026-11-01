import type { DevItemView } from '@grc/core';
import { DevTable } from '@/components/dev-table';
import { buttonClass, PageHeader } from '@/components/ui';
import { fetchAll, getSettings, getThumbnails } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Development' };

export default async function DevelopmentPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const supabase = await createSupabase();
  const [rows, settings, companies] = await Promise.all([
    fetchAll<DevItemView>((a, b) => supabase.from('v_dev_items').select('*').order('id').range(a, b)),
    getSettings(supabase),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).eq('approval', 'approved').order('name').range(a, b)),
  ]);
  const thumbnails = await getThumbnails(rows.map((r) => r.primary_thread_id ?? ''));
  return (
    <>
      <PageHeader
        title="Development"
        detail="Samples and new inquiries, one row per item, grouped by customer. Click any cell to correct it; corrected cells stay as you set them."
        actions={<a href="/api/export/development" className={buttonClass('secondary')}>Download Excel</a>}
      />
      <DevTable
        rows={rows}
        thumbnails={thumbnails}
        labels={settings.column_labels}
        companies={companies}
        nonMovingDays={settings.non_moving_days}
        initialView={view === 'non-moving' ? 'non-moving' : view === 'all' ? 'all' : 'open'}
      />
    </>
  );
}
