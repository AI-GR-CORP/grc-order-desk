import { ThreadTypeSchema } from '@grc/core/ai';
import { getProvider, parseStructured } from '../ai/provider';
import { recordAiRun } from '../ai/record';
import { config } from '../config';
import type { Ctx } from '../context';
import { getKnowledgeProfile, getSettings } from '../db';
import { errorMessage, NonRetryableError } from '../errors';
import { applyClassification, buildClassifyCall, classificationCandidates, classifyThread, resetLessonCache, secondOpinion, threadClues, type ClassifyOutcome } from '../pipeline/classify';
import type { Job } from '../queue';
import { mapLimit, sleep } from '../util';

/**
 * Sorts every order-like conversation of a mailbox into development / bulk + topics, with the
 * current rules and the team's corrections. Payload: { all?: boolean } (false = only never-sorted).
 * Uses the half-price batch API when there are many; anything that fails is retried one by one.
 * Afterwards, approved clients' conversations whose type changed are re-read by the extraction model.
 */
export async function runClassifyBackfill(ctx: Ctx, job: Job): Promise<void> {
  const { sql } = ctx;
  const mailboxId = job.mailbox_id;
  if (!mailboxId) throw new NonRetryableError('classify_backfill without mailbox');
  const settings = await getSettings(sql, true);
  const profile = await getKnowledgeProfile(sql);
  const ai = getProvider();
  const cfg = config();
  resetLessonCache();

  const save = async () => {
    await sql`update job set payload = ${sql.json(job.payload as never)}, updated_at = now() where id = ${job.id}`;
    await sql`update mailbox set backfill_progress = backfill_progress || ${sql.json({ classify: job.payload.progress ?? {} } as never)} where id = ${mailboxId}`;
  };

  let ids = (job.payload.threadIds as string[] | undefined) ?? (await classificationCandidates(sql, mailboxId, job.payload.all === false));
  job.payload.threadIds = ids;
  const done = new Set<string>((job.payload.doneIds as string[] | undefined) ?? []);
  const outcomes: { id: string; o: ClassifyOutcome }[] = [];
  const progress = () => ({ total: ids.length, done: done.size, changed: outcomes.filter((x) => x.o.changedType).length, toCheck: outcomes.filter((x) => x.o.needsCheck).length });
  job.payload.progress = progress();
  await save();
  ctx.log.info({ mailboxId, conversations: ids.length }, 'classify: starting');

  ids = ids.filter((id) => !done.has(id));
  if (ids.length >= cfg.AI_BATCH_MIN && ai.supportsBatch) {
    let batchId = job.payload.classifyBatchId as string | undefined;
    if (!batchId) {
      const requests = [];
      for (const id of ids) {
        const req = await buildClassifyCall(sql, settings, profile, id);
        if (req) requests.push({ customId: id, opts: req.call });
        else done.add(id);
      }
      batchId = await ai.batchCreate(requests);
      job.payload.classifyBatchId = batchId;
      await save();
      ctx.log.info({ batchId, requests: requests.length }, 'classify: batch submitted');
    }
    for (;;) {
      const st = await ai.batchStatus(batchId);
      job.payload.progress = { ...progress(), batch: st };
      await save();
      if (st.ended) break;
      await sleep(30_000);
    }
    for await (const item of ai.batchResults(batchId)) {
      const model = item.usage?.model ?? settings.ai_models.classify;
      if (!item.ok || !item.text) continue;
      try {
        const data = parseStructured(item.text, ThreadTypeSchema, item.usage);
        await recordAiRun(sql, { purpose: 'classify', model, threadId: item.customId, batchId, usage: item.usage, ok: true });
        const clues = await threadClues(sql, item.customId);
        const final = await secondOpinion(ctx, settings, profile, item.customId, data, clues);
        const o = await applyClassification(sql, item.customId, final.result, clues, undefined, { forceCheck: final.forceCheck });
        if (o) outcomes.push({ id: item.customId, o });
        done.add(item.customId);
      } catch (e) {
        await recordAiRun(sql, { purpose: 'classify', model, threadId: item.customId, batchId, usage: item.usage, ok: false, error: errorMessage(e) });
      }
    }
    job.payload.doneIds = [...done];
    job.payload.progress = progress();
    await save();
    ids = ids.filter((id) => !done.has(id));
  }

  // Small runs, and anything the batch didn't finish, one by one.
  await mapLimit(ids, cfg.AI_CONCURRENCY, async (id) => {
    const o = await classifyThread(ctx, settings, profile, id);
    if (o) outcomes.push({ id, o });
    done.add(id);
    if (done.size % 10 === 0) {
      job.payload.doneIds = [...done];
      job.payload.progress = progress();
      await save();
    }
  });

  // Approved clients: re-read conversations whose type changed, so their rows match the new type.
  for (const { id, o } of outcomes) {
    if (!o.changedType || !o.approved) continue;
    await sql`
      insert into job (kind, mailbox_id, payload, dedupe_key, priority)
      values ('reprocess_thread', ${mailboxId}, ${sql.json({ threadId: id, force: true } as never)}, ${'reprocess:' + id}, 6)
      on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing`;
  }

  job.payload.doneIds = [...done];
  job.payload.progress = { ...progress(), finishedAt: new Date().toISOString() };
  await save();
  ctx.log.info(job.payload.progress as object, 'classify: done');
}
