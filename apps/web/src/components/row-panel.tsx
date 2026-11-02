'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { setBulkStage, updateBulkField, updateDevField } from '@/app/actions/items';
import type { ActionResult } from '@/app/actions/result';
import { cx, gmailLink } from '@/lib/format';
import { cellValue, label, SHEET_COLUMNS, type SheetColumn, type SheetRow } from '@/lib/sheet';
import { BulkStatusText, ReplyCell, shortDate } from './sheet';
import { TypeBadges } from './type-cell';
import { buttonClass, inputClass } from './ui';
import type { BulkChecklist, StageDef } from './work-sheet';
import { TypeEditor } from './type-cell';
import { RowPictures } from './row-pictures';
import { rowTarget, type RowPic } from '@/lib/pictures';
import { typeInfo } from '@/lib/sheet';

/** Everything about one row, in a side panel: every column as a labelled field you can edit. */
export function RowPanel({
  row,
  labels,
  pictures,
  onClose,
  approveSlot,
  checklist,
  stageDefs,
}: {
  row: SheetRow;
  labels: Record<string, string>;
  pictures: RowPic[];
  onClose: () => void;
  approveSlot?: React.ReactNode;
  checklist?: BulkChecklist;
  stageDefs?: StageDef[];
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const editable = row.source === 'item' || row.source === 'bulk';
  const field = (c: SheetColumn) => (row.source === 'bulk' ? c.bulkField : c.devField);
  const main = SHEET_COLUMNS.filter((c) => !c.extra && field(c));
  const more = SHEET_COLUMNS.filter((c) => c.extra && field(c));
  const save = (c: SheetColumn) => (v: string | null) =>
    row.source === 'bulk' ? updateBulkField(row.item_id!, c.bulkField!, v) : updateDevField(row.item_id!, c.devField!, v);
  const title = row.source === 'thread' ? row.thread_subject || '(no subject)' : row.inquiry || row.thread_subject || 'Untitled row';

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-ink/25" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute right-0 top-0 flex h-full w-[min(540px,100vw)] animate-panel-in flex-col bg-surface shadow-[-12px_0_40px_rgba(15,23,42,0.16)]"
      >
        <header className="border-b border-line px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {row.company_id ? (
                <Link href={`/clients/${row.company_id}`} className="text-[13.5px] font-medium text-indigo hover:underline">
                  {row.company_name}
                </Link>
              ) : (
                <span className="text-[13.5px] font-medium text-muted">{row.company_name ?? 'Client not known yet'}</span>
              )}
              <h2 id={titleId} className="mt-1 text-[19px] font-semibold leading-snug">{title}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-slate-soft hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TypeBadges info={typeInfo(row)} />
            <ReplyCell state={row.reply_state} waitingOn={row.waiting_on} dueAt={row.reply_due_at} />
            {row.source === 'bulk' && <BulkStatusText status={row.stage} />}
            {row.last_at && <span className="text-[13px] text-muted">Last email {shortDate(row.last_at)}</span>}
          </div>
          {row.thread_id && (
            <div className="mt-4 flex flex-wrap gap-2">
              {row.gmail_thread_id && (
                <a href={gmailLink(row.mailbox_email, row.gmail_thread_id)} target="_blank" rel="noreferrer" className={buttonClass('primary', 'sm')}>
                  Open in Gmail
                </a>
              )}
              <Link href={`/threads/${row.thread_id}`} className={buttonClass('secondary', 'sm')}>
                Read {row.email_count === 1 ? 'the email' : `all ${row.email_count} emails`}
              </Link>
            </div>
          )}
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {approveSlot}

          {row.thread_id && (
            <section className="rounded-xl border border-line px-4 py-4">
              <TypeEditor key={`${row.row_kind}-${row.topics.join()}-${row.type_checked_at ?? ''}`} info={typeInfo(row)} />
            </section>
          )}

          <RowPictures pictures={pictures} target={rowTarget(row)} />

          {row.summary && (
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold text-muted">{row.source === 'thread' ? 'What the email is about' : 'Summary'}</h3>
              <p className="text-[14.5px] leading-relaxed text-ink-2">{row.summary}</p>
            </section>
          )}

          {row.source === 'thread' && (
            <section className="rounded-xl bg-ground px-4 py-3 text-[14px] text-ink-2">
              {row.merchant && (
                <p>
                  <span className="text-muted">From </span>
                  {row.merchant}
                </p>
              )}
              <p className="mt-1 text-muted">
                {row.company_approval === 'approved'
                  ? 'The AI turns this conversation into a sheet row after it reads the emails.'
                  : 'The sheet columns fill in after the client is approved and the AI reads their emails.'}
              </p>
            </section>
          )}

          {editable && (
            <section className="space-y-4">
              {main.map((c) => (
                <PanelField key={c.key} label={label(c, labels)} value={cellValue(row, c.key)} kind={c.kind} options={c.options} onSave={save(c)} locked={row.locked_fields.includes(field(c)!)} />
              ))}
            </section>
          )}

          {row.source === 'bulk' && stageDefs && stageDefs.length > 0 && (
            <section className="rounded-xl border border-line">
              <h3 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Bulk checklist</h3>
              <div className="space-y-4 px-4 py-4">
                {stageDefs.map((d) => {
                  const v = checklist?.stages[d.key];
                  const current = checklist?.current_stage === d.key;
                  return (
                    <PanelField
                      key={d.key}
                      label={current ? `${d.label} (latest step)` : d.label}
                      value={v?.value ?? null}
                      onSave={(val) => setBulkStage(row.item_id!, d.key, val)}
                      locked={v?.locked}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {editable && more.length > 0 && (
            <details className="group rounded-xl border border-line">
              <summary className="flex items-center justify-between px-4 py-3 text-[14px] font-semibold">
                More details
                <svg viewBox="0 0 24 24" className="size-4 text-muted transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="space-y-4 border-t border-line px-4 py-4">
                {more.map((c) => (
                  <PanelField key={c.key} label={label(c, labels)} value={cellValue(row, c.key)} kind={c.kind} options={c.options} onSave={save(c)} locked={row.locked_fields.includes(field(c)!)} />
                ))}
              </div>
            </details>
          )}

          {editable && (
            <p className="text-[13px] text-muted">
              Changes save when you click outside a field. Anything you type stays as you set it: the AI won’t change it later.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function PanelField({
  label: text,
  value,
  kind = 'text',
  options,
  onSave,
  locked,
}: {
  label: string;
  value: string | null;
  kind?: SheetColumn['kind'];
  options?: string[];
  onSave: (v: string | null) => Promise<ActionResult>;
  locked?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? '');
  const [saved, setSaved] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => {
    setDraft(value ?? '');
    setSaved(value ?? '');
  }, [value]);

  const commit = async (next: string) => {
    if (next.trim() === saved.trim()) return;
    setState('saving');
    const r = await onSave(next.trim() ? next.trim() : null);
    if (!r.ok) {
      setState('idle');
      setDraft(saved);
      toast.error(r.error);
      return;
    }
    setSaved(next.trim());
    setState('saved');
    setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2000);
  };

  const control =
    kind === 'select' && options ? (
      <select id={id} className={inputClass} value={draft} onChange={(e) => { setDraft(e.target.value); void commit(e.target.value); }}>
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    ) : kind === 'longtext' ? (
      <textarea id={id} rows={2} className={cx(inputClass, 'min-h-[68px] resize-y')} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit(draft)} />
    ) : (
      <input
        id={id}
        className={inputClass}
        value={draft}
        placeholder={kind === 'date' ? 'e.g. 26/10/2026' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13.5px] font-medium text-ink-2">{text}</label>
        <span className="text-[12.5px] text-muted" aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : locked ? 'Typed by a person' : ''}
        </span>
      </div>
      {control}
    </div>
  );
}
