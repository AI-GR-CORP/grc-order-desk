import 'server-only';
import { parseSettings, type AppSettings, type MailboxStatusRow } from '@grc/core';
import { createAdmin } from './supabase/admin';
import { createSupabase } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createSupabase>>;

/**
 * Reads every row of a table/view in pages (PostgREST caps responses at 1000 rows by default).
 * `build` must return a fresh query each time.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function getSettings(supabase: Supabase): Promise<AppSettings> {
  const { data } = await supabase.from('app_setting').select('key, value');
  return parseSettings(data ?? []);
}

export async function getMailboxes(supabase: Supabase): Promise<MailboxStatusRow[]> {
  const { data } = await supabase
    .from('mailbox')
    .select('id, email, status, backfill_stage, backfill_progress, backfill_target, last_synced_at, last_error')
    .order('created_at');
  return (data ?? []) as MailboxStatusRow[];
}

/** Signed thumbnail URLs per thread id (newest first, max 3 per thread). */
export async function getThumbnails(threadIds: string[]): Promise<Record<string, string[]>> {
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const admin = createAdmin();
  const rows: { thumbnail_path: string; thread_id: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from('attachment')
      .select('thumbnail_path, email_message!inner(thread_id, sent_at)')
      .in('email_message.thread_id', ids.slice(i, i + 200))
      .not('thumbnail_path', 'is', null)
      .neq('thumbnail_path', '');
    for (const r of (data ?? []) as unknown as { thumbnail_path: string; email_message: { thread_id: string } }[]) {
      rows.push({ thumbnail_path: r.thumbnail_path, thread_id: r.email_message.thread_id });
    }
  }
  if (rows.length === 0) return {};
  const { data: signed } = await admin.storage.from('thumbnails').createSignedUrls(rows.map((r) => r.thumbnail_path), 3600);
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const url = byPath.get(r.thumbnail_path);
    if (!url) continue;
    const list = (out[r.thread_id] ??= []);
    if (list.length < 3) list.push(url);
  }
  return out;
}
