'use client';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

/** A column header that sorts when clicked. The th carries aria-sort for screen readers. */
export function SortHeader({ label, colKey, sort, onSort }: { label: string; colKey: string; sort: SortState | null; onSort: (s: SortState | null) => void }) {
  const active = sort?.key === colKey;
  const next = (): SortState | null => {
    if (!active) return { key: colKey, dir: colKey === 'last_email' ? 'desc' : 'asc' };
    if (sort!.dir === (colKey === 'last_email' ? 'desc' : 'asc')) return { key: colKey, dir: sort!.dir === 'asc' ? 'desc' : 'asc' };
    return null;
  };
  return (
    <button type="button" className="sort" onClick={() => onSort(next())} title={`Sort by ${label.toLowerCase()}`}>
      {label}
      <svg viewBox="0 0 12 12" className={cx('size-3', active ? 'text-indigo' : 'text-faint')} aria-hidden fill="currentColor">
        {(!active || sort!.dir === 'asc') && <path d="M6 2 9 5.5H3z" opacity={active ? 1 : 0.6} />}
        {(!active || sort!.dir === 'desc') && <path d="M6 10 3 6.5h6z" opacity={active ? 1 : 0.6} />}
      </svg>
    </button>
  );
}

export function ariaSort(sort: SortState | null, key: string): 'ascending' | 'descending' | undefined {
  return sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
}

/** Remembers which columns someone wants on this screen, on this computer. */
export function useColumns(storageKey: string, defaults: string[]) {
  const [cols, setCols] = useState<string[]>(defaults);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) setCols(parsed);
      }
    } catch {
      // storage unavailable: keep defaults
    }
  }, [storageKey]);
  const update = (next: string[]) => {
    setCols(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  return [cols, update] as const;
}

/** "Columns" button with a checklist to show or hide columns. */
export function ColumnsMenu({
  columns,
  visible,
  onChange,
  defaults,
}: {
  columns: { key: string; label: string; locked?: boolean }[];
  visible: string[];
  onChange: (next: string[]) => void;
  defaults: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (key: string, on: boolean) => {
    const order = columns.map((c) => c.key);
    const set = new Set(visible);
    if (on) set.add(key);
    else set.delete(key);
    onChange(order.filter((k) => set.has(k)));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13.5px] font-medium transition-colors duration-200',
          open ? 'border-indigo/30 bg-indigo-soft text-indigo' : 'border-line bg-surface text-ink-2 hover:bg-slate-soft',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-64 animate-fade-in rounded-xl border border-line bg-surface p-2 shadow-[0_12px_32px_rgba(15,23,42,0.14)]" role="group" aria-label="Show or hide columns">
          <p className="px-2 pb-1.5 pt-1 text-[12.5px] text-muted">Show these columns</p>
          <div className="max-h-80 overflow-y-auto">
            {columns.map((c) => (
              <label key={c.key} className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px]', c.locked ? 'text-faint' : 'hover:bg-slate-soft')}>
                <input
                  type="checkbox"
                  className="size-4 accent-[#1e40af]"
                  checked={visible.includes(c.key)}
                  disabled={c.locked}
                  onChange={(e) => toggle(c.key, e.target.checked)}
                />
                {c.label}
              </label>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1.5">
            <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-[13.5px] font-medium text-indigo hover:bg-indigo-soft" onClick={() => onChange(defaults)}>
              Reset to the usual columns
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
