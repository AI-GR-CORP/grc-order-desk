'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { THREAD_CATEGORIES } from '@grc/core';
import type { ActionResult } from '@/app/actions/result';
import { markHandledOffline, markThreadReviewed, reprocessThread, setThreadCategory, setThreadCompany, snoozeThread } from '@/app/actions/threads';
import { cx } from '@/lib/format';
import { Button, inputClass } from './ui';

const CATEGORY_LABELS: Record<string, string> = {
  unclassified: 'Not sorted yet',
  development: 'Development',
  bulk: 'Bulk order',
  mixed: 'Development + bulk',
  payment: 'Payment (not tracked)',
  other: 'Other (not tracked)',
  ignored: 'Ignore',
};

export function ThreadActions({
  threadId,
  category,
  companyId,
  companies,
  needsReview,
}: {
  threadId: string;
  category: string;
  companyId: string | null;
  companies: { id: string; name: string }[];
  needsReview: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const run = (p: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await p();
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });

  return (
    <div className={cx('space-y-4', pending && 'opacity-70')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px]">
          <span className="font-medium">Customer</span>
          <select
            className={cx(inputClass, 'mt-1')}
            defaultValue={companyId ?? ''}
            onChange={(e) => run(() => setThreadCompany(threadId, e.target.value || null), 'Customer updated')}
          >
            <option value="">Unknown</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block text-[13px]">
          <span className="font-medium">Type of work</span>
          <select
            className={cx(inputClass, 'mt-1')}
            defaultValue={category}
            onChange={(e) => run(() => setThreadCategory(threadId, e.target.value), 'Type updated')}
          >
            {THREAD_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How was it handled? e.g. called Ravi" className={cx(inputClass, 'max-w-xs')} aria-label="Note" />
        <Button size="sm" onClick={() => run(() => markHandledOffline(threadId, note), 'Marked as handled')}>Handled outside email</Button>
        <Button size="sm" variant="ghost" onClick={() => run(() => snoozeThread(threadId, 120), 'Snoozed for 2 hours')}>Snooze 2 h</Button>
        <Button size="sm" variant="ghost" onClick={() => run(() => reprocessThread(threadId), 'Queued. The summary refreshes in a minute.')}>Re-read with AI</Button>
        {needsReview && <Button size="sm" variant="ghost" onClick={() => run(() => markThreadReviewed(threadId), 'Marked as checked')}>Looks right</Button>}
      </div>
    </div>
  );
}
