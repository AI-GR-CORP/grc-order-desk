import Link from 'next/link';
import { Empty, inputClass, PageHeader, Panel } from '@/components/ui';
import { ago } from '@/lib/format';
import { fetchAll } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Clients' };

interface Overview {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  open_dev: number;
  open_bulk: number;
  awaiting_reply: number;
  thread_count: number;
  last_activity_at: string | null;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createSupabase();
  const rows = await fetchAll<Overview>((a, b) => {
    let query = supabase.from('v_company_overview').select('*');
    if (q?.trim()) query = query.ilike('name', `%${q.trim().replace(/[%_]/g, '')}%`);
    return query.order('awaiting_reply', { ascending: false }).order('last_activity_at', { ascending: false, nullsFirst: false }).range(a, b);
  });
  return (
    <>
      <PageHeader title="Clients" detail={`${rows.length} customers`} />
      <div className="p-6 lg:p-8">
        <form className="mb-4 max-w-sm">
          <input name="q" defaultValue={q} type="search" placeholder="Find a customer" className={inputClass} aria-label="Find a customer" />
        </form>
        <Panel>
          {rows.length === 0 ? (
            <Empty title="No customers yet">They’re created from the mailbox import and from the old sheet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Region</th>
                    <th className="px-4 py-2 text-right font-medium">Need reply</th>
                    <th className="px-4 py-2 text-right font-medium">Open development</th>
                    <th className="px-4 py-2 text-right font-medium">Open bulk</th>
                    <th className="px-4 py-2 text-right font-medium">Threads</th>
                    <th className="px-4 py-2 font-medium">Last email</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-line-2 hover:bg-indigo-soft/25">
                      <td className="px-4 py-2.5"><Link href={`/clients/${r.id}`} className="font-medium hover:underline">{r.name}</Link></td>
                      <td className="px-4 py-2.5 text-muted">{[r.city, r.region].filter(Boolean).join(', ')}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.awaiting_reply > 0 ? <span className="font-semibold text-red">{r.awaiting_reply}</span> : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.open_dev || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.open_bulk || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.thread_count}</td>
                      <td className="px-4 py-2.5 text-muted">{r.last_activity_at ? ago(r.last_activity_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
