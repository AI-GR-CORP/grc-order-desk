import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-go text-white hover:bg-go-dark border-transparent',
  secondary: 'bg-surface text-ink border-line hover:bg-slate-soft',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-slate-soft',
  danger: 'bg-surface text-red border-red/40 hover:bg-red-soft',
};

export function buttonClass(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-1.5 rounded border font-bold transition-colors disabled:opacity-50 disabled:pointer-events-none',
    size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-4 text-[14px]',
    variants[variant],
  );
}

export function Button({ variant, size, className, ...rest }: ComponentProps<'button'> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return <button className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function LinkButton({ variant, size, className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

export function PageHeader({ title, detail, actions }: { title: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface px-5 py-3">
      <div className="min-w-0">
        <h1 className="text-[21px] font-bold leading-tight">{title}</h1>
        {detail && <div className="mt-0.5 max-w-3xl text-[13.5px] text-muted">{detail}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded border border-line bg-surface', className)}>
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
  'w-full rounded border border-line bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-indigo focus:ring-1 focus:ring-indigo';
