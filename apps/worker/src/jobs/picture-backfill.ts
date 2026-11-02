import type { Ctx } from '../context';
import { gmailFor, loadMailbox } from '../gmail-session';
import { ensureThumbnails } from '../pipeline/thumbnails';
import { mapLimit } from '../util';

/** Email pictures for every existing order conversation (downloads only, no AI cost). */
export async function runPictureBackfill(ctx: Ctx, mailboxId: string): Promise<void> {
  const { sql } = ctx;
  if (!ctx.storage) {
    ctx.log.warn('pictures: storage not configured; skipping');
    return;
  }
  const mb = await loadMailbox(sql, mailboxId);
  const api = gmailFor(sql, mb);
  const threads = await sql<{ id: string }[]>`
    select distinct t.id
    from email_thread t
    join email_message m on m.thread_id = t.id
    join attachment a on a.message_id = m.id
    where t.mailbox_id = ${mailboxId} and t.category in ('development','bulk','mixed')
      and a.kind = 'image' and a.thumbnail_path is null`;
  let done = 0;
  const save = (finished = false) =>
    sql`update mailbox set backfill_progress = backfill_progress || ${sql.json({ pictures: { total: threads.length, done, ...(finished ? { finishedAt: new Date().toISOString() } : {}) } } as never)} where id = ${mailboxId}`;
  await save();
  ctx.log.info({ conversations: threads.length }, 'pictures: starting');
  await mapLimit(threads, 3, async (t) => {
    await ensureThumbnails(ctx, api, t.id);
    if (++done % 10 === 0) await save();
  });
  await save(true);
  ctx.log.info({ conversations: threads.length }, 'pictures: done');
}
