import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { encryptSecret } from '@grc/core/crypto';
import { exchangeCodeForTokens, GMAIL_READONLY_SCOPE, GmailApi } from '@grc/core/gmail';
import { getAppUser } from '@/lib/auth';
import { env } from '@/lib/env';
import { createAdmin } from '@/lib/supabase/admin';
import { createSupabase } from '@/lib/supabase/server';

function back(request: NextRequest, status: string) {
  const res = NextResponse.redirect(new URL(`/settings?gmail=${status}`, request.nextUrl.origin));
  res.cookies.delete({ name: 'gmail_oauth_state', path: '/api/gmail' });
  return res;
}

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Google redirects here after consent. We keep only the refresh token (encrypted),
 * then queue the first import for the worker.
 */
export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user?.isAdmin) return back(request, 'forbidden');

  const params = request.nextUrl.searchParams;
  if (params.get('error')) return back(request, 'cancelled');
  if (!sameState(request.cookies.get('gmail_oauth_state')?.value, params.get('state'))) return back(request, 'state');
  const code = params.get('code');
  if (!code) return back(request, 'cancelled');

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      clientId: env.googleClientId(),
      clientSecret: env.googleClientSecret(),
      redirectUri: `${env.appUrl()}/api/gmail/callback`,
    });
  } catch {
    return back(request, 'exchange');
  }
  if (!tokens.refresh_token) return back(request, 'no_refresh');
  if (!tokens.scope?.split(' ').includes(GMAIL_READONLY_SCOPE)) return back(request, 'scope');

  const profile = await new GmailApi(async () => tokens.access_token).getProfile();
  const email = profile.emailAddress.toLowerCase();

  const admin = createAdmin();
  const { data: existing } = await admin.from('mailbox').select('id, history_id, backfill_stage').eq('email', email).maybeSingle();
  const encrypted = encryptSecret(tokens.refresh_token, env.tokenKey());
  let mailboxId: string;
  if (existing) {
    // Reconnect: keep the history checkpoint so nothing is re-imported.
    const status = existing.backfill_stage === 'pending' || !existing.history_id ? 'pending' : 'active';
    const { error } = await admin
      .from('mailbox')
      .update({ refresh_token_enc: encrypted, status, last_error: null, connected_by: user.id })
      .eq('id', existing.id);
    if (error) return back(request, 'save');
    mailboxId = existing.id as string;
  } else {
    const { data, error } = await admin
      .from('mailbox')
      .insert({ email, refresh_token_enc: encrypted, status: 'pending', connected_by: user.id })
      .select('id')
      .single();
    if (error || !data) return back(request, 'save');
    mailboxId = data.id as string;
  }

  if (!existing || existing.backfill_stage === 'pending') {
    const supabase = await createSupabase();
    await supabase.rpc('enqueue_job', {
      p_kind: 'backfill', p_mailbox: mailboxId, p_payload: {}, p_dedupe: `backfill:${mailboxId}`, p_priority: 5,
    });
  }
  return back(request, 'connected');
}
