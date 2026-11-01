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

const TYPE: Record<string, { label: string; cls: string }> = {
  development: { label: 'Development', cls: 'bg-indigo-soft text-[#174ea6]' },
  bulk: { label: 'Bulk', cls: 'bg-go-soft text-go' },
  mixed: { label: 'Dev + bulk', cls: 'bg-mustard-soft text-mustard' },
};

export function TypeChip({ kind }: { kind: string }) {
  const t = TYPE[kind] ?? { label: kind, cls: 'bg-slate-soft text-ink-2' };
  return <span className={cx('inline-block whitespace-nowrap rounded px-2 py-0.5 text-[12px] font-bold', t.cls)}>{t.label}</span>;
}

/** Where the conversation stands, in words Yash uses. */
export function ReplyCell({ state, waitingOn, dueAt }: { state: string | null; waitingOn?: string | null; dueAt?: string | null }) {
  if (state === 'awaiting') {
    const overdue = dueAt ? new Date(dueAt).getTime() < Date.now() : false;
    return (
      <span className={cx('inline-block rounded px-2 py-0.5 text-[12px] font-bold', overdue ? 'bg-red text-white' : 'bg-red-soft text-red')}>
        {overdue ? 'Reply late' : 'Reply needed'}
      </span>
    );
  }
  if (state === 'possibly_replied') return <span className="text-[12px] font-bold text-mustard">Maybe replied</span>;
  if (state === 'handled_offline') return <span className="text-[12px] text-go">Done on phone</span>;
  if (waitingOn === 'customer') return <span className="text-[12px] text-muted">Waiting for customer</span>;
  if (state === 'replied') return <span className="text-[12px] text-go">Replied</span>;
  return null;
}

export function BulkStatusText({ status }: { status: string | null }) {
  const s = BULK_STATUSES.find((x) => x.key === status);
  return s ? <span className="font-bold">{s.label}</span> : null;
}

export function EmailLinks({ threadId, emailCount, gmailThreadId, mailboxEmail }: { threadId: string | null; emailCount: number; gmailThreadId: string | null; mailboxEmail: string | null }) {
  if (!threadId) return null;
  return (
    <div className="flex flex-col items-start gap-0.5 text-[12.5px]">
      <Link href={`/threads/${threadId}`} className="text-indigo hover:underline">
        {emailCount === 1 ? '1 email' : `${emailCount} emails`}
      </Link>
      {gmailThreadId && (
        <a href={gmailLink(mailboxEmail, gmailThreadId)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">
          Open in Gmail
        </a>
      )}
    </div>
  );
}

export function Thumbs({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex justify-center gap-1">
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

/** Tabs along the bottom edge, like the sheet tabs in Google Sheets. */
export function SheetTabs({ tabs, right }: { tabs: TabItem[]; right?: ReactNode }) {
  return (
    <div className="sheet-tabs flex items-stretch gap-0.5 overflow-x-auto border-t border-line bg-[#f1f3f4] px-2">
      {tabs.map((t) =>
        t.href ? (
          <Link key={t.key} href={t.href} aria-current={t.active ? 'page' : undefined}>
            {t.label}
            {t.count !== undefined && <span className="tabular-nums text-muted">{t.count}</span>}
          </Link>
        ) : (
          <button key={t.key} type="button" onClick={t.onClick} aria-pressed={t.active}>
            {t.label}
            {t.count !== undefined && <span className="tabular-nums text-muted">{t.count}</span>}
          </button>
        ),
      )}
      {right && <div className="ml-auto flex items-center px-2 text-[12.5px] text-muted">{right}</div>}
    </div>
  );
}

/** Page body for sheet screens: fills the window so the header row and tabs stay in view. */
export function SheetPage({ children }: { children: ReactNode }) {
  return <div className="flex flex-col lg:h-full">{children}</div>;
}
