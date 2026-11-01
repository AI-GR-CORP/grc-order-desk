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
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => updateCompany(id, { name: draft.name, city: draft.city, region: draft.region }), 'Saved', () => setEditing(false));
        }}
      >
        <label className="text-[12px] text-muted">COMPANY NAME<input className={cx(inputClass, 'mt-1 w-64 font-bold')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="text-[12px] text-muted">City<input className={cx(inputClass, 'mt-1 w-40')} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></label>
        <label className="text-[12px] text-muted">Region<input className={cx(inputClass, 'mt-1 w-40')} value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="Domestic, Export…" /></label>
        <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="border border-black bg-company px-4 py-1.5 text-[22px] font-bold leading-tight text-black">{name}</h1>
      <span className="text-[14px] text-ink-2">{[city, region].filter(Boolean).join(', ') || 'City not set'}</span>
      <button onClick={() => setEditing(true)} className="text-[13.5px] text-indigo hover:underline">Edit name or city</button>
      {isAdmin && approval === 'pending' && (
        <span className="flex items-center gap-2">
          <span className="rounded bg-mustard-soft px-2 py-0.5 text-[13px] font-bold text-mustard">Waiting for approval</span>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), 'Approved. Reading their emails now.')}>Approve</Button>
          <Button size="sm" disabled={busy} onClick={() => act(() => setClientApproval([id], 'rejected'), 'Ignored')}>Ignore</Button>
        </span>
      )}
      {approval === 'rejected' && (
        <span className="flex items-center gap-2">
          <span className="rounded bg-slate-soft px-2 py-0.5 text-[13px] font-bold text-ink-2">Ignored</span>
          {isAdmin && <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setClientApproval([id], 'approved'), 'Approved')}>Approve</Button>}
        </span>
      )}
    </div>
  );
}
