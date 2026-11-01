import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-indigo text-white hover:bg-go-dark border-transparent shadow-[0_1px_2px_rgba(27,34,54,0.12)]',
  secondary: 'bg-surface text-ink border-line hover:bg-slate-soft',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-slate-soft',
  danger: 'bg-surface text-red border-red/30 hover:bg-red-soft',
};

export function buttonClass(variant: Variant = 'secondary', size: 'xs' | 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
    size === 'xs' ? 'h-7 px-2.5 text-[12.5px]' : size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-[14px]',
    variants[variant],
  );
}

export function Button({ variant, size, className, ...rest }: ComponentProps<'button'> & { variant?: Variant; size?: 'xs' | 'sm' | 'md' }) {
  return <button className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function LinkButton({ variant, size, className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: 'xs' | 'sm' | 'md' }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function PageHeader({ title, detail, actions }: { title: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-6 pb-5 pt-7">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {detail && <div className="mt-1.5 max-w-2xl text-[14.5px] leading-relaxed text-muted">{detail}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium">{label}</span>
      {hint && <span className="block text-[12px] text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-indigo focus:ring-3 focus:ring-indigo/15';

export interface Stat {
  label: string;
  value: ReactNode;
  tone?: 'indigo' | 'teal' | 'red' | 'mustard' | 'slate';
  href?: string;
}
const statTone: Record<NonNullable<Stat['tone']>, string> = {
  indigo: 'border-l-indigo',
  teal: 'border-l-teal',
  red: 'border-l-red',
  mustard: 'border-l-mustard',
  slate: 'border-l-line',
};

/** A row of summary cards above a grid. */
export function Stats({ items }: { items: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-6 pb-5 lg:grid-cols-4">
      {items.map((s) => {
        const body = (
          <>
            <div className="text-[26px] font-semibold leading-none tabular-nums">{s.value}</div>
            <div className="mt-2 text-[13px] text-muted">{s.label}</div>
          </>
        );
        const cls = cx('block rounded-xl border border-l-[3px] border-line bg-surface px-5 py-4', statTone[s.tone ?? 'slate'], s.href && 'hover:border-indigo/40');
        return s.href ? (
          <Link key={s.label} href={s.href} className={cls}>{body}</Link>
        ) : (
          <div key={s.label} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}
