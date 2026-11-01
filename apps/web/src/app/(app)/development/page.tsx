import { redirect } from 'next/navigation';

/** Development and bulk orders now live together under Orders. */
export default async function DevelopmentPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const { tab, view } = await searchParams;
  const t = tab ?? (view === 'non-moving' ? 'not-moving' : undefined);
  redirect(t ? `/orders?tab=${encodeURIComponent(t)}` : '/orders');
}
