import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BulkOrderView, DevItemView, ThreadRow } from '@grc/core';
import { BulkStatusChip, ReplyBadge, Selvedge, StageChip } from '@/components/stage';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { ago, fmtDate } from '@/lib/format';
import { createSupabase } from '@/lib/supabase/server';

const GROUPS: { key: string; title: string; cats: string[] }[] = [
  { key: 'dev', title: 'Development threads', cats: ['development', 'mixed'] },
  { key: 'bulk', title: 'Bulk order threads', cats: ['bulk'] },
  { key: 'other', title: 'Other emails (not tracked)', cats: ['payment', 'other', 'unclassified', 'ignored'] },
];

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabase();
  const { data: company } = await supabase.from('company').select('*').eq('id', id).maybeSingle();
  if (!company) notFound();
  const [contacts, dev, bulk, threads] = await Promise.all([
    supabase.from('contact').select('name, email').eq('company_id', id).order('email'),
    supabase.from('v_dev_items').select('*').eq('company_id', id).order('enquiry_date', { ascending: false, nullsFirst: false }).limit(300),
    supabase.from('v_bulk_orders').select('*').eq('company_id', id).limit(100),
    supabase.from('email_thread').select('*').eq('company_id', id).order('last_message_at', { ascending: false }).limit(200),
  ]);
  const devRows = (dev.data ?? []) as DevItemView[];
  const bulkRows = (bulk.data ?? []) as BulkOrderView[];
  const threadRows = (threads.data ?? []) as ThreadRow[];

  return (
    <>
      <PageHeader
        title={company.name as string}
        detail={
          <span>
            {[company.city, company.region].filter(Boolean).join(', ') || 'Region not set'}
            {(company.domains as string[]).length > 0 && <span className="ml-3">{(company.domains as string[]).join(', ')}</span>}
          </span>
        }
      />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-8">
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const list = threadRows.filter((t) => g.cats.includes(t.category));
            if (list.length === 0 && g.key === 'other') return null;
            return (
              <Panel key={g.key} title={`${g.title} (${list.length})`}>
                {list.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted">None yet.</p>
                ) : (
                  <ul className="divide-y divide-line-2">
                    {list.map((t) => (
                      <li key={t.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link href={`/threads/${t.id}`} className="font-medium hover:underline">{t.subject ?? '(no subject)'}</Link>
                          <div className="flex items-center gap-2 text-[12px] text-muted">
                            <ReplyBadge state={t.reply_state} dueAt={t.reply_due_at} />
                            {t.waiting_on === 'customer' && <span>waiting on them</span>}
                            <span>{ago(t.last_message_at)}</span>
                          </div>
                        </div>
                        {t.summary && <p className="mt-1 max-w-3xl text-[13px] text-ink-2">{t.summary}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>
        <div className="space-y-6">
          <Panel title={`Development items (${devRows.length})`}>
            {devRows.length === 0 ? (
              <Empty title="No items" />
            ) : (
              <div className="p-4">
                <Selvedge stages={devRows.map((d) => d.stage)} className="mb-3" />
                <ul className="space-y-2.5 text-[13px]">
                  {devRows.slice(0, 40).map((d) => (
                    <li key={d.id}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium">{d.brand ?? d.product_code ?? 'Item'}</span>{' '}
                          <span className="text-ink-2">{d.inquiry}</span>
                        </span>
                        <StageChip stage={d.stage} />
                      </div>
                      {d.team_status && <p className="text-[12px] text-muted">{d.team_status}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
          <Panel title={`Bulk orders (${bulkRows.length})`}>
            {bulkRows.length === 0 ? (
              <Empty title="No orders" />
            ) : (
              <ul className="divide-y divide-line-2 text-[13px]">
                {bulkRows.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                    <span>
                      <span className="font-medium">{b.product_code ?? b.brand ?? 'Order'}</span>
                      {b.po_number && <span className="text-muted"> PO {b.po_number}</span>}
                    </span>
                    <BulkStatusChip status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Contacts (${contacts.data?.length ?? 0})`}>
            <ul className="divide-y divide-line-2 text-[13px]">
              {(contacts.data ?? []).map((c) => (
                <li key={c.email as string} className="px-4 py-2">
                  <div>{(c.name as string) ?? '—'}</div>
                  <div className="text-[12px] text-muted">{c.email as string}</div>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="text-[12px] text-muted">Customer since {fmtDate(company.created_at as string)} in this dashboard.</p>
        </div>
      </div>
    </>
  );
}
