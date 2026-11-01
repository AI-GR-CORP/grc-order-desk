'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

type CountKey = 'needsReply' | 'approvals' | 'review';

const MAIN: { href: string; label: string; icon: ReactNode; count?: CountKey }[] = [
  { href: '/', label: 'Reply needed', icon: <IconReply />, count: 'needsReply' },
  { href: '/approvals', label: 'New clients', icon: <IconNewClient />, count: 'approvals' },
  { href: '/development', label: 'Development', icon: <IconSheet /> },
  { href: '/bulk', label: 'Bulk orders', icon: <IconBox /> },
  { href: '/clients', label: 'All clients', icon: <IconPeople /> },
];
const MORE: { href: string; label: string; icon: ReactNode; count?: CountKey }[] = [
  { href: '/review', label: 'Teach the AI', icon: <IconBulb />, count: 'review' },
  { href: '/settings', label: 'Settings', icon: <IconGear /> },
];

/** Left sidebar: a handful of plain-language places, with counts where something is waiting. */
export function NavRail({ counts, email, sync }: { counts: Record<CountKey, number>; email: string; sync: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  const item = (l: (typeof MAIN)[number]) => {
    const n = l.count ? counts[l.count] : 0;
    const on = active(l.href);
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={on ? 'page' : undefined}
        className={cx(
          'flex shrink-0 items-center gap-3 rounded-r-full py-2.5 pl-5 pr-3 text-[15px]',
          on ? 'bg-go-soft font-bold text-go' : 'text-ink-2 hover:bg-slate-soft',
        )}
      >
        <span className={cx('size-5 shrink-0', on ? 'text-go' : 'text-muted')} aria-hidden>{l.icon}</span>
        <span className="flex-1">{l.label}</span>
        {n > 0 && (
          <span
            className={cx(
              'min-w-6 rounded-full px-2 py-0.5 text-center text-[12px] font-bold',
              l.count === 'needsReply' ? 'bg-red text-white' : l.count === 'approvals' ? 'bg-company text-black ring-1 ring-black/20' : 'bg-slate-soft text-ink-2',
            )}
          >
            {n}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 z-30 flex flex-col border-b border-line bg-surface lg:h-dvh lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3 px-5 py-3 lg:block lg:pb-4 lg:pt-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid grid-cols-2 overflow-hidden rounded-sm border border-black" aria-hidden>
            <span className="h-5 w-3 bg-company" />
            <span className="h-5 w-3 bg-head" />
          </span>
          <span className="text-[17px] font-bold">GRC Order Desk</span>
        </Link>
        <div className="lg:mt-2.5">{sync}</div>
      </div>
      <nav className="flex gap-1 overflow-x-auto pb-2 pr-3 lg:flex-col lg:overflow-visible" aria-label="Main">
        {MAIN.map(item)}
        <div className="mx-5 my-2 hidden border-t border-line lg:block" />
        {MORE.map(item)}
      </nav>
      <div className="mt-auto hidden border-t border-line px-5 py-4 text-[12.5px] text-muted lg:block">
        <div className="truncate" title={email}>{email}</div>
        <form action="/auth/signout" method="post">
          <button className="mt-1 text-indigo hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-5">
      {children}
    </svg>
  );
}
function IconReply() {
  return <Svg><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>;
}
function IconNewClient() {
  return <Svg><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></Svg>;
}
function IconSheet() {
  return <Svg><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14.5h18M9 4v16" /></Svg>;
}
function IconBox() {
  return <Svg><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></Svg>;
}
function IconPeople() {
  return <Svg><circle cx="8" cy="8.5" r="3" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M2.5 19.5a5.5 5.5 0 0 1 11 0M14 19.5a4.5 4.5 0 0 1 7.5-3.3" /></Svg>;
}
function IconBulb() {
  return <Svg><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" /></Svg>;
}
function IconGear() {
  return <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Svg>;
}
