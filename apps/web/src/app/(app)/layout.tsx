import { NavRail } from '@/components/nav-rail';
import { OverdueWatcher } from '@/components/overdue-watcher';
import { SyncStatus } from '@/components/sync-status';
import { requireUser } from '@/lib/auth';
import { getMailboxes, getSettings } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createSupabase();
  const [mailboxes, settings, needs, threadsToReview, companiesToReview] = await Promise.all([
    getMailboxes(supabase),
    getSettings(supabase),
    supabase.from('v_needs_reply').select('id', { count: 'exact', head: true }).eq('reply_state', 'awaiting'),
    supabase.from('email_thread').select('id', { count: 'exact', head: true }).eq('needs_review', true).in('category', ['development', 'bulk', 'mixed']),
    supabase.from('company').select('id', { count: 'exact', head: true }).eq('needs_review', true).is('merged_into', null),
  ]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <NavRail
        email={user.email}
        counts={{ needsReply: needs.count ?? 0, review: (threadsToReview.count ?? 0) + (companiesToReview.count ?? 0) }}
        sync={<SyncStatus mailboxes={mailboxes} />}
      />
      <main className="min-w-0">{children}</main>
      <OverdueWatcher realertMinutes={settings.realert_minutes} />
    </div>
  );
}
