import 'server-only';
import { parseSettings, type AppSettings, type MailboxStatusRow } from '@grc/core';
import { createAdmin } from './supabase/admin';
import { createSupabase } from './supabase/server';
import { rowTarget, type RowPic } from './pictures';
import type { SheetRow } from './sheet';

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

/**
 * Pictures per sheet row: GRC's sheet pictures, email pictures linked to that product, and pictures
 * people added. A row with none of its own shows its conversation's email pictures only when that
 * conversation has just this one row, so a picture is never shown on the wrong product.
 */
export async function getRowPictures(rows: SheetRow[]): Promise<Record<string, RowPic[]>> {
  const admin = createAdmin();
  const out: Record<string, RowPic[]> = {};
  const byKey = new Map<string, string>(); // "dev:<id>" → row_id
  for (const r of rows) {
    const t = rowTarget(r);
    if (t) byKey.set(`${t.kind}:${t.id}`, r.row_id);
  }
  type Rec = { id: string; dev_item_id: string | null; bulk_order_id: string | null; thread_id: string | null; source: RowPic['source']; thumb_path: string | null; full_path: string | null; sheet_cell: string | null; attachment: { thumbnail_path: string | null; is_signature: boolean } | null };
  const recs: Rec[] = [];
  const groups: [string, 'dev_item_id' | 'bulk_order_id' | 'thread_id'][] = [['dev', 'dev_item_id'], ['bulk', 'bulk_order_id'], ['thread', 'thread_id']];
  for (const [kind, col] of groups) {
    const ids = [...byKey.keys()].filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await admin
        .from('row_picture')
        .select('id, dev_item_id, bulk_order_id, thread_id, source, thumb_path, full_path, sheet_cell, attachment:attachment_id(thumbnail_path, is_signature)')
        .in(col, ids.slice(i, i + 150))
        .eq('hidden', false)
        .order('position')
        .order('created_at');
      recs.push(...((data ?? []) as unknown as Rec[]));
    }
  }
  const paths = new Set<string>();
  const usable = recs
    .map((p) => {
      if (p.attachment?.is_signature) return null; // signature logos are not pictures
      const thumb = p.thumb_path || p.attachment?.thumbnail_path || '';
      const full = p.full_path || thumb;
      return thumb ? { p, thumb, full } : null;
    })
    .filter(Boolean) as { p: Rec; thumb: string; full: string }[];
  for (const u of usable) {
    paths.add(u.thumb);
    paths.add(u.full);
  }
  const signed = new Map<string, string>();
  const list = [...paths];
  for (let i = 0; i < list.length; i += 500) {
    const { data } = await admin.storage.from('thumbnails').createSignedUrls(list.slice(i, i + 500), 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  for (const { p, thumb, full } of usable) {
    const key = p.dev_item_id ? `dev:${p.dev_item_id}` : p.bulk_order_id ? `bulk:${p.bulk_order_id}` : `thread:${p.thread_id}`;
    const rowId = byKey.get(key);
    const t = signed.get(thumb);
    if (!rowId || !t) continue;
    (out[rowId] ??= []).push({ id: p.id, thumb: t, full: signed.get(full) ?? t, source: p.source, cell: p.sheet_cell });
  }

  // Fallback: the conversation's email pictures, only where they can't belong to another row.
  const rowsPerThread = new Map<string, number>();
  for (const r of rows) if (r.thread_id) rowsPerThread.set(r.thread_id, (rowsPerThread.get(r.thread_id) ?? 0) + 1);
  const need = rows.filter((r) => !out[r.row_id]?.length && r.thread_id && rowsPerThread.get(r.thread_id) === 1);
  const threadPics = await getThreadPictures(need.map((r) => r.thread_id!));
  for (const r of need) {
    const pics = threadPics[r.thread_id!];
    if (pics?.length) out[r.row_id] = pics.map((p) => ({ id: `att:${p.id}`, thumb: p.url, full: p.url, source: 'thread', cell: null }));
  }
  return out;
}

/** Email pictures per thread id (newest first, max 3 per thread), with their attachment ids. */
export async function getThreadPictures(threadIds: string[]): Promise<Record<string, { url: string; id: string }[]>> {
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const admin = createAdmin();
  const rows: { id: string; thumbnail_path: string; thread_id: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from('attachment')
      .select('id, thumbnail_path, email_message!inner(thread_id, sent_at)')
      .in('email_message.thread_id', ids.slice(i, i + 200))
      .not('thumbnail_path', 'is', null)
      .eq('is_signature', false)
      .neq('thumbnail_path', '');
    for (const r of (data ?? []) as unknown as { id: string; thumbnail_path: string; email_message: { thread_id: string } }[]) {
      rows.push({ id: r.id, thumbnail_path: r.thumbnail_path, thread_id: r.email_message.thread_id });
    }
  }
  if (rows.length === 0) return {};
  const { data: signed } = await admin.storage.from('thumbnails').createSignedUrls(rows.map((r) => r.thumbnail_path), 3600);
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const out: Record<string, { url: string; id: string }[]> = {};
  for (const r of rows) {
    const url = byPath.get(r.thumbnail_path);
    if (!url) continue;
    const list = (out[r.thread_id] ??= []);
    if (list.length < 3) list.push({ url, id: r.id });
  }
  return out;
}

/** Signed thumbnail URLs per thread id (newest first, max 3 per thread). */
export async function getThumbnails(threadIds: string[]): Promise<Record<string, string[]>> {
  const pics = await getThreadPictures(threadIds);
  return Object.fromEntries(Object.entries(pics).map(([k, v]) => [k, v.map((p) => p.url)]));
}
