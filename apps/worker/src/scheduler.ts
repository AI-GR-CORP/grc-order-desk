import { config } from './config';
import type { Ctx } from './context';
import { errorMessage } from './errors';
import { enqueue, pruneJobs } from './queue';

/** Enqueues the periodic work. Dedupe keys make overlapping ticks harmless. */
export function startScheduler(ctx: Ctx): () => void {
  let lastPrune = 0;
  const tick = async () => {
    try {
      const mailboxes = await ctx.sql<{ id: string; status: string; connected: boolean }[]>`
        select id, status, refresh_token_enc is not null as connected from mailbox`;
      for (const mb of mailboxes) {
        if (mb.status === 'active') {
          await enqueue(ctx.sql, { kind: 'sync', mailboxId: mb.id, dedupeKey: `sync:${mb.id}`, priority: 10 });
        } else if (mb.status === 'pending' && mb.connected) {
          await enqueue(ctx.sql, { kind: 'backfill', mailboxId: mb.id, dedupeKey: `backfill:${mb.id}`, priority: 5 });
        }
      }
      if (Date.now() - lastPrune > 3_600_000) {
        lastPrune = Date.now();
        await pruneJobs(ctx.sql);
      }
    } catch (e) {
      ctx.log.error({ err: errorMessage(e) }, 'scheduler tick failed');
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), config().SYNC_INTERVAL_MINUTES * 60_000);
  return () => clearInterval(handle);
}
