'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ORDER_TOPICS, topicLabel } from '@grc/core';
import { confirmThreadType, setThreadType } from '@/app/actions/threads';
import { cx } from '@/lib/format';
import { Button } from './ui';

export interface TypeInfo {
  threadId: string | null;
  kind: string;
  topics: string[];
  needsCheck: boolean;
  checked: boolean;
  confidence: number | null;
  reason: string | null;
}

const KIND: Record<string, { label: string; cls: string }> = {
  development: { label: 'Development', cls: 'bg-indigo-soft text-indigo' },
  bulk: { label: 'Bulk', cls: 'bg-teal-soft text-teal' },
  mixed: { label: 'Choose type', cls: 'bg-mustard-soft text-mustard' },
};
const pill = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12.5px] font-medium';

/** Type and topics as shown in a cell (no editing). */
export function TypeBadges({ info }: { info: Pick<TypeInfo, 'kind' | 'topics' | 'needsCheck' | 'checked'> }) {
  const k = KIND[info.kind] ?? { label: info.kind, cls: 'bg-slate-soft text-ink-2' };
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex items-center gap-1.5">
        <span className={cx(pill, k.cls)}>{k.label}</span>
        {info.checked && (
          <span className="text-green" title="Checked by GRC" aria-label="Checked by GRC">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
        )}
      </span>
      {info.topics.map((t) => (
        <span key={t} className="whitespace-nowrap rounded-md border border-line bg-surface px-1.5 py-[1px] text-[12px] font-medium text-ink-2">
          {topicLabel(t)}
        </span>
      ))}
      {info.needsCheck && !info.checked && (
        <span className={cx(pill, 'bg-mustard-soft py-[1px] text-[12px] text-mustard')}>Please check</span>
      )}
    </span>
  );
}

/** The editor: choose Development or Bulk, tick topics, save; or confirm the AI is right. */
export function TypeEditor({ info, onDone }: { info: TypeInfo; onDone?: () => void }) {
  const start = info.kind === 'development' || info.kind === 'bulk' ? info.kind : null;
  const [kind, setKind] = useState<'development' | 'bulk' | null>(start);
  const [topics, setTopics] = useState<string[]>(info.topics);
  const [busy, run] = useTransition();
  const changed = kind !== start || [...topics].sort().join() !== [...info.topics].sort().join();

  const save = () =>
    run(async () => {
      if (!info.threadId || !kind) return;
      const r = await setThreadType(info.threadId, kind, topics);
      if (!r.ok) return void toast.error(r.error);
      toast.success(changed ? 'Saved. The AI will remember this.' : 'Saved');
      onDone?.();
    });
  const confirm = () =>
    run(async () => {
      if (!info.threadId) return;
      const r = await confirmThreadType(info.threadId);
      if (!r.ok) return void toast.error(r.error);
      toast.success('Marked as checked');
      onDone?.();
    });

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Order type</legend>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Order type">
          {(['development', 'bulk'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cx(
                'h-9 rounded-lg border text-[14px] font-medium transition-colors duration-150',
                kind === k ? (k === 'bulk' ? 'border-teal bg-teal-soft text-teal' : 'border-indigo bg-indigo-soft text-indigo') : 'border-line bg-surface text-ink-2 hover:bg-slate-soft',
              )}
            >
              {k === 'bulk' ? 'Bulk' : 'Development'}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold text-ink-2">Also about</legend>
        <div className="space-y-0.5">
          {ORDER_TOPICS.map((t) => (
            <label key={t.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[14px] hover:bg-slate-soft">
              <input
                type="checkbox"
                className="size-4 accent-[#1e40af]"
                checked={topics.includes(t.key)}
                onChange={(e) => setTopics((s) => (e.target.checked ? [...s, t.key] : s.filter((x) => x !== t.key)))}
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {info.reason && !info.checked && (
        <p className="rounded-lg bg-ground px-3 py-2 text-[13px] leading-snug text-muted">
          <span className="font-medium text-ink-2">
            AI{info.confidence != null ? `, ${Math.round(info.confidence * 100)}% sure` : ''}:
          </span>{' '}
          {info.reason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={busy || !kind || !info.threadId} onClick={save}>
          Save
        </Button>
        {!changed && start && !info.checked && (
          <Button size="sm" disabled={busy || !info.threadId} onClick={confirm}>
            Looks right
          </Button>
        )}
        {onDone && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/** A Type cell: badges, and a click opens the editor in a small popover. */
export function TypeCell({ info }: { info: TypeInfo }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!info.threadId) return <TypeBadges info={info} />;

  const toggle = () => {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      const height = 360;
      const top = r.bottom + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : r.bottom + 4;
      setPos({ top, left: Math.min(r.left, window.innerWidth - 300) });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Change the type or topics"
        className="-m-1 rounded-lg p-1 text-left hover:bg-slate-soft"
      >
        <TypeBadges info={info} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={box}
            role="dialog"
            aria-label="Order type and topics"
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-[288px] animate-fade-in rounded-xl border border-line bg-surface p-4 shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
          >
            <TypeEditor info={info} onDone={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}
