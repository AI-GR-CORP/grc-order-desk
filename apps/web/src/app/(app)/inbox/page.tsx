import { InboxList, type InboxRow } from '@/components/inbox-list';
import { GridCard, SheetPage, SheetTabs } from '@/components/sheet';
import { CountPill, Empty, TitleBar } from '@/components/ui';
import { fetchAll } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Inbox' };

const DAY = 864e5;
const TABS = [
  { key: 'new', label: 'New enquiries' },
  { key: 'replies', label: 'Replies' },
  { key: 'all', label: 'All customer mail' },
  { key: 'filtered', label: 'Filtered out' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Every email from customers, newest first: GRC shouldn't need Gmail to read customer mail. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'all';
  const supabase = await createSupabase();
  const since14 = new Date(Date.now() - 14 * DAY).toISOString();
  const since60 = new Date(Date.now() - 60 * DAY).toISOString();

  const all = await fetchAll<InboxRow>((a, b) =>
    supabase.from('v_inbox').select('*').in('bucket', ['customer', 'filtered']).gte('last_inbound_at', since60).order('last_inbound_at', { ascending: false }).range(a, b),
  );
  // Older customer mail (beyond 60 days) only on the "All" tab.
  const older =
    tab === 'all'
      ? await fetchAll<InboxRow>((a, b) =>
          supabase.from('v_inbox').select('*').eq('bucket', 'customer').lt('last_inbound_at', since60).order('last_inbound_at', { ascending: false }).range(a, b),
        )
      : [];

  const customer = all.filter((r) => r.bucket === 'customer');
  const lists: Record<Tab, InboxRow[]> = {
    new: customer.filter((r) => r.started_by_customer && r.first_message_at && r.first_message_at >= since14),
    replies: customer.filter((r) => r.is_reply),
    all: [...customer, ...older],
    filtered: all.filter((r) => r.bucket === 'filtered'),
  };
  const unread = (rows: InboxRow[]) => rows.filter((r) => r.unread).length;
  const filteredReal = lists.filtered.filter((r) => !r.is_noise).length;

  const empty: Record<Tab, React.ReactNode> = {
    new: <Empty title="No new enquiries in the last 14 days" />,
    replies: <Empty title="No customer replies yet" />,
    all: <Empty title="No customer emails yet">They appear here within minutes of arriving.</Empty>,
    filtered: <Empty title="Nothing filtered out">Every email from outside GRC is being tracked.</Empty>,
  };

  return (
    <SheetPage>
      <TitleBar
        title="Inbox"
        pills={
          <>
            <CountPill tone={unread(customer) ? 'indigo' : 'slate'}>{unread(customer)} unread</CountPill>
            {lists.new.length > 0 && <CountPill tone="mustard">{lists.new.length} new enquiries in 14 days</CountPill>}
            {filteredReal > 0 && <CountPill tone="slate" title="Emails from outside GRC that the AI set aside. Check them once in a while.">{filteredReal} filtered out</CountPill>}
          </>
        }
      />
      <GridCard>
        <InboxList
          rows={lists[tab]}
          filtered={tab === 'filtered'}
          empty={empty[tab]}
          tabs={
            <SheetTabs
              tabs={TABS.map((t) => ({
                key: t.key,
                label: t.label,
                count: t.key === 'filtered' ? filteredReal : unread(lists[t.key]) || lists[t.key].length,
                href: `/inbox?tab=${t.key}`,
                active: t.key === tab,
              }))}
            />
          }
        />
      </GridCard>
    </SheetPage>
  );
}
