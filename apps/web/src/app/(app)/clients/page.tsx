import Link from 'next/link';
import { SheetPage, SheetTabs, shortDate } from '@/components/sheet';
import { Empty, PageHeader } from '@/components/ui';
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
      <div className="flex min-h-0 flex-1 flex-col">
        <form className="flex flex-wrap items-center gap-3 border-b border-line bg-ground px-4 py-2">
          <input type="hidden" name="tab" value={current.param} />
          <input
            name="q"
            defaultValue={q}
            type="search"
            placeholder="Find a client"
            aria-label="Find a client"
            className="h-9 w-72 max-w-full rounded-full border border-line bg-surface px-4 text-[14px] outline-none focus:border-indigo"
          />
          <span className="ml-auto text-[13px] text-muted">{rows.length} clients</span>
        </form>
        {rows.length === 0 ? (
          <div className="flex-1"><Empty title={needle ? 'No client matches' : 'No clients here yet'} /></div>
        ) : (
          <div className="sheet-wrap min-h-0 flex-1">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="rn" aria-label="Row" />
                  <th className="co">{COMPANY_LABEL}</th>
                  <th style={{ minWidth: 110 }}>City</th>
                  <th style={{ minWidth: 110 }}>Region</th>
                  <th style={{ minWidth: 110 }}>Development</th>
                  <th style={{ minWidth: 90 }}>Bulk</th>
                  <th style={{ minWidth: 110 }}>Reply needed</th>
                  <th style={{ minWidth: 120 }}>Conversations</th>
                  <th style={{ minWidth: 96 }}>People</th>
                  <th style={{ minWidth: 100 }}>Last email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className={cx('rn', r.awaiting_reply > 0 && 'alert')}>{i + 1}</td>
                    <td className="co"><Link href={`/clients/${r.id}`}>{r.name}</Link></td>
                    <td className="city">{r.city ?? ''}</td>
                    <td className="center">{r.region ?? ''}</td>
                    <td className="center">{r.open_dev || ''}</td>
                    <td className="center">{r.open_bulk || ''}</td>
                    <td className="center">{r.awaiting_reply > 0 && <span className="font-bold text-red">{r.awaiting_reply}</span>}</td>
                    <td className="center">{r.thread_count}</td>
                    <td className="center">{r.contact_count || ''}</td>
                    <td className="center text-[12.5px]">{shortDate(r.last_activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SheetTabs
          tabs={TABS.map((t) => ({ key: t.param, label: t.label, count: counts[t.param], href: `/clients?tab=${t.param}`, active: t.param === current.param }))}
        />
      </div>
    </SheetPage>
  );
}
