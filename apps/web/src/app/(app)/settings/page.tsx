import { AccessRulesForm, ColumnLabelsForm, MailboxControls, PendingUserRow, RelockGmailForm, ReplyRulesForm, TeamMemberForm, UserRow } from '@/components/settings-forms';
import { buttonClass, PageHeader, Panel } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { ago } from '@/lib/format';
import { getMailboxes, getSettings } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Settings' };

const GMAIL_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Gmail connected. The first import has started; it usually takes 10–30 minutes.' },
  cancelled: { ok: false, text: 'Gmail wasn’t connected: the Google screen was closed or access was declined.' },
  forbidden: { ok: false, text: 'Only an owner can connect Gmail.' },
  state: { ok: false, text: 'The Google sign-in expired. Try connecting again.' },
  exchange: { ok: false, text: 'Google didn’t accept the sign-in. Check the OAuth client ID, secret and redirect URI.' },
  no_refresh: { ok: false, text: 'Google didn’t grant offline access. Remove the app under Google Account → Security → Third-party access, then connect again.' },
  scope: { ok: false, text: 'Read access to Gmail wasn’t granted. Tick the Gmail permission on the Google screen.' },
  save: { ok: false, text: 'Connected to Google but couldn’t save the connection. Check the server logs.' },
};

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for the worker to start the import',
  backfilling: 'Importing past emails',
  active: 'Connected',
  needs_reconnect: 'Disconnected: Google access was revoked or expired',
  paused: 'Paused',
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const { gmail } = await searchParams;
  const user = await requireUser();
  const supabase = await createSupabase();
  const [mailboxes, settings, users, pending, team, usage] = await Promise.all([
    getMailboxes(supabase),
    getSettings(supabase),
    supabase.from('app_user').select('user_id, email, role').order('email'),
    user.isAdmin ? supabase.rpc('list_pending_users') : Promise.resolve({ data: [] }),
    supabase.from('team_member').select('*').order('name'),
    user.isAdmin ? supabase.from('v_ai_usage_month').select('*') : Promise.resolve({ data: [] }),
  ]);
  const msg = gmail ? GMAIL_MESSAGES[gmail] : null;
  const usageRows = (usage.data ?? []) as { purpose: string; model: string; calls: number; cost_usd: number; failures: number }[];
  const totalUsd = usageRows.reduce((n, r) => n + Number(r.cost_usd), 0);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6 p-6 lg:p-8">
        {msg && (
          <p role="status" className={msg.ok ? 'rounded-md border border-teal/30 bg-teal-soft px-3 py-2 text-[13px] text-teal' : 'rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[13px] text-red'}>
            {msg.text}
          </p>
        )}

        <Panel
          title="Gmail"
          action={user.isAdmin && <a href="/api/gmail/connect" className={buttonClass(mailboxes.length ? 'secondary' : 'primary', 'sm')}>{mailboxes.length ? 'Reconnect Gmail' : 'Connect Gmail'}</a>}
        >
          {mailboxes.length === 0 ? (
            <p className="p-4 text-[13.5px] text-muted">
              Connect the main mailbox with read-only access. Sign in with that mailbox’s Google account on the next screen. You can remove
              access any time from the Google account’s security settings.
            </p>
          ) : (
            <ul className="divide-y divide-line-2">
              {mailboxes.map((mb) => (
                <li key={mb.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-[13.5px]">
                  <div>
                    <div className="font-medium">{mb.email}</div>
                    <div className={mb.status === 'needs_reconnect' ? 'text-red' : 'text-muted'}>
                      {STATUS_TEXT[mb.status] ?? mb.status}
                      {mb.status === 'active' && `, last checked ${ago(mb.last_synced_at)}`}
                    </div>
                    {mb.last_error && <div className="mt-1 max-w-2xl text-[12.5px] text-red">{mb.last_error}</div>}
                  </div>
                  {user.isAdmin && <MailboxControls id={mb.id} status={mb.status} failed={Boolean(mb.last_error) && mb.status !== 'active'} />}
                </li>
              ))}
            </ul>
          )}
          {user.isAdmin && mailboxes.length > 0 && <RelockGmailForm />}
        </Panel>

        <Panel title="Reply rules">
          <ReplyRulesForm
            sla={settings.reply_sla_minutes}
            realert={settings.realert_minutes}
            nonMoving={settings.non_moving_days}
            hours={settings.business_hours}
            canEdit={user.isAdmin}
          />
        </Panel>

        <Panel title="People with access">
          <ul className="divide-y divide-line-2 text-[13.5px]">
            {((users.data ?? []) as { user_id: string; email: string | null; role: string }[]).map((u) =>
              user.isAdmin ? <UserRow key={u.user_id} user={u} me={user.id} /> : (
                <li key={u.user_id} className="flex justify-between px-4 py-2.5"><span>{u.email}</span><span className="text-muted">{u.role}</span></li>
              ),
            )}
          </ul>
          {((pending.data ?? []) as { user_id: string; email: string }[]).length > 0 && (
            <>
              <h3 className="border-t border-line px-4 pb-1 pt-3 text-[13px] font-semibold">Asked for access</h3>
              <ul className="divide-y divide-line-2 text-[13.5px]">
                {((pending.data ?? []) as { user_id: string; email: string }[]).map((p) => <PendingUserRow key={p.user_id} user={p} />)}
              </ul>
            </>
          )}
          {user.isAdmin && (
            <div className="border-t border-line">
              <AccessRulesForm domains={settings.login_domains} owners={settings.owner_emails} />
            </div>
          )}
        </Panel>

        <Panel title="GRC team" action={<span className="text-[12px] text-muted">Used to show who is handling each thread</span>}>
          <div className="divide-y divide-line-2">
            {((team.data ?? []) as { id: string; name: string; email: string | null; role: string | null; active: boolean }[]).map((m) =>
              user.isAdmin ? <TeamMemberForm key={m.id} member={m} /> : (
                <div key={m.id} className="px-4 py-2.5 text-[13.5px]">{m.name} <span className="text-muted">{m.email}</span></div>
              ),
            )}
            {user.isAdmin && <TeamMemberForm />}
          </div>
        </Panel>

        {user.isAdmin && (
          <>
            <Panel title="Column names">
              <ColumnLabelsForm labels={settings.column_labels} />
            </Panel>
            <Panel title="AI usage this month" action={<span className="text-[13px] font-semibold tabular-nums">${totalUsd.toFixed(2)}</span>}>
              {usageRows.length === 0 ? (
                <p className="p-4 text-[13px] text-muted">No AI calls yet this month.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="text-left text-[12px] text-muted">
                    <tr className="border-b border-line-2"><th className="px-4 py-2 font-medium">Task</th><th className="px-4 py-2 font-medium">Model</th><th className="px-4 py-2 text-right font-medium">Calls</th><th className="px-4 py-2 text-right font-medium">Failed</th><th className="px-4 py-2 text-right font-medium">Cost (est.)</th></tr>
                  </thead>
                  <tbody>
                    {usageRows.map((r) => (
                      <tr key={r.purpose + r.model} className="border-b border-line-2">
                        <td className="px-4 py-2">{r.purpose}</td>
                        <td className="px-4 py-2 text-muted">{r.model}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.calls}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.failures || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">${Number(r.cost_usd).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
