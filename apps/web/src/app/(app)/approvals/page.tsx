import Link from 'next/link';
import { companyKey, type ClientApproval, type ClientQueueRow, type ThreadBriefRow } from '@grc/core';
import { domainOf, isFreemail, isInternal } from '@grc/core/mail';
import { ApprovalList, UnmatchedGroupCard, type ClientCardData, type UnmatchedGroup } from '@/components/approvals';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { cx } from '@/lib/format';
import { fetchAll, getMailboxes, getSettings } from '@/lib/data';
import { createAdmin } from '@/lib/supabase/admin';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'New clients' };

const TABS: { key: ClientApproval; param: string; label: string }[] = [
  { key: 'pending', param: 'waiting', label: 'Waiting for approval' },
  { key: 'approved', param: 'approved', label: 'Approved' },
  { key: 'rejected', param: 'ignored', label: 'Ignored' },
];
const PAGE = 40;

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; more?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.param === sp.tab)?.key ?? 'pending';
  const limit = PAGE * Math.max(1, Number(sp.more ?? 1) || 1);
  const supabase = await createSupabase();

  const [queue, mailboxes, settings, companies] = await Promise.all([
    fetchAll<ClientQueueRow>((a, b) =>
      supabase.from('v_client_queue').select('*').order('awaiting_reply', { ascending: false }).order('last_at', { ascending: false, nullsFirst: false }).range(a, b),
    ),
    getMailboxes(supabase),
    getSettings(supabase),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).neq('approval', 'rejected').order('name').range(a, b)),
  ]);

  const counts = { pending: 0, approved: 0, rejected: 0 } as Record<ClientApproval, number>;
  for (const q of queue) counts[q.approval]++;
  const all = queue.filter((q) => q.approval === tab);
  const clients = all.slice(0, limit);
  const ids = clients.map((c) => c.id);

  const [threads, contacts, unmatched, sheetNames] = await Promise.all([
    ids.length
      ? fetchAll<ThreadBriefRow>((a, b) => supabase.from('v_thread_brief').select('*').in('company_id', ids).order('last_message_at', { ascending: false }).range(a, b))
      : Promise.resolve([]),
    ids.length ? supabase.from('contact').select('company_id, name, email').in('company_id', ids).order('email') : Promise.resolve({ data: [] }),
    tab === 'pending'
      ? fetchAll<ThreadBriefRow>((a, b) => supabase.from('v_thread_brief').select('*').is('company_id', null).order('last_message_at', { ascending: false }).range(a, b), 500, 500)
      : Promise.resolve([]),
    fetchAll<{ company_name: string | null }>((a, b) => createAdmin().from('sheet_baseline').select('company_name').range(a, b)),
  ]);

  const sheetKeys = new Set(sheetNames.map((s) => (s.company_name ? companyKey(s.company_name) : '')).filter(Boolean));
  const cards: ClientCardData[] = clients.map((client) => ({
    client,
    threads: threads.filter((t) => t.company_id === client.id),
    contacts: ((contacts.data ?? []) as { company_id: string; name: string | null; email: string }[]).filter((c) => c.company_id === client.id),
    inSheet: sheetKeys.has(companyKey(client.name)),
  }));

  // Group unmatched conversations by the company the email seems to come from.
  const groups = new Map<string, UnmatchedGroup>();
  for (const t of unmatched) {
    const email = t.first_from_email?.toLowerCase() ?? '';
    const domain = email && !isFreemail(email, settings.freemail_domains) && !isInternal(email, settings.internal_domains) ? domainOf(email) : '';
    const guess = t.company_guess?.trim() ?? '';
    const key = guess ? `g:${companyKey(guess)}` : domain ? `d:${domain}` : email ? `e:${email}` : 'unknown';
    const label = guess || domain || email || 'Unknown sender';
    const g = groups.get(key) ?? { key, label, senders: [], threads: [] };
    g.threads.push(t);
    if (email && !g.senders.includes(email)) g.senders.push(email);
    groups.set(key, g);
  }
  const unmatchedGroups = [...groups.values()].sort((a, b) => b.threads.length - a.threads.length);

  const mb = mailboxes[0];
  const stillLearning = mb && ['pending', 'ingesting', 'triaging', 'discovery'].includes(mb.backfill_stage ?? '');
  const costPerThread = settings.ai_models.extract.includes('opus') ? 0.12 : 0.05;
  const canEdit = user.isAdmin;
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <>
      <PageHeader
        title="New clients"
        detail="Approve the clients whose conversations should be tracked. Until a client is approved, its emails aren’t read in depth and don’t trigger reply alerts."
      />
      <nav className="flex gap-1 border-b border-line px-6 lg:px-8" aria-label="Approval status">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/approvals?tab=${t.param}`}
            aria-current={t.key === tab ? 'page' : undefined}
            className={cx('-mb-px border-b-2 px-3 py-2.5 text-[13.5px]', t.key === tab ? 'border-indigo font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {t.label} <span className="tabular-nums text-muted">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>

      <div className="space-y-6 p-6 lg:p-8">
        {stillLearning && (
          <p className="rounded-md border border-mustard/30 bg-mustard-soft px-3 py-2 text-[13px] text-mustard">
            Still reading and sorting the mailbox. Clients appear here once the learning pass finishes; the Review page shows progress.
          </p>
        )}
        {!canEdit && <p className="text-[13px] text-muted">Only owners can approve clients.</p>}

        {cards.length === 0 ? (
          <Panel>
            <Empty title={tab === 'pending' ? 'No clients waiting' : tab === 'approved' ? 'No approved clients yet' : 'No ignored clients'}>
              {tab === 'pending' ? 'New clients appear here when their first development or bulk email arrives.' : null}
            </Empty>
          </Panel>
        ) : (
          <ApprovalList cards={cards} tab={tab} companies={companies} costPerThread={costPerThread} canEdit={canEdit} />
        )}

        {all.length > clients.length && (
          <Link href={`/approvals?tab=${current.param}&more=${Number(sp.more ?? 1) + 1}`} className="inline-block text-[13.5px] text-indigo hover:underline">
            Show {Math.min(PAGE, all.length - clients.length)} more clients
          </Link>
        )}

        {tab === 'pending' && unmatchedGroups.length > 0 && (
          <section className="space-y-4">
            <div>
              <h2 className="text-[17px] font-semibold">Conversations not matched to a client ({unmatched.length})</h2>
              <p className="mt-1 text-[13px] text-muted">
                Usually people writing from personal Gmail or Yahoo addresses. Create a client, add them to an existing one, or mark them as not client work.
              </p>
            </div>
            {unmatchedGroups.map((g) => <UnmatchedGroupCard key={g.key} group={g} companies={companies} canEdit={canEdit} />)}
          </section>
        )}
      </div>
    </>
  );
}
