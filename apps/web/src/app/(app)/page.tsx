import Link from 'next/link';
import type { NeedsReplyRow } from '@grc/core';
import { ReplySheet } from '@/components/reply-sheet';
import { SheetPage, SheetTabs } from '@/components/sheet';
import { Empty, LinkButton, PageHeader } from '@/components/ui';
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
      <PageHeader
        title="Reply needed"
        detail={
          awaiting.length === 0
            ? 'No customer is waiting for a reply right now.'
            : `${awaiting.length} ${awaiting.length === 1 ? 'customer is' : 'customers are'} waiting for GRC. Target: reply within ${settings.reply_sla_minutes} minutes in working hours.`
        }
      />
      {waitingClients > 0 && (
        <Link href="/approvals" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-black/20 bg-company px-5 py-2.5 text-[14px] text-black hover:brightness-95">
          <span className="font-bold">{waitingClients} new {waitingClients === 1 ? 'client is' : 'clients are'} waiting for your approval.</span>
          <span>Their emails aren’t tracked until you approve them.</span>
          <span className="ml-auto font-bold underline">Open New clients</span>
        </Link>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {list.length === 0 ? (
          <div className="flex-1">
            <Empty title={showMaybe ? 'Nothing to check' : 'All caught up'}>
              {showMaybe ? null : 'New customer emails appear here within 5 minutes of arriving.'}
            </Empty>
          </div>
        ) : (
          <>
            {showMaybe && (
              <p className="border-b border-line bg-mustard-soft px-4 py-2 text-[13.5px]">
                GRC emailed these customers separately after their message, so they may already be answered. Check and tick them off.
              </p>
            )}
            <ReplySheet rows={list} maybe={showMaybe} />
          </>
        )}
        <SheetTabs
          tabs={[
            { key: 'waiting', label: 'Waiting for our reply', count: awaiting.length, href: '/', active: !showMaybe },
            { key: 'maybe', label: 'Maybe already answered', count: maybe.length, href: '/?tab=maybe', active: showMaybe },
          ]}
        />
      </div>
    </SheetPage>
  );
}
