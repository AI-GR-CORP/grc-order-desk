import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { buildGoogleAuthUrl } from '@grc/core/gmail';
import { getAppUser } from '@/lib/auth';
import { env } from '@/lib/env';

/** Starts Google's consent screen for read-only Gmail access. Owners only. */
export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user?.isAdmin) return NextResponse.redirect(new URL('/settings?gmail=forbidden', request.nextUrl.origin));

  const state = randomBytes(24).toString('base64url');
  const url = buildGoogleAuthUrl({
    clientId: env.googleClientId(),
    redirectUri: `${env.appUrl()}/api/gmail/callback`,
    state,
    loginHint: request.nextUrl.searchParams.get('hint') ?? undefined,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/gmail',
  });
  return res;
}
