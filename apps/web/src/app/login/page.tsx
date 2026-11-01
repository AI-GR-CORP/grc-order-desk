import { LoginButton } from './login-button';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="selvedge mb-8 w-24">
          <span className="bg-indigo" />
          <span className="bg-teal" />
          <span className="bg-mustard" />
          <span className="bg-red" />
          <span className="bg-ink" />
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">GRC Order Desk</h1>
        <p className="mt-2 text-muted">Customer threads, development samples and bulk orders, read from the main mailbox.</p>
        {error && (
          <p role="alert" className="mt-6 rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[13px] text-red">
            Sign-in didn’t complete. Try again, and use your GRC Google account.
          </p>
        )}
        <div className="mt-8">
          <LoginButton next={next} domain={process.env.NEXT_PUBLIC_LOGIN_DOMAIN ?? ''} />
        </div>
        <p className="mt-6 text-[12px] text-muted">Access is limited to G.R. Corporation staff.</p>
      </div>
    </main>
  );
}
