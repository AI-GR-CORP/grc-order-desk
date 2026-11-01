import Link from 'next/link';
import type { MailboxStatusRow } from '@grc/core';
import { CompanyReviewRow, KnowledgeEditor, StartExtraction } from '@/components/review';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { getAppUser } from '@/lib/auth';
import { fetchAll, getMailboxes } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Review' };

function ImportStatus({ mb, tracked }: { mb: MailboxStatusRow; tracked: number }) {
  const p = (mb.backfill_progress ?? {}) as { extracted?: number; toExtract?: number; messages?: number; threads?: number };
  switch (mb.backfill_stage) {
    case 'pending':
    case 'ingesting':
      return <p>Reading the mailbox: {p.messages ?? 0} of about {mb.backfill_target} emails so far.</p>;
    case 'triaging':
      return <p>Sorting {p.messages ?? 0} emails into development, bulk and everything else.</p>;
    case 'discovery':
      return <p>Building the customer list and GRC team list.</p>;
    case 'awaiting_review':
      return (
        <div className="space-y-3">
          <p>
            The customer list is ready. Check the companies below (rename, set the region, merge duplicates), then fill the tables. Reply
            tracking is already running.
          </p>
          <StartExtraction mailboxId={mb.id} threads={tracked} />
        </div>
      );
    case 'extracting':
      return <p>Filling the tables: {p.extracted ?? 0} of {p.toExtract ?? '…'} threads read.</p>;
    default:
      return <p>All threads are read. New emails are processed every 5 minutes.</p>;
  }
}

export default async function ReviewPage() {
  const supabase = await createSupabase();
  const user = await getAppUser();
  const [mailboxes, companies, allCompanies, threads, tracked, profiles] = await Promise.all([
    getMailboxes(supabase),
    supabase.from('v_company_overview').select('id, name, region, city, domains, contact_count, thread_count').eq('needs_review', true).order('thread_count', { ascending: false }).limit(200),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).order('name').range(a, b)),
    supabase.from('email_thread').select('id, subject, category, ai_confidence, company_id').eq('needs_review', true).in('category', ['development', 'bulk', 'mixed']).order('last_message_at', { ascending: false }).limit(100),
    supabase.from('email_thread').select('id', { count: 'exact', head: true }).in('category', ['development', 'bulk', 'mixed']),
    supabase.from('knowledge_profile').select('version, active, created_at, content').order('version', { ascending: false }).limit(10),
  ]);
  const active = (profiles.data ?? []).find((p) => p.active);
  const reviewCompanies = (companies.data ?? []) as Parameters<typeof CompanyReviewRow>[0]['company'][];

  return (
    <>
      <PageHeader title="Review" detail="Check what the AI learned. Every fix here is reused for the next emails." />
      <div className="space-y-6 p-6 lg:p-8">
        {mailboxes.map((mb) => (
          <Panel key={mb.id} title={`Mailbox import: ${mb.email}`}>
            <div className="p-4 text-[13.5px]"><ImportStatus mb={mb} tracked={tracked.count ?? 0} /></div>
          </Panel>
        ))}

        <Panel title={`New customers to check (${reviewCompanies.length})`}>
          {reviewCompanies.length === 0 ? (
            <Empty title="Nothing to check">New customers found in email show up here first.</Empty>
          ) : (
            <ul className="divide-y divide-line-2">
              {reviewCompanies.map((c) => <CompanyReviewRow key={c.id} company={c} others={allCompanies} />)}
            </ul>
          )}
        </Panel>

        <Panel title={`Threads the AI wasn’t sure about (${threads.data?.length ?? 0})`}>
          {(threads.data ?? []).length === 0 ? (
            <Empty title="Nothing to check" />
          ) : (
            <ul className="divide-y divide-line-2 text-[13.5px]">
              {(threads.data ?? []).map((t) => (
                <li key={t.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <Link href={`/threads/${t.id}`} className="hover:underline">{(t.subject as string) ?? '(no subject)'}</Link>
                  <span className="text-[12px] text-muted">{t.company_id ? 'check type' : 'customer unknown'}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={active ? `What the AI knows about GRC (version ${active.version})` : 'What the AI knows about GRC'}>
          <KnowledgeEditor
            active={(active?.content as string) ?? ''}
            versions={(profiles.data ?? []).map((p) => ({ version: p.version as number, active: p.active as boolean, created_at: p.created_at as string, preview: (p.content as string).slice(0, 80) }))}
            canEdit={Boolean(user?.isAdmin)}
          />
        </Panel>
      </div>
    </>
  );
}
