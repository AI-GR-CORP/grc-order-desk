import Link from 'next/link';
import type { MailboxStatusRow } from '@grc/core';
import { KnowledgeEditor } from '@/components/review';
import { Empty, LinkButton, PageHeader, Panel } from '@/components/ui';
import { getAppUser } from '@/lib/auth';
import { getMailboxes } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Review' };

function ImportStatus({ mb }: { mb: MailboxStatusRow }) {
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
    case 'extracting':
    case 'done':
      return (
        <div className="space-y-3">
          <p>
            The mailbox is read and the customer list is ready. Approve the clients you want tracked: each approved client’s conversations are
            read straight away and appear on the Development and Bulk pages. New emails are checked every 5 minutes.
          </p>
          <LinkButton href="/approvals" variant="primary">Go to New clients</LinkButton>
        </div>
      );
    default:
      return null;
  }
}

export default async function ReviewPage() {
  const supabase = await createSupabase();
  const user = await getAppUser();
  const [mailboxes, threads, profiles] = await Promise.all([
    getMailboxes(supabase),
    supabase.from('email_thread').select('id, subject, category, ai_confidence, company_id').eq('needs_review', true).in('category', ['development', 'bulk', 'mixed']).not('company_id', 'is', null).order('last_message_at', { ascending: false }).limit(100),
    supabase.from('knowledge_profile').select('version, active, created_at, content').order('version', { ascending: false }).limit(10),
  ]);
  const active = (profiles.data ?? []).find((p) => p.active);

  return (
    <>
      <PageHeader title="Review" detail="Check what the AI learned. Every fix here is reused for the next emails." />
      <div className="space-y-6 p-6 lg:p-8">
        {mailboxes.map((mb) => (
          <Panel key={mb.id} title={`Mailbox import: ${mb.email}`}>
            <div className="p-4 text-[13.5px]"><ImportStatus mb={mb} /></div>
          </Panel>
        ))}

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
