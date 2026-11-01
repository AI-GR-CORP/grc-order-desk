import Link from 'next/link';
import { GridBar, GridCard, SheetPage, SheetTabs, shortDate } from '@/components/sheet';
import { CountPill, Empty, TitleBar } from '@/components/ui';
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
      <TitleBar
        title="All clients"
        pills={
          <>
            <CountPill tone="teal">{counts.approved ?? 0} approved</CountPill>
            {all.filter((r) => r.approval === 'approved').reduce((n, r) => n + r.awaiting_reply, 0) > 0 && <CountPill tone="red" href="/">{all.filter((r) => r.approval === 'approved').reduce((n, r) => n + r.awaiting_reply, 0)} waiting for reply</CountPill>}
          </>
        }
      />
      <GridCard>
        <GridBar
          tabs={<SheetTabs tabs={TABS.map((t) => ({ key: t.param, label: t.label, count: counts[t.param], href: `/clients?tab=${t.param}`, active: t.param === current.param }))} />}
        >
          <form className="flex items-center">
          <input type="hidden" name="tab" value={current.param} />
          <input
            name="q"
            defaultValue={q}
            type="search"
            placeholder="Find a client"
            aria-label="Find a client"
            className="h-8 w-52 max-w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] outline-none placeholder:text-slate focus:border-indigo focus:ring-3 focus:ring-indigo/15"
          />
          </form>
        </GridBar>
        {rows.length === 0 ? (
          <div className="flex-1 border-t border-line"><Empty title={needle ? 'No client matches' : 'No clients here yet'} /></div>
        ) : (
          <div className="sheet-wrap min-h-0 flex-1 border-t border-line">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="rn" aria-label="Row" />
                  <th className="co">{COMPANY_LABEL}</th>
                  <th style={{ minWidth: 130 }}>City</th>
                  <th style={{ minWidth: 120 }}>Region</th>
                  <th className="center" style={{ minWidth: 130 }}>Reply needed</th>
                  <th className="center" style={{ minWidth: 130 }}>Development</th>
                  <th className="center" style={{ minWidth: 100 }}>Bulk</th>
                  <th className="center" style={{ minWidth: 140 }}>Conversations</th>
                  <th style={{ minWidth: 120 }}>Last email</th>
                  <th className="act" style={{ width: 96, minWidth: 96 }}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={cx('row', i % 2 === 1 && 'alt', r.awaiting_reply > 0 && 'waiting')}>
                    <td className="rn">{i + 1}</td>
                    <td className="co !align-middle">
                      <Link href={`/clients/${r.id}`} className="font-semibold text-ink hover:text-indigo">{r.name}</Link>
                      <div className="text-[13px] text-muted">{r.contact_count} {r.contact_count === 1 ? 'person' : 'people'}</div>
                    </td>
                    <td className="text-ink-2">{r.city ?? ''}</td>
                    <td className="text-ink-2">{r.region ?? ''}</td>
                    <td className="center">
                      {r.awaiting_reply > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-soft px-2.5 py-[3px] text-[12.5px] font-medium text-red">
                          <span className="size-1.5 rounded-full bg-red" aria-hidden />
                          {r.awaiting_reply} waiting
                        </span>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </td>
                    <td className="center tabular-nums">{r.open_dev || <span className="text-muted">0</span>}</td>
                    <td className="center tabular-nums">{r.open_bulk || <span className="text-muted">0</span>}</td>
                    <td className="center tabular-nums">{r.thread_count}</td>
                    <td className="whitespace-nowrap text-[13.5px] text-muted">{shortDate(r.last_activity_at)}</td>
                    <td className="act">
                      <Link href={`/clients/${r.id}`} className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-[13px] font-medium text-ink-2 hover:border-indigo/40 hover:text-indigo">Open</Link>
                    </td>
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
