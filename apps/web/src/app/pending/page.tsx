import { redirect } from 'next/navigation';
import { getAppUser } from '@/lib/auth';
import { createSupabase } from '@/lib/supabase/server';

export const metadata = { title: 'Access needed' };

export default async function PendingPage() {
  if (await getAppUser()) redirect('/');
  const supabase = await createSupabase();
  const { data } = await supabase.auth.getUser();
  return (
    <main className="min-h-dvh grid place-items-center px-6">
      <div className="max-w-md">
        <h1 className="text-[22px] font-semibold">Ask an owner to let you in</h1>
        <p className="mt-3 text-muted">
          You’re signed in as <span className="text-ink">{data.user?.email ?? 'an unknown account'}</span>, which doesn’t have
          access yet. An owner can grant it under Settings → People.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="rounded-md border border-line bg-surface px-3 py-2 hover:bg-line-2">Use a different account</button>
        </form>
      </div>
    </main>
  );
}
