'use client';
import { useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';

export function LoginButton({ next, domain }: { next?: string; domain: string }) {
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTo = () => `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  async function google() {
    setBusy(true);
    const { error } = await browserSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo(), queryParams: { prompt: 'select_account', ...(domain ? { hd: domain } : {}) } },
    });
    if (error) {
      setBusy(false);
      setError(error.message);
    }
  }

  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await browserSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="space-y-4">
      <button onClick={google} disabled={busy} className="w-full rounded-md bg-ink px-4 py-2.5 font-medium text-white hover:bg-ink-2 disabled:opacity-60">
        {busy && !showEmail ? 'Opening Google…' : 'Sign in with Google'}
      </button>
      {!showEmail ? (
        <button onClick={() => setShowEmail(true)} className="w-full text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
          Not a GRC Google account? Get a sign-in link by email
        </button>
      ) : sent ? (
        <p className="rounded-md border border-teal/30 bg-teal-soft px-3 py-2 text-[13px] text-teal">
          Check {email} for a sign-in link. Open it in this browser.
        </p>
      ) : (
        <form onSubmit={emailLink} className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            aria-label="Email"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-2 text-[13.5px] outline-none focus:border-indigo"
          />
          <button disabled={busy} className="rounded-md border border-line bg-surface px-3 text-[13.5px] font-medium hover:bg-line-2 disabled:opacity-60">
            Email me a link
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-[13px] text-red">{error}</p>}
    </div>
  );
}
