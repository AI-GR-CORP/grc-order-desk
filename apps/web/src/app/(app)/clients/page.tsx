import Link from 'next/link';
import { GridCard, SheetPage, SheetTabs, shortDate } from '@/components/sheet';
import { Empty, PageHeader, Stats } from '@/components/ui';
import { fetchAll } from '@/lib/data';
import { cx } from '@/lib/format';
import { COMPANY_LABEL } from '@/lib/sheet';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'All clients' };

interface Overview {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  open_dev: number;
  open_bulk: number;
  awaiting_reply: number;
  thread_count: number;
  contact_count: number;
  last_activity_at: string | null;
  approval: 'pending' | 'approved' | 'rejected';
}

const TABS = [
  { param: 'approved', label: 'Approved clients' },
  { param: 'pending', label: 'Waiting for approval' },
  { param: 'rejected', label: 'Ignored' },
] as const;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const { q, tab } = await searchParams;
  const current = TABS.find((t) => t.param === tab) ?? TABS[0];
  const supabase = await createSupabase();
  const all = await fetchAll<Overview>((a, b) =>
    supabase.from('v_company_overview').select('*').order('awaiting_reply', { ascending: false }).order('last_activity_at', { ascending: false, nullsFirst: false }).range(a, b),
  );
  const needle = q?.trim().toLowerCase() ?? '';
  const rows = all.filter((r) => r.approval === current.param && (!needle || [r.name, r.city, r.region].some((v) => v?.toLowerCase().includes(needle))));
  const counts = Object.fromEntries(TABS.map((t) => [t.param, all.filter((r) => r.approval === t.param).length]));

  return (
    <SheetPage>
      <PageHeader title="All clients" detail="One row per client. Click a name to see all their inquiries and emails." />
      <Stats
        items={[
          { label: 'Approved clients', value: counts.approved ?? 0, tone: 'teal' },
          { label: 'Waiting for our reply', value: all.filter((r) => r.approval === 'approved').reduce((n, r) => n + r.awaiting_reply, 0), tone: 'red', href: '/' },
          { label: 'Open development', value: all.filter((r) => r.approval === 'approved').reduce((n, r) => n + r.open_dev, 0), tone: 'indigo', href: '/development' },
          { label: 'Open bulk orders', value: all.filter((r) => r.approval === 'approved').reduce((n, r) => n + r.open_bulk, 0), tone: 'teal', href: '/bulk' },
        ]}
      />
      <GridCard>
        <SheetTabs
          tabs={TABS.map((t) => ({ key: t.param, label: t.label, count: counts[t.param], href: `/clients?tab=${t.param}`, active: t.param === current.param }))}
        />
        <form className="flex flex-wrap items-center gap-3 px-5 py-3">
          <input type="hidden" name="tab" value={current.param} />
          <input
            name="q"
            defaultValue={q}
            type="search"
            placeholder="Find a client"
            aria-label="Find a client"
            className="h-9 w-72 max-w-full rounded-lg border border-line bg-surface px-3 text-[14px] outline-none placeholder:text-faint focus:border-indigo focus:ring-3 focus:ring-indigo/15"
          />
          <span className="ml-auto text-[13px] text-muted">{rows.length} clients</span>
        </form>
        {rows.length === 0 ? (
          <div className="flex-1 border-t border-line"><Empty title={needle ? 'No client matches' : 'No clients here yet'} /></div>
        ) : (
          <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="rn" aria-label="Row" />
                  <th className="co">{COMPANY_LABEL}</th>
                  <th style={{ minWidth: 110 }}>City</th>
                  <th style={{ minWidth: 110 }}>Region</th>
                  <th className="center" style={{ minWidth: 110 }}>Development</th>
                  <th className="center" style={{ minWidth: 90 }}>Bulk</th>
                  <th className="center" style={{ minWidth: 120 }}>Reply needed</th>
                  <th className="center" style={{ minWidth: 120 }}>Conversations</th>
                  <th className="center" style={{ minWidth: 96 }}>People</th>
                  <th style={{ minWidth: 100 }}>Last email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="group-last">
                    <td className={cx('rn', r.awaiting_reply > 0 && 'alert')}>{i + 1}</td>
                    <td className="co !pt-[11px] !align-middle"><Link href={`/clients/${r.id}`} className="font-semibold hover:text-indigo">{r.name}</Link></td>
                    <td className="text-muted">{r.city ?? ''}</td>
                    <td className="text-muted">{r.region ?? ''}</td>
                    <td className="center">{r.open_dev || ''}</td>
                    <td className="center">{r.open_bulk || ''}</td>
                    <td className="center">{r.awaiting_reply > 0 && <span className="inline-block min-w-6 rounded-full bg-red-soft px-2 py-[2px] text-[12.5px] font-semibold text-red">{r.awaiting_reply}</span>}</td>
                    <td className="center">{r.thread_count}</td>
                    <td className="center">{r.contact_count || ''}</td>
                    <td className="whitespace-nowrap text-[13px] text-muted">{shortDate(r.last_activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GridCard>
    </SheetPage>
  );
}
