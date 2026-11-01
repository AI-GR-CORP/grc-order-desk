import { companyKey, type ClientApproval, type ClientQueueRow, type ThreadBriefRow } from '@grc/core';
import { domainOf, isFreemail, isInternal } from '@grc/core/mail';
import { SheetPage, SheetTabs } from '@/components/sheet';
import { CountPill, Empty, TitleBar } from '@/components/ui';
import { UnmatchedSheet, type UnmatchedGroup } from '@/components/unmatched-sheet';
import { WorkSheet, type ApprovalInfo } from '@/components/work-sheet';
import { requireUser } from '@/lib/auth';
import { fetchAll, getMailboxes, getSettings, getThumbnails } from '@/lib/data';
import type { SheetRow } from '@/lib/sheet';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'New clients' };

const TABS: { param: string; approval: ClientApproval | null; label: string }[] = [
  { param: 'waiting', approval: 'pending', label: 'Waiting for approval' },
  { param: 'approved', approval: 'approved', label: 'Approved' },
  { param: 'ignored', approval: 'rejected', label: 'Ignored' },
  { param: 'unmatched', approval: null, label: 'Senders not matched' },
];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const current = TABS.find((t) => t.param === sp.tab) ?? TABS[0]!;
  const supabase = await createSupabase();

  const [queue, mailboxes, settings, companies, unmatched] = await Promise.all([
    fetchAll<ClientQueueRow>((a, b) =>
      supabase.from('v_client_queue').select('*').order('awaiting_reply', { ascending: false }).order('last_at', { ascending: false, nullsFirst: false }).range(a, b),
    ),
    getMailboxes(supabase),
    getSettings(supabase),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).neq('approval', 'rejected').order('name').range(a, b)),
    fetchAll<ThreadBriefRow>((a, b) => supabase.from('v_thread_brief').select('*').is('company_id', null).order('last_message_at', { ascending: false }).range(a, b), 500, 1000),
  ]);

  // Group unmatched conversations by the company the email seems to come from.
  const groupMap = new Map<string, UnmatchedGroup>();
  for (const t of unmatched) {
    const email = t.first_from_email?.toLowerCase() ?? '';
    const domain = email && !isFreemail(email, settings.freemail_domains) && !isInternal(email, settings.internal_domains) ? domainOf(email) : '';
    const guess = t.company_guess?.trim() ?? '';
    const key = guess ? `g:${companyKey(guess)}` : domain ? `d:${domain}` : email ? `e:${email}` : 'unknown';
    const g = groupMap.get(key) ?? { key, label: guess || domain || t.first_from_name || email || 'Unknown sender', senders: [], threads: [] };
    g.threads.push(t);
    if (email && !g.senders.includes(email)) g.senders.push(email);
    groupMap.set(key, g);
  }
  const groups = [...groupMap.values()].sort((a, b) => b.threads.length - a.threads.length);

  const counts: Record<string, number> = { waiting: 0, approved: 0, ignored: 0, unmatched: groups.length };
  for (const q of queue) {
    const t = TABS.find((x) => x.approval === q.approval);
    if (t) counts[t.param] = (counts[t.param] ?? 0) + 1;
  }
  const tabs = TABS.map((t) => ({
    key: t.param,
    label: t.label,
    count: counts[t.param],
    href: t.param === 'waiting' ? '/approvals' : `/approvals?tab=${t.param}`,
    active: t.param === current.param,
  }));
  const tabBar = <SheetTabs tabs={tabs} />;
  const costPerThread = settings.ai_models.extract.includes('opus') ? 0.12 : 0.05;
  const canEdit = user.isAdmin;

  const mb = mailboxes[0];
  const stillLearning = mb && ['pending', 'ingesting', 'triaging', 'discovery'].includes(mb.backfill_stage ?? '');
  const header = (
    <TitleBar
      title="New clients"
      pills={
        <>
          <CountPill tone="mustard">{counts.waiting ?? 0} waiting for approval</CountPill>
          {stillLearning && <CountPill tone="slate">Still reading the mailbox</CountPill>}
          {!canEdit && <CountPill tone="slate">Only owners can approve</CountPill>}
        </>
      }
    />
  );

  if (current.approval === null) {
    return (
      <SheetPage>
        {header}
        <UnmatchedSheet groups={groups} companies={companies} canEdit={canEdit} tabs={tabBar} empty={<Empty title="Every sender is matched to a client" />} />
      </SheetPage>
    );
  }

  const list = queue.filter((q) => q.approval === current.approval);
  const ids = list.map((q) => q.id);
  const rows: SheetRow[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    rows.push(...(await fetchAll<SheetRow>((a, b) => supabase.from('v_sheet_rows').select('*').in('company_id', chunk).order('row_id').range(a, b))));
  }
  const approvals: Record<string, ApprovalInfo> = Object.fromEntries(
    list.map((q) => [q.id, { conversations: q.tracked_threads, cost: q.tracked_threads * costPerThread, approvedAt: q.approval_at }]),
  );
  const thumbnails = await getThumbnails(rows.map((r) => r.thread_id ?? ''));

  return (
    <SheetPage>
      {header}
      <WorkSheet
        mode="approvals"
        approvalTab={current.approval}
        approvals={approvals}
        canApprove={canEdit}
        rows={rows}
        thumbnails={thumbnails}
        labels={settings.column_labels}
        tabs={tabBar}
        empty={
          <Empty title={current.approval === 'pending' ? 'No clients waiting' : current.approval === 'approved' ? 'No approved clients yet' : 'No ignored clients'}>
            {current.approval === 'pending' ? 'New clients appear here when their first development or bulk email arrives.' : null}
          </Empty>
        }
      />
    </SheetPage>
  );
}
