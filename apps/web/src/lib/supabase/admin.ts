import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

/**
 * Service-role client. Bypasses RLS — only use it AFTER checking the user's role,
 * and only for things users can't do directly (mailbox tokens, job queue, signed URLs).
 */
export function createAdmin() {
  return createClient(env.supabaseUrl(), env.serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}
