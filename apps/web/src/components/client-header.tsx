'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setClientApproval } from '@/app/actions/approvals';
import { updateCompany } from '@/app/actions/companies';
import type { ActionResult } from '@/app/actions/result';
import { cx } from '@/lib/format';
import { Button, inputClass } from './ui';

/** The client's name in a yellow cell like the sheet, with Rename / City and Approve or Ignore. */
export function ClientHeader({
  id,
  name,
  city,
  region,
  approval,
  isAdmin,
}: {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  approval: 'pending' | 'approved' | 'rejected';
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name, city: city ?? '', region: region ?? '' });
  const [busy, start] = useTransition();
  const act = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      after?.();
    });

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => updateCompany(id, { name: draft.name, city: draft.city, region: draft.region }), 'Saved', () => setEditing(false));
        }}
      >
        <label className="text-[12.5px] font-medium text-muted">Company name<input className={cx(inputClass, 'mt-1 w-64 font-bold')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="text-[12.5px] font-medium text-muted">City<input className={cx(inputClass, 'mt-1 w-40')} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></label>
        <label className="text-[12.5px] font-medium text-muted">Region<input className={cx(inputClass, 'mt-1 w-40')} value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="Domestic, Export…" /></label>
        <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em]">{name}</h1>
      {approval === 'approved' && <span className="rounded-full bg-teal-soft px-2.5 py-[3px] text-[12px] font-medium text-teal">Approved client</span>}
      {approval === 'pending' && <span className="rounded-full bg-mustard-soft px-2.5 py-[3px] text-[12px] font-medium text-mustard">Waiting for approval</span>}
      {approval === 'rejected' && <span className="rounded-full bg-slate-soft px-2.5 py-[3px] text-[12px] font-medium text-muted">Ignored</span>}
      <span className="text-[14.5px] text-muted">{[city, region].filter(Boolean).join(', ') || 'City not set'}</span>
      <button onClick={() => setEditing(true)} className="text-[13.5px] font-medium text-indigo hover:underline">Edit</button>
      {isAdmin && approval !== 'approved' && (
        <span className="ml-auto flex gap-2">
          {approval === 'pending' && <Button size="sm" disabled={busy} onClick={() => act(() => setClientApproval([id], 'rejected'), 'Ignored')}>Ignore</Button>}
          <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), 'Approved. Reading their emails now.')}>Approve client</Button>
        </span>
      )}
    </div>
  );
}
