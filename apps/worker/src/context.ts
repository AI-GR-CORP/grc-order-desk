import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import type { Sql } from './db';
import { log, type Logger } from './log';

export interface Ctx {
  sql: Sql;
  log: Logger;
  /** Service-role Supabase client, used for Storage uploads only. Null if not configured. */
  storage: SupabaseClient | null;
}

export function createCtx(sql: Sql): Ctx {
  const cfg = config();
  const storage =
    cfg.SUPABASE_URL && cfg.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : null;
  return { sql, log, storage };
}
