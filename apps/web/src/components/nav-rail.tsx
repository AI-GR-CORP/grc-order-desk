'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '@/lib/format';

type CountKey = 'needsReply' | 'approvals' | 'review';

const MAIN: { href: string; label: string; icon: ReactNode; count?: CountKey }[] = [
  { href: '/', label: 'Reply needed', icon: <IconReply />, count: 'needsReply' },
  { href: '/approvals', label: 'New clients', icon: <IconNewClient />, count: 'approvals' },
  { href: '/orders', label: 'Orders', icon: <IconSheet /> },
  { href: '/clients', label: 'All clients', icon: <IconPeople /> },
];
const MORE: { href: string; label: string; icon: ReactNode; count?: CountKey }[] = [
  { href: '/review', label: 'Teach the AI', icon: <IconBulb />, count: 'review' },
  { href: '/settings', label: 'Settings', icon: <IconGear /> },
];

/**
 * Left sidebar: a handful of plain-language places, with counts where something is waiting.
 * 192px wide; "Collapse" turns it into a 68px icon strip so more of the sheet fits (remembered per computer).
 */
export function NavRail({ counts, email, sync, initialCollapsed = false }: { counts: Record<CountKey, number>; email: string; sync: ReactNode; initialCollapsed?: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem('grc.sidebar.collapsed') === '1');
    } catch {
      // storage unavailable
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem('grc.sidebar.collapsed', c ? '0' : '1');
      } catch {
        // ignore
      }
      return !c;
    });
  };

  const item = (l: (typeof MAIN)[number]) => {
    const n = l.count ? counts[l.count] : 0;
    const on = active(l.href);
    const badge = l.count === 'needsReply' ? 'bg-red text-white' : l.count === 'approvals' ? 'bg-mustard-soft text-mustard' : 'bg-slate-soft text-ink-2';
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={on ? 'page' : undefined}
        title={collapsed ? (n > 0 ? `${l.label} (${n})` : l.label) : undefined}
        className={cx(
          'relative mx-2 flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px]',
          collapsed && 'lg:justify-center lg:px-0',
          on ? 'bg-indigo-soft font-semibold text-indigo' : 'font-medium text-ink-2 hover:bg-slate-soft hover:text-ink',
        )}
      >
        <span className={cx('size-5 shrink-0', on ? 'text-indigo' : 'text-faint')} aria-hidden>{l.icon}</span>
        <span className={cx('flex-1 truncate', collapsed && 'lg:sr-only')}>{l.label}</span>
        {n > 0 && (
          <span
            className={cx(
              'min-w-[22px] rounded-full px-1.5 py-[1px] text-center text-[11.5px] font-semibold tabular-nums',
              badge,
              collapsed && 'lg:absolute lg:-top-0.5 lg:right-1.5 lg:min-w-[18px] lg:px-1 lg:text-[10.5px]',
            )}
          >
            {n}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside
      className={cx(
        'sticky top-0 z-30 flex flex-col border-b border-line bg-surface transition-[width] duration-200 lg:h-dvh lg:border-b-0 lg:border-r',
        collapsed ? 'lg:w-[68px]' : 'lg:w-[192px]',
      )}
    >
      <div className={cx('flex items-center justify-between gap-3 px-4 py-3 lg:block lg:pb-3 lg:pt-4', collapsed && 'lg:px-0')}>
        <Link href="/" className={cx('flex items-center gap-2', collapsed && 'lg:justify-center')} title="GRC Order Desk">
          <span className="flex h-7 w-7 shrink-0 flex-col justify-center gap-[3px] rounded-lg bg-ink px-[6px]" aria-hidden>
            <span className="h-[3px] rounded-full bg-[#8fa0ff]" />
            <span className="h-[3px] rounded-full bg-[#5fd0bd]" />
            <span className="h-[3px] rounded-full bg-[#f0b45a]" />
          </span>
          <span className={cx('whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]', collapsed && 'lg:sr-only')}>GRC Order Desk</span>
        </Link>
        <div className={cx('lg:mt-2', collapsed && 'lg:flex lg:justify-center lg:[&_.sync-text]:hidden')}>{sync}</div>
      </div>
      <nav className="flex gap-0.5 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible" aria-label="Main">
        {MAIN.map(item)}
        <div className="mx-4 my-2.5 hidden border-t border-line lg:block" />
        {MORE.map(item)}
      </nav>
      <div className="mt-auto hidden border-t border-line px-2 py-3 lg:block">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-muted hover:bg-slate-soft hover:text-ink', collapsed && 'justify-center px-0')}
        >
          <svg viewBox="0 0 24 24" className={cx('size-5 shrink-0 transition-transform duration-200', collapsed && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16M15.5 10 13.5 12l2 2" />
          </svg>
          {!collapsed && 'Collapse'}
        </button>
        {!collapsed && (
          <div className="px-2.5 pt-2 text-[12.5px] text-muted">
            <div className="truncate" title={email}>{email}</div>
            <form action="/auth/signout" method="post">
              <button className="mt-0.5 font-medium text-indigo hover:underline">Sign out</button>
            </form>
          </div>
        )}
        {collapsed && (
          <form action="/auth/signout" method="post" className="mt-1">
            <button aria-label="Sign out" title={`Sign out (${email})`} className="flex w-full justify-center rounded-lg py-2 text-muted hover:bg-slate-soft hover:text-ink">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
              </svg>
            </button>
          </form>
        )}
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
function IconPeople() {
  return <Svg><circle cx="8" cy="8.5" r="3" /><circle cx="16.5" cy="9.5" r="2.5" /><path d="M2.5 19.5a5.5 5.5 0 0 1 11 0M14 19.5a4.5 4.5 0 0 1 7.5-3.3" /></Svg>;
}
function IconBulb() {
  return <Svg><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" /></Svg>;
}
function IconGear() {
  return <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Svg>;
}
