'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { DEV_COLUMNS, type BusinessHours } from '@grc/core';
import type { ActionResult } from '@/app/actions/result';
import {
  grantAccess,
  removeAccess,
  retryImport,
  saveAccessRules,
  saveColumnLabels,
  saveReplyRules,
  saveTeamMember,
  setMailboxPaused,
} from '@/app/actions/settings';
import { cx } from '@/lib/format';
import { Button, Field, inputClass } from './ui';

function useAction() {
  const [pending, start] = useTransition();
  const run = (p: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await p();
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });
  return { pending, run };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ReplyRulesForm({
  sla,
  realert,
  nonMoving,
  hours,
  canEdit,
}: {
  sla: number;
  realert: number;
  nonMoving: number;
  hours: BusinessHours;
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [s, setS] = useState(sla);
  const [r, setR] = useState(realert);
  const [n, setN] = useState(nonMoving);
  const [days, setDays] = useState(hours.days);
  const [start, setStart] = useState(hours.start);
  const [end, setEnd] = useState(hours.end);
  const [holidays, setHolidays] = useState(hours.holidays.join(', '));
  return (
    <form
      className="grid gap-4 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveReplyRules({ slaMinutes: s, realertMinutes: r, nonMovingDays: n, days, start, end, holidays }), 'Reply rules saved');
      }}
    >
      <Field label="Reply within (minutes)" hint="Customer emails unanswered this long trigger the pop-up.">
        <input type="number" min={5} className={inputClass} value={s} onChange={(e) => setS(Number(e.target.value))} disabled={!canEdit} />
      </Field>
      <Field label="Remind again every (minutes)">
        <input type="number" min={5} className={inputClass} value={r} onChange={(e) => setR(Number(e.target.value))} disabled={!canEdit} />
      </Field>
      <Field label="Working days" hint="The reply clock only runs on these days.">
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d, i) => (
            <button
              type="button"
              key={d}
              disabled={!canEdit}
              aria-pressed={days.includes(i)}
              onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i].sort()))}
              className={cx('h-8 w-11 rounded border text-[12.5px]', days.includes(i) ? 'border-indigo bg-indigo-soft text-indigo' : 'border-line text-muted')}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Working hours (IST)">
        <div className="flex items-center gap-2">
          <input type="time" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} disabled={!canEdit} />
          <span className="text-muted">to</span>
          <input type="time" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} disabled={!canEdit} />
        </div>
      </Field>
      <Field label="Holidays" hint="Dates as YYYY-MM-DD, separated by commas.">
        <input className={inputClass} value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-11-08, 2026-12-25" disabled={!canEdit} />
      </Field>
      <Field label="Call an inquiry “not moving” after (days)">
        <input type="number" min={1} className={inputClass} value={n} onChange={(e) => setN(Number(e.target.value))} disabled={!canEdit} />
      </Field>
      {canEdit && (
        <div className="sm:col-span-2">
          <Button variant="primary" disabled={pending}>Save reply rules</Button>
        </div>
      )}
    </form>
  );
}

export function MailboxControls({ id, status, failed }: { id: string; status: string; failed: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'paused' ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => setMailboxPaused(id, false), 'Sync resumed')}>Resume sync</Button>
      ) : status === 'active' ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setMailboxPaused(id, true), 'Sync paused')}>Pause sync</Button>
      ) : null}
      {failed && <Button size="sm" disabled={pending} onClick={() => run(() => retryImport(id), 'Import restarted')}>Retry import</Button>}
    </div>
  );
}

export function AccessRulesForm({ domains, owners }: { domains: string[]; owners: string[] }) {
  const { pending, run } = useAction();
  const [d, setD] = useState(domains.join(', '));
  const [o, setO] = useState(owners.join(', '));
  return (
    <form
      className="grid gap-4 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAccessRules({ loginDomains: d, ownerEmails: o }), 'Access rules saved');
      }}
    >
      <Field label="Let anyone from these domains in" hint="New sign-ins from these domains get staff access.">
        <input className={inputClass} value={d} onChange={(e) => setD(e.target.value)} />
      </Field>
      <Field label="Owner emails" hint="These people get owner access the first time they sign in.">
        <input className={inputClass} value={o} onChange={(e) => setO(e.target.value)} />
      </Field>
      <div className="sm:col-span-2"><Button disabled={pending}>Save access rules</Button></div>
    </form>
  );
}

export function UserRow({ user, me }: { user: { user_id: string; email: string | null; role: string }; me: string }) {
  const { pending, run } = useAction();
  return (
    <li className={cx('flex flex-wrap items-center justify-between gap-2 px-4 py-2.5', pending && 'opacity-60')}>
      <span>{user.email ?? user.user_id}</span>
      <div className="flex items-center gap-2">
        <select
          className={cx(inputClass, 'h-8 w-28 py-0')}
          defaultValue={user.role}
          disabled={user.user_id === me}
          onChange={(e) => run(() => grantAccess(user.user_id, e.target.value as 'owner' | 'staff'), 'Role updated')}
          aria-label="Role"
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
          <option value="owner">Owner</option>
        </select>
        {user.user_id !== me && <Button size="sm" variant="danger" onClick={() => run(() => removeAccess(user.user_id), 'Access removed')}>Remove</Button>}
      </div>
    </li>
  );
}

export function PendingUserRow({ user }: { user: { user_id: string; email: string } }) {
  const { pending, run } = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <span>{user.email}</span>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => grantAccess(user.user_id, 'staff'), 'Access granted')}>Let in as staff</Button>
    </li>
  );
}

export function TeamMemberForm({ member }: { member?: { id: string; name: string; email: string | null; role: string | null; active: boolean } }) {
  const { pending, run } = useAction();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [role, setRole] = useState(member?.role ?? '');
  const [active, setActive] = useState(member?.active ?? true);
  return (
    <form
      className="grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_1.4fr_1fr_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveTeamMember({ id: member?.id, name, email, role, active }), member ? 'Saved' : 'Team member added');
        if (!member) {
          setName('');
          setEmail('');
          setRole('');
        }
      }}
    >
      <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
      <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@grcorporation.co.in" aria-label="Email" />
      <input className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Development / Bulk" aria-label="Role" />
      <label className="flex items-center gap-1.5 text-[13px]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <Button size="sm" disabled={pending || !name.trim()}>{member ? 'Save' : 'Add'}</Button>
    </form>
  );
}

export function ColumnLabelsForm({ labels }: { labels: Record<string, string> }) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState<Record<string, string>>(labels);
  const editable = DEV_COLUMNS.filter((c) => ['team_status', 'next_action', 'owner_remark', 'brand_status', 'merchant_name'].includes(c.key));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveColumnLabels(draft), 'Column names saved');
      }}
    >
      {editable.map((c) => (
        <Field key={c.key} label={c.label} hint={`Was “${c.sheet}” in the old sheet`}>
          <input className={inputClass} value={draft[c.key] ?? ''} placeholder={c.label} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })} />
        </Field>
      ))}
      <div className="sm:col-span-2"><Button disabled={pending}>Save column names</Button></div>
    </form>
  );
}
