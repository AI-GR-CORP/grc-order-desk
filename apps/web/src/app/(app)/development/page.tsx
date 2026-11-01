import { DEV_STAGE_CLOSED } from '@grc/core';
import { SheetPage, SheetTabs, type TabItem } from '@/components/sheet';
import { buttonClass, Empty, PageHeader, Stats } from '@/components/ui';
import { WorkSheet } from '@/components/work-sheet';
import { isWaiting } from '@/lib/sheet';
import { fetchAll, getSettings, getThumbnails } from '@/lib/data';
import type { SheetRow } from '@/lib/sheet';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Development' };

const closed = (r: SheetRow) => r.stage !== null && (DEV_STAGE_CLOSED as readonly string[]).includes(r.stage);

export default async function DevelopmentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'all' } = await searchParams;
  const supabase = await createSupabase();
  const [fetched, settings, companies] = await Promise.all([
    fetchAll<SheetRow>((a, b) => supabase.from('v_sheet_rows').select('*').in('row_kind', ['development', 'mixed']).order('row_id').range(a, b)),
    getSettings(supabase),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).eq('approval', 'approved').order('name').range(a, b)),
  ]);

  // Development items (not of ignored clients), plus approved clients' conversations that aren't an item yet.
  const all = fetched.filter((r) =>
    r.source === 'item' ? r.company_approval !== 'rejected' : r.source === 'thread' && r.company_approval === 'approved',
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
  ].map((t) => ({ ...t, count: t.rows.length, href: t.key === 'all' ? '/development' : `/development?tab=${encodeURIComponent(t.key)}`, active: t.key === tab }));
  const current = tabs.find((t) => t.active) ?? tabs[0]!;
  current.active = true;

  const thumbnails = await getThumbnails(current.rows.map((r) => r.thread_id ?? ''));

  return (
    <SheetPage>
      <PageHeader
        title="Development"
        detail="Every sample and inquiry, one row each, under the client’s name. Click a cell to type in it."
        actions={<a href="/api/export/development" className={buttonClass('secondary')}>Download Excel</a>}
      />
      <Stats
        items={[
          { label: 'Open inquiries', value: open.length, tone: 'indigo', href: '/development' },
          { label: 'Waiting for our reply', value: open.filter(isWaiting).length, tone: 'red' },
          { label: `Not moving for ${settings.non_moving_days}+ days`, value: notMoving.length, tone: 'mustard', href: '/development?tab=not-moving' },
          { label: 'Done', value: all.filter(closed).length, tone: 'teal', href: '/development?tab=done' },
        ]}
      />
      <WorkSheet
        mode="development"
        rows={current.rows}
        thumbnails={thumbnails}
        labels={settings.column_labels}
        companies={companies}
        empty={
          <Empty title={current.key === 'done' ? 'Nothing finished yet' : 'No development rows yet'}>
            Rows appear after you approve a client under New clients and the AI reads their emails, or when you click Add a row.
          </Empty>
        }
        tabs={<SheetTabs tabs={tabs.map(({ rows: _rows, ...t }) => t)} />}
      />
    </SheetPage>
  );
}
