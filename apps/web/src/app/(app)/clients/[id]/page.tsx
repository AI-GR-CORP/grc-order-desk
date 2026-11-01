import Link from 'next/link';
import type { BulkOrderView, BulkStageDefRow } from '@grc/core';
import { notFound } from 'next/navigation';
import { ClientHeader } from '@/components/client-header';
import { GridCard, ReplyCell, SheetPage, SheetTabs, shortDate } from '@/components/sheet';
import { Empty, Stats } from '@/components/ui';
import { WorkSheet, type BulkChecklist } from '@/components/work-sheet';
import { requireUser } from '@/lib/auth';
import { fetchAll, getMailboxes, getSettings, getThumbnails } from '@/lib/data';
import { gmailLink } from '@/lib/format';
import { isWaiting, type SheetRow } from '@/lib/sheet';
import { createSupabase } from '@/lib/supabase/server';

const OTHER: Record<string, string> = { payment: 'Payment', other: 'Other', unclassified: 'Not sorted', ignored: 'Not client work' };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const user = await requireUser();
  const supabase = await createSupabase();
  const { data: company } = await supabase.from('company').select('id, name, city, region, domains, approval').eq('id', id).maybeSingle();
  if (!company) notFound();

  const [contacts, rows, others, settings, mailboxes, bulkRows, stageDefs] = await Promise.all([
    supabase.from('contact').select('name, email').eq('company_id', id).order('email'),
    fetchAll<SheetRow>((a, b) => supabase.from('v_sheet_rows').select('*').eq('company_id', id).order('row_id').range(a, b)),
    supabase
      .from('email_thread')
      .select('id, subject, category, last_message_at, reply_state, waiting_on, gmail_thread_id')
      .eq('company_id', id)
      .not('category', 'in', '(development,bulk,mixed)')
      .order('last_message_at', { ascending: false })
      .limit(200),
    getSettings(supabase),
    getMailboxes(supabase),
    supabase.from('v_bulk_orders').select('id, stages, current_stage').eq('company_id', id),
    supabase.from('bulk_stage_def').select('*').order('sort_order'),
  ]);
  const bulk: Record<string, BulkChecklist> = Object.fromEntries(
    ((bulkRows.data ?? []) as Pick<BulkOrderView, 'id' | 'stages' | 'current_stage'>[]).map((b) => [
      b.id,
      { current_stage: b.current_stage, stages: Object.fromEntries(Object.entries(b.stages ?? {}).map(([k, v]) => [k, { value: v.value, locked: v.locked }])) },
    ]),
  );
  const defs = ((stageDefs.data ?? []) as BulkStageDefRow[]).map((d) => ({ key: d.key, label: d.label, optional: d.optional }));
  const mailboxEmail = mailboxes[0]?.email ?? null;
  const otherRows = (others.data ?? []) as { id: string; subject: string | null; category: string; last_message_at: string | null; reply_state: string | null; waiting_on: string | null; gmail_thread_id: string }[];
  const people = (contacts.data ?? []) as { name: string | null; email: string }[];
  const showOther = tab === 'other';
  const tabs = (
    <SheetTabs
      tabs={[
        { key: 'work', label: 'Development and bulk', count: rows.length, href: `/clients/${id}`, active: !showOther },
        { key: 'other', label: 'Other emails', count: otherRows.length, href: `/clients/${id}?tab=other`, active: showOther },
      ]}
    />
  );
  const thumbnails = showOther ? {} : await getThumbnails(rows.map((r) => r.thread_id ?? ''));

  return (
    <SheetPage>
      <header className="space-y-1.5 px-6 pb-5 pt-7">
        <ClientHeader
          id={id}
          name={company.name as string}
          city={company.city as string | null}
          region={company.region as string | null}
          approval={company.approval as 'pending' | 'approved' | 'rejected'}
          isAdmin={user.isAdmin}
        />
        <p className="text-[14px] text-ink-2">
          <span className="text-muted">People: </span>
          {people.length === 0 ? 'none yet' : people.map((p) => (p.name ? `${p.name} (${p.email})` : p.email)).join(', ')}
          {(company.domains as string[]).length > 0 && <span className="text-muted">. Website: {(company.domains as string[]).join(', ')}</span>}
        </p>
      </header>
      <Stats
        items={[
          { label: 'Development rows', value: rows.filter((r) => r.row_kind !== 'bulk').length, tone: 'indigo' },
          { label: 'Bulk orders', value: rows.filter((r) => r.row_kind === 'bulk').length, tone: 'teal' },
          { label: 'Waiting for our reply', value: rows.filter(isWaiting).length, tone: 'red' },
          { label: 'Last email', value: shortDate(rows.map((r) => r.last_at ?? '').sort().pop()) || 'None', tone: 'slate' },
        ]}
      />

      {showOther ? (
        <GridCard>
          {tabs}
          {otherRows.length === 0 ? (
            <div className="flex-1"><Empty title="No other emails" /></div>
          ) : (
            <div className="sheet-wrap min-h-0 flex-1">
              <table className="sheet">
                <thead>
                  <tr>
                    <th className="rn" aria-label="Row" />
                    <th style={{ width: 440, minWidth: 440 }}>Subject</th>
                    <th style={{ minWidth: 120 }}>Kind</th>
                    <th style={{ minWidth: 130 }}>Reply</th>
                    <th style={{ minWidth: 96 }}>Last email</th>
                    <th style={{ minWidth: 110 }}>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {otherRows.map((t, i) => (
                    <tr key={t.id} className={i % 2 === 1 ? 'row alt' : 'row'}>
                      <td className="rn">{i + 1}</td>
                      <td><Link href={`/threads/${t.id}`} className="font-medium hover:text-indigo">{t.subject || '(no subject)'}</Link></td>
                      <td className="text-muted">{OTHER[t.category] ?? t.category}</td>
                      <td><ReplyCell state={t.reply_state} waitingOn={t.waiting_on} /></td>
                      <td className="whitespace-nowrap text-[13.5px] text-muted">{shortDate(t.last_message_at)}</td>
                      <td><a href={gmailLink(mailboxEmail, t.gmail_thread_id)} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-indigo hover:underline">Open in Gmail</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GridCard>
      ) : (
        <WorkSheet
          mode="client"
          rows={rows}
          bulk={bulk}
          stageDefs={defs}
          thumbnails={thumbnails}
          labels={settings.column_labels}
          tabs={tabs}
          empty={<Empty title="No development or bulk emails yet">They appear here as soon as this client writes about samples or orders.</Empty>}
        />
      )}
    </SheetPage>
  );
}
