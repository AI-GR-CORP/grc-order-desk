import Link from 'next/link';
import { DEV_STAGES, type NeedsReplyRow } from '@grc/core';
import { NeedsReplyList } from '@/components/needs-reply-list';
import { Selvedge, toneBg } from '@/components/stage';
import { Empty, LinkButton, PageHeader, Panel } from '@/components/ui';
import { getAppUser } from '@/lib/auth';
import { fetchAll, getMailboxes, getSettings } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Needs reply' };

export default async function HomePage() {
  const supabase = await createSupabase();
  const user = await getAppUser();
  const [mailboxes, settings, needs, stages, waitingOnCustomer, nonMoving, bulkOpen] = await Promise.all([
    getMailboxes(supabase),
    getSettings(supabase),
    supabase.from('v_needs_reply').select('*').order('reply_due_at', { ascending: true, nullsFirst: false }).limit(200),
    fetchAll<{ stage: string }>((a, b) => supabase.from('dev_item').select('stage').not('stage', 'in', '(closed,converted_to_bulk)').range(a, b)),
    supabase.from('email_thread').select('id', { count: 'exact', head: true }).eq('waiting_on', 'customer').in('category', ['development', 'bulk', 'mixed']),
    supabase.from('v_non_moving').select('id', { count: 'exact', head: true }),
    supabase.from('bulk_order').select('id', { count: 'exact', head: true }).not('status', 'in', '(completed,cancelled)'),
  ]);
  const rows = (needs.data ?? []) as NeedsReplyRow[];
  const awaiting = rows.filter((r) => r.reply_state === 'awaiting').length;
  const byStage = new Map<string, number>();
  for (const s of stages) byStage.set(s.stage, (byStage.get(s.stage) ?? 0) + 1);

  if (mailboxes.length === 0) {
    return (
      <>
        <PageHeader title="Needs reply" />
        <Empty title="Connect the main Gmail mailbox to start">
          The dashboard reads customer emails (read-only), sorts development and bulk work, and warns you when a customer has waited more
          than {settings.reply_sla_minutes} minutes.
          {user?.isAdmin && <div className="mt-4"><LinkButton href="/settings" variant="primary">Go to Settings</LinkButton></div>}
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Needs reply"
        detail={awaiting === 0 ? 'Every customer email that needs an answer has one.' : `${awaiting} customer ${awaiting === 1 ? 'email is' : 'emails are'} waiting on GRC. Reply time: ${settings.reply_sla_minutes} min in working hours.`}
      />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-8">
        <Panel>
          {rows.length === 0 ? (
            <Empty title="Nothing waiting">New customer emails appear here within 5 minutes of arriving.</Empty>
          ) : (
            <NeedsReplyList rows={rows} />
          )}
        </Panel>
        <div className="space-y-6">
          <Panel title="Open development" action={<Link href="/development" className="text-[12.5px] text-indigo hover:underline">Open sheet</Link>}>
            <div className="p-4">
              <Selvedge stages={stages.map((s) => s.stage)} className="mb-3 h-2" />
              <ul className="space-y-1 text-[13px]">
                {DEV_STAGES.filter((s) => byStage.get(s.key)).map((s) => (
                  <li key={s.key} className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><span className={`size-2 rounded-sm ${toneBg[s.tone]}`} />{s.label}</span>
                    <span className="tabular-nums text-muted">{byStage.get(s.key)}</span>
                  </li>
                ))}
                {stages.length === 0 && <li className="text-muted">No items yet.</li>}
              </ul>
            </div>
          </Panel>
          <Panel>
            <dl className="divide-y divide-line-2 text-[13px]">
              <div className="flex items-center justify-between px-4 py-3">
                <dt>Waiting on customers</dt>
                <dd className="font-semibold tabular-nums">{waitingOnCustomer.count ?? 0}</dd>
              </div>
              <Link href="/development?view=non-moving" className="flex items-center justify-between px-4 py-3 hover:bg-line-2">
                <dt>Not moving for {settings.non_moving_days}+ days</dt>
                <dd className="font-semibold tabular-nums text-mustard">{nonMoving.count ?? 0}</dd>
              </Link>
              <Link href="/bulk" className="flex items-center justify-between px-4 py-3 hover:bg-line-2">
                <dt>Bulk orders in progress</dt>
                <dd className="font-semibold tabular-nums">{bulkOpen.count ?? 0}</dd>
              </Link>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
