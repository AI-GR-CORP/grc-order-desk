'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

const LINKS = [
  { href: '/', label: 'Needs reply', count: 'needsReply' as const },
  { href: '/development', label: 'Development' },
  { href: '/bulk', label: 'Bulk orders' },
  { href: '/clients', label: 'Clients' },
  { href: '/review', label: 'Review', count: 'review' as const },
  { href: '/settings', label: 'Settings' },
];

export function NavRail({
  counts,
  email,
  sync,
}: {
  counts: { needsReply: number; review: number };
  email: string;
  sync: ReactNode;
}) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <aside className="sticky top-0 z-30 flex flex-col bg-ink text-white lg:h-dvh">
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block lg:px-5 lg:pb-6 lg:pt-6">
        <Link href="/" className="block">
          <div className="selvedge mb-2 hidden w-16 lg:flex" aria-hidden>
            <span className="bg-indigo" />
            <span className="bg-teal" />
            <span className="bg-mustard" />
            <span className="bg-red" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">GRC Order Desk</span>
        </Link>
        <div className="lg:mt-3">{sync}</div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:px-3" aria-label="Main">
        {LINKS.map((l) => {
          const n = l.count ? counts[l.count] : 0;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active(l.href) ? 'page' : undefined}
              className={cx(
                'flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-[13.5px]',
                active(l.href) ? 'bg-white/12 font-medium text-white' : 'text-white/70 hover:bg-white/8 hover:text-white',
              )}
            >
              {l.label}
              {n > 0 && (
                <span
                  className={cx(
                    'min-w-5 rounded px-1.5 text-center text-[11.5px] font-semibold',
                    l.count === 'needsReply' ? 'bg-red text-white' : 'bg-white/15 text-white',
                  )}
                >
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden border-t border-white/10 px-5 py-4 text-[12px] text-white/60 lg:block">
        <div className="truncate" title={email}>{email}</div>
        <form action="/auth/signout" method="post">
          <button className="mt-1 text-white/80 underline-offset-2 hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
