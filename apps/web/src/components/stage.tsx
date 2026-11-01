import { BULK_STATUSES, DEV_STAGES, type Tone } from '@grc/core';
import { cx } from '@/lib/format';

const toneChip: Record<Tone, string> = {
  neutral: 'bg-slate-soft text-ink-2',
  waiting: 'bg-mustard-soft text-mustard',
  progress: 'bg-indigo-soft text-indigo',
  good: 'bg-teal-soft text-teal',
  alert: 'bg-red-soft text-red',
  muted: 'bg-line-2 text-muted',
};

export function StageChip({ stage, className }: { stage: string; className?: string }) {
  const s = DEV_STAGES.find((x) => x.key === stage);
  const tone = s?.tone ?? 'neutral';
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium', toneChip[tone], className)}>
      {s?.label ?? stage}
    </span>
  );
}

export function BulkStatusChip({ status }: { status: string }) {
  const s = BULK_STATUSES.find((x) => x.key === status);
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium', toneChip[s?.tone ?? 'neutral'])}>
      {s?.label ?? status}
    </span>
  );
}

export function ReplyBadge({ state, dueAt }: { state: string | null; dueAt?: string | null }) {
  if (state === 'awaiting') {
    const overdue = dueAt ? new Date(dueAt).getTime() < Date.now() : false;
    return (
      <span className={cx('rounded px-1.5 py-0.5 text-[12px] font-medium', overdue ? 'bg-red text-white' : 'bg-red-soft text-red')}>
        {overdue ? 'Reply overdue' : 'Needs reply'}
      </span>
    );
  }
  if (state === 'possibly_replied') return <span className="rounded bg-mustard-soft px-1.5 py-0.5 text-[12px] font-medium text-mustard">Maybe replied</span>;
  if (state === 'handled_offline') return <span className="rounded bg-teal-soft px-1.5 py-0.5 text-[12px] font-medium text-teal">Handled offline</span>;
  if (state === 'replied') return <span className="rounded bg-teal-soft px-1.5 py-0.5 text-[12px] font-medium text-teal">Replied</span>;
  return null;
}
