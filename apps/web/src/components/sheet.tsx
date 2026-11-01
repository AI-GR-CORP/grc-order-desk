import Link from 'next/link';
import type { ReactNode } from 'react';
import { BULK_STATUSES } from '@grc/core';
import { cx, gmailLink } from '@/lib/format';

/** "29 Oct", or "29 Oct 2025" for another year. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: iso.length === 10 ? 'UTC' : 'Asia/Kolkata' });
}

const pill = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12.5px] font-medium';

const TYPE: Record<string, { label: string; cls: string }> = {
  development: { label: 'Development', cls: 'bg-indigo-soft text-indigo' },
  bulk: { label: 'Bulk', cls: 'bg-teal-soft text-teal' },
  mixed: { label: 'Dev + bulk', cls: 'bg-mustard-soft text-mustard' },
};

export function TypeChip({ kind }: { kind: string }) {
  const t = TYPE[kind] ?? { label: kind, cls: 'bg-slate-soft text-ink-2' };
  return <span className={cx(pill, t.cls)}>{t.label}</span>;
}

function Dot({ className }: { className: string }) {
  return <span className={cx('size-1.5 rounded-full', className)} aria-hidden />;
}

/** Where the conversation stands, in plain words. */
export function ReplyCell({ state, waitingOn, dueAt }: { state: string | null; waitingOn?: string | null; dueAt?: string | null }) {
  if (state === 'awaiting') {
    const late = dueAt ? new Date(dueAt).getTime() < Date.now() : false;
    return late ? (
      <span className={cx(pill, 'bg-red-soft text-red')}><Dot className="bg-red" />Reply late</span>
    ) : (
      <span className={cx(pill, 'bg-mustard-soft text-mustard')}><Dot className="bg-mustard" />Reply needed</span>
    );
  }
  if (state === 'possibly_replied') return <span className={cx(pill, 'bg-mustard-soft text-mustard')}>Maybe replied</span>;
  if (state === 'handled_offline') return <span className={cx(pill, 'bg-green-soft text-green')}><Dot className="bg-green" />Done on phone</span>;
  if (waitingOn === 'customer') return <span className={cx(pill, 'bg-slate-soft text-muted')}>Waiting for customer</span>;
  if (state === 'replied') return <span className={cx(pill, 'bg-green-soft text-green')}><Dot className="bg-green" />Replied</span>;
  return null;
}

export function BulkStatusText({ status }: { status: string | null }) {
  const s = BULK_STATUSES.find((x) => x.key === status);
  if (!s) return null;
  const tone = status === 'completed' ? 'bg-green-soft text-green' : status === 'cancelled' || status === 'on_hold' ? 'bg-slate-soft text-muted' : 'bg-indigo-soft text-indigo';
  return <span className={cx(pill, tone)}>{s.label}</span>;
}

const iconBtn = 'inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-slate-soft hover:text-ink';

/** View the emails here, or open them in Gmail to reply. */
export function EmailLinks({ threadId, emailCount, gmailThreadId, mailboxEmail }: { threadId: string | null; emailCount: number; gmailThreadId: string | null; mailboxEmail: string | null }) {
  if (!threadId) return null;
  return (
    <div className="flex items-center gap-0.5">
      <Link href={`/threads/${threadId}`} className={cx(iconBtn, 'w-auto gap-1 px-2 text-[12.5px]')} title={`Read ${emailCount === 1 ? 'the email' : `all ${emailCount} emails`}`}>
        <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="tabular-nums">{emailCount}</span>
      </Link>
      {gmailThreadId && (
        <a href={gmailLink(mailboxEmail, gmailThreadId)} target="_blank" rel="noreferrer" className={iconBtn} title="Open in Gmail to reply" aria-label="Open in Gmail">
          <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
          </svg>
        </a>
      )}
    </div>
  );
}

export function Thumbs({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex justify-center gap-1.5">
      {urls.slice(0, 2).map((src) => (
        <a key={src} href={src} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Photo from the customer's email" />
        </a>
      ))}
    </div>
  );
}

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  href?: string;
  active: boolean;
  onClick?: () => void;
}

/** Tabs across the top of a grid. */
export function SheetTabs({ tabs, right }: { tabs: TabItem[]; right?: ReactNode }) {
  return (
    <div className="sheet-tabs flex items-stretch overflow-x-auto border-b border-line px-5">
      {tabs.map((t) =>
        t.href ? (
          <Link key={t.key} href={t.href} aria-current={t.active ? 'page' : undefined}>
            {t.label}
            {t.count !== undefined && <span className="count tabular-nums">{t.count}</span>}
          </Link>
        ) : (
          <button key={t.key} type="button" onClick={t.onClick} aria-pressed={t.active}>
            {t.label}
            {t.count !== undefined && <span className="count tabular-nums">{t.count}</span>}
          </button>
        ),
      )}
      {right && <div className="ml-auto flex items-center text-[13px] text-muted">{right}</div>}
    </div>
  );
}

/** Page body for grid screens: header, summary cards, then the grid filling the rest of the window. */
export function SheetPage({ children }: { children: ReactNode }) {
  return <div className="flex flex-col lg:h-full">{children}</div>;
}

/** The white rounded card that holds tabs, filters and the grid. */
export function GridCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('grid-card mx-6 mb-6 flex-1', className)}>{children}</section>;
}

/** A search box styled like the rest of the grid toolbar. */
export function SearchBox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="relative block">
      <span className="sr-only">{props.placeholder ?? 'Search'}</span>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        {...props}
        className={cx('h-9 w-72 max-w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[14px] outline-none placeholder:text-slate focus:border-indigo focus:ring-3 focus:ring-indigo/15', props.className)}
      />
    </label>
  );
}

/** A filter that switches on and off, shown as a pill. */
export function ToggleChip({ on, onChange, children, tone = 'indigo' }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; tone?: 'indigo' | 'red' }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[14px] font-medium transition-colors duration-200',
        on ? (tone === 'red' ? 'border-red/30 bg-red-soft text-red' : 'border-indigo/30 bg-indigo-soft text-indigo') : 'border-line bg-surface text-ink-2 hover:bg-slate-soft',
      )}
    >
      {children}
    </button>
  );
}
