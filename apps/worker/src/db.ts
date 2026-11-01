import postgres from 'postgres';
import { parseSettings, type AppSettings } from '@grc/core';
import { config } from './config';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either the pool or an open transaction. */
export type Db = Sql | Tx;

export function createDb(): Sql {
  const cfg = config();
  return postgres(cfg.DATABASE_URL, {
    max: 10,
    // Required for Supabase's transaction pooler; harmless on session pooler / direct.
    prepare: false,
    ssl: cfg.DATABASE_SSL === 'disable' ? false : cfg.DATABASE_SSL,
    idle_timeout: 30,
    connect_timeout: 20,
    transform: { undefined: null },
    onnotice: () => {},
  });
}

let settingsCache: { at: number; value: AppSettings } | null = null;

/** App settings with a 60 s cache so dashboard edits apply quickly without hammering the DB. */
export async function getSettings(sql: Db, fresh = false): Promise<AppSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.value;
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from app_setting`;
  const value = parseSettings(rows);
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function getKnowledgeProfile(sql: Db): Promise<string> {
  const [row] = await sql<{ content: string }[]>`select content from knowledge_profile where active limit 1`;
  return row?.content ?? '';
}

/**
 * Re-runs a unit of work when Postgres aborts it for a deadlock (40P01) or serialization
 * conflict (40001). Parallel imports can briefly lock the same contact row; the work is
 * idempotent, so a quick retry is safe and avoids failing the whole job.
 */
export async function retryOnConflict<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (attempt >= tries || (code !== '40P01' && code !== '40001')) throw e;
      await new Promise((r) => setTimeout(r, 150 * attempt + Math.random() * 350));
    }
  }
}
