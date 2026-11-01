/** Read lazily so `next build` works without secrets; each getter throws a clear error at runtime. */
function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => need('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => need('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  serviceRoleKey: () => need('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  googleClientId: () => need('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID),
  googleClientSecret: () => need('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET),
  tokenKey: () => need('TOKEN_ENCRYPTION_KEY', process.env.TOKEN_ENCRYPTION_KEY),
  appUrl: () => need('APP_URL', process.env.APP_URL).replace(/\/$/, ''),
  /** Google Workspace domain to suggest on the sign-in screen (optional). */
  loginDomain: () => process.env.NEXT_PUBLIC_LOGIN_DOMAIN ?? '',
};
