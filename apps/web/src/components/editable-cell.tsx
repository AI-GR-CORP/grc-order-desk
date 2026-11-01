'use client';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/app/actions/result';
import { cx } from '@/lib/format';

export interface EditableCellProps {
  value: string | null;
  onSave: (value: string | null) => Promise<ActionResult>;
  kind?: 'text' | 'longtext' | 'date' | 'select';
  options?: readonly { value: string; label: string }[];
  locked?: boolean;
  display?: ReactNode;
  placeholder?: string;
  className?: string;
}

/** Click to edit; Enter saves, Esc cancels. Hand edits are locked against AI updates. */
export function EditableCell({ value, onSave, kind = 'text', options, locked, display, placeholder, className }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [shown, setShown] = useState(value);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);

  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = (next: string) => {
    setEditing(false);
    const v = next.trim() ? next.trim() : null;
    if (v === (shown ?? null)) return;
    const prev = shown;
    setShown(v);
    start(async () => {
      const r = await onSave(v);
      if (!r.ok) {
        setShown(prev);
        toast.error(r.error);
      }
    });
  };

  if (editing) {
    const common = {
      ref,
      className: 'w-full rounded border border-indigo bg-surface px-1.5 py-1 text-[13px] outline-none ring-2 ring-indigo/15',
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          setEditing(false);
          setDraft(shown ?? '');
        }
        if (e.key === 'Enter' && !(kind === 'longtext' && e.shiftKey)) {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
        }
      },
    };
    if (kind === 'select' && options) {
      return (
        <select {...common} defaultValue={shown ?? ''} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    if (kind === 'longtext') {
      return <textarea {...common} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft)} />;
    }
    return (
      <input
        {...common}
        value={draft}
        placeholder={kind === 'date' ? 'dd/mm/yyyy' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(shown ?? '');
        setEditing(true);
      }}
      title={locked ? 'Edited by hand. The AI won’t change this cell.' : 'Click to edit'}
      className={cx(
        'group relative block w-full rounded px-1 py-0.5 text-left hover:bg-indigo-soft/60',
        pending && 'opacity-60',
        className,
      )}
    >
      {display ?? (shown ? <span className="whitespace-pre-wrap break-words">{shown}</span> : <span className="text-line">{placeholder ?? '—'}</span>)}
      {locked && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-indigo" aria-label="edited by hand" />}
    </button>
  );
}
