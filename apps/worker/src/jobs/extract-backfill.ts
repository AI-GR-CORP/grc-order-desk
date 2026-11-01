import { config } from '../config';
import type { Ctx } from '../context';
import { getKnowledgeProfile, getSettings } from '../db';
import { NonRetryableError } from '../errors';
import { gmailFor, loadMailbox } from '../gmail-session';
import { extractThread } from '../pipeline/extract';
import { recomputeReply } from '../pipeline/reply';
import { ensureThumbnails } from '../pipeline/thumbnails';
import { mapLimit } from '../util';

/**
 * Re-reads every tracked thread of APPROVED clients. Threads of the SAME company run one
 * after another (so the model sees items created by earlier threads and doesn't duplicate them);
 * different companies run in parallel.
 */
export async function runExtractBackfill(ctx: Ctx, mailboxId: string): Promise<void> {
  const { sql } = ctx;
  const mb = await loadMailbox(sql, mailboxId);
  if (mb.status === 'needs_reconnect') throw new NonRetryableError('Gmail needs to be reconnected');
  const settings = await getSettings(sql, true);
  const profile = await getKnowledgeProfile(sql);
  const api = gmailFor(sql, mb);

  await sql`update mailbox set backfill_stage = 'extracting' where id = ${mb.id}`;

  const rows = await sql<{ id: string; company_id: string }[]>`
    select id, company_id from email_thread
    where mailbox_id = ${mb.id} and category in ('development','bulk','mixed')
      and company_id in (select id from company where approval = 'approved')
      and (extracted_through is null or extracted_through < last_message_at)
    order by first_message_at`;

  const groups = new Map<string, string[]>();
  for (const r of rows) groups.set(r.company_id, [...(groups.get(r.company_id) ?? []), r.id]);

  const total = rows.length;
  let done = 0;
  const one = async (threadId: string) => {
    await extractThread(ctx, settings, profile, threadId, api);
    await ensureThumbnails(ctx, api, threadId);
    await recomputeReply(sql, settings, threadId);
    done++;
    if (done % 5 === 0 || done === total) {
      await sql`
        update mailbox set backfill_progress = backfill_progress || ${sql.json({ extracted: done, toExtract: total } as never)}
        where id = ${mb.id}`;
    }
  };

  await mapLimit([...groups.values()], config().AI_CONCURRENCY, async (ids) => {
    for (const id of ids) await one(id);
  });

  await sql`
    update mailbox set backfill_stage = 'done',
           backfill_progress = backfill_progress || ${sql.json({ extracted: done, toExtract: total, finishedAt: new Date().toISOString() } as never)}
    where id = ${mb.id}`;
  ctx.log.info({ mailbox: mb.email, threads: done }, 'extraction backfill finished');
}
