import type { NeedsReplyRow } from '@grc/core';
import { ReplySheet } from '@/components/reply-sheet';
import { GridBar, GridCard, SheetPage, SheetTabs } from '@/components/sheet';
import { CountPill, Empty, LinkButton, PageHeader, TitleBar } from '@/components/ui';
import { getAppUser } from '@/lib/auth';
import { getMailboxes, getSettings } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Reply needed' };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const supabase = await createSupabase();
  const user = await getAppUser();
  const [mailboxes, settings, needs, queue] = await Promise.all([
    getMailboxes(supabase),
    getSettings(supabase),
    supabase.from('v_needs_reply').select('*').order('reply_due_at', { ascending: true, nullsFirst: false }).limit(300),
    supabase.from('v_client_queue').select('id', { count: 'exact', head: true }).eq('approval', 'pending'),
  ]);
  const rows = (needs.data ?? []) as NeedsReplyRow[];
  const awaiting = rows.filter((r) => r.reply_state === 'awaiting');
  const maybe = rows.filter((r) => r.reply_state === 'possibly_replied');
  const showMaybe = tab === 'maybe';
  const waitingClients = queue.count ?? 0;

  if (mailboxes.length === 0) {
    return (
      <>
        <PageHeader title="Reply needed" />
        <Empty title="Connect the Gmail mailbox to start">
          The dashboard reads customer emails (it can’t send or delete anything) and shows which customers are waiting for GRC.
          {user?.isAdmin && <div className="mt-4"><LinkButton href="/settings" variant="primary">Go to Settings</LinkButton></div>}
        </Empty>
      </>
    );
  }

  const list = showMaybe ? maybe : awaiting;
  return (
    <SheetPage>
      <TitleBar
        title="Reply needed"
        pills={
          <>
            <CountPill tone={awaiting.length ? 'red' : 'slate'}>{awaiting.length} waiting for reply</CountPill>
            {awaiting.filter((r) => r.reply_due_at && new Date(r.reply_due_at).getTime() < Date.now()).length > 0 && <CountPill tone="red">{awaiting.filter((r) => r.reply_due_at && new Date(r.reply_due_at).getTime() < Date.now()).length} past {settings.reply_sla_minutes} min</CountPill>}
            {waitingClients > 0 && <CountPill tone="mustard" href="/approvals">{waitingClients} new clients to approve</CountPill>}
          </>
        }
      />
      <GridCard>
        <GridBar
          tabs={
            <SheetTabs
              tabs={[
                { key: 'waiting', label: 'Waiting for our reply', count: awaiting.length, href: '/', active: !showMaybe },
                { key: 'maybe', label: 'Maybe already answered', count: maybe.length, href: '/?tab=maybe', active: showMaybe },
              ]}
            />
          }
        />
        {list.length === 0 ? (
          <div className="flex-1">
            <Empty title={showMaybe ? 'Nothing to check' : 'All caught up'}>
              {showMaybe ? null : 'New customer emails appear here within 5 minutes of arriving.'}
            </Empty>
          </div>
        ) : (
          <ReplySheet rows={list} maybe={showMaybe} />
        )}
      </GridCard>
    </SheetPage>
  );
}
