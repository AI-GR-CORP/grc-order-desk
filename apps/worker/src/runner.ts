import type { Ctx } from './context';
import { errorMessage, NonRetryableError } from './errors';
import { runBackfill } from './jobs/backfill';
import { runExtractBackfill } from './jobs/extract-backfill';
import { runReprocess } from './jobs/reprocess';
import { runSync } from './jobs/sync';
import { claimJob, completeJob, failJob, heartbeat, type Job } from './queue';
import { sleep } from './util';

const LOCK_SECONDS = 600;

async function dispatch(ctx: Ctx, job: Job): Promise<void> {
  switch (job.kind) {
    case 'backfill':
      return runBackfill(ctx, job);
    case 'extract_backfill':
      if (!job.mailbox_id) throw new NonRetryableError('extract_backfill without mailbox');
      return runExtractBackfill(ctx, job.mailbox_id);
    case 'sync':
      if (!job.mailbox_id) throw new NonRetryableError('sync without mailbox');
      return runSync(ctx, job.mailbox_id);
    case 'reprocess_thread':
      return runReprocess(ctx, { ...job.payload, mailboxId: job.mailbox_id ?? undefined });
    default:
      throw new NonRetryableError(`Unknown job kind ${String(job.kind)}`);
  }
}

/** N independent loops pulling from the shared Postgres queue. */
export function startRunner(ctx: Ctx, concurrency: number): { stop: () => Promise<void> } {
  let stopping = false;
  const loop = async (slot: number) => {
    while (!stopping) {
      let job: Job | null = null;
      try {
        job = await claimJob(ctx.sql, LOCK_SECONDS);
      } catch (e) {
        ctx.log.error({ err: errorMessage(e), slot }, 'could not claim job');
        await sleep(5_000);
        continue;
      }
      if (!job) {
        await sleep(2_000);
        continue;
      }
      const current = job;
      const hb = setInterval(() => void heartbeat(ctx.sql, current.id, LOCK_SECONDS).catch(() => {}), 60_000);
      const started = Date.now();
      try {
        await dispatch(ctx, current);
        await completeJob(ctx.sql, current.id);
        ctx.log.debug({ job: current.id, kind: current.kind, ms: Date.now() - started }, 'job done');
      } catch (e) {
        const msg = errorMessage(e);
        const retryable = !(e instanceof NonRetryableError);
        await failJob(ctx.sql, current, msg, retryable).catch(() => {});
        if (current.mailbox_id && (current.kind === 'backfill' || current.kind === 'extract_backfill' || current.kind === 'sync')) {
          await ctx.sql`update mailbox set last_error = ${msg.slice(0, 500)} where id = ${current.mailbox_id}`.catch(() => {});
        }
        ctx.log.error({ job: current.id, kind: current.kind, attempt: current.attempts, retryable, err: msg }, 'job failed');
      } finally {
        clearInterval(hb);
      }
    }
  };
  const loops = Array.from({ length: concurrency }, (_, i) => loop(i));
  return {
    stop: async () => {
      stopping = true;
      await Promise.race([Promise.all(loops), sleep(30_000)]);
    },
  };
}
