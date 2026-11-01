import type { Db } from './db';

export type JobKind = 'backfill' | 'extract_backfill' | 'extract_company' | 'classify_backfill' | 'sync' | 'reprocess_thread';

export interface Job {
  id: string;
  kind: JobKind;
  mailbox_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  attempts: number;
  max_attempts: number;
}

/** Inserts a job unless an identical one (same dedupe key) is already queued or running. */
export async function enqueue(
  sql: Db,
  j: { kind: JobKind; mailboxId?: string | null; payload?: Record<string, unknown>; dedupeKey?: string; priority?: number; runAfter?: Date },
): Promise<boolean> {
  const rows = await sql`
    insert into job (kind, mailbox_id, payload, dedupe_key, priority, run_after)
    values (${j.kind}, ${j.mailboxId ?? null}, ${sql.json((j.payload ?? {}) as never)}, ${j.dedupeKey ?? null},
            ${j.priority ?? 0}, ${j.runAfter ?? new Date()})
    on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
    returning id`;
  return rows.length > 0;
}

/**
 * Claims the next runnable job. Also reclaims jobs whose worker died (lock expired).
 * FOR UPDATE SKIP LOCKED lets several worker processes share the queue safely.
 */
export async function claimJob(sql: Db, lockSeconds: number): Promise<Job | null> {
  const [job] = await sql<Job[]>`
    with next as (
      select id from job
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_until < now())
      order by priority desc, run_after
      limit 1
      for update skip locked
    )
    update job j
       set status = 'running',
           attempts = j.attempts + 1,
           locked_until = now() + make_interval(secs => ${lockSeconds})
      from next
     where j.id = next.id
    returning j.id::text, j.kind, j.mailbox_id, j.payload, j.dedupe_key, j.attempts, j.max_attempts`;
  return job ?? null;
}

export async function heartbeat(sql: Db, id: string, lockSeconds: number): Promise<void> {
  await sql`update job set locked_until = now() + make_interval(secs => ${lockSeconds}) where id = ${id} and status = 'running'`;
}

export async function savePayload(sql: Db, id: string, payload: Record<string, unknown>): Promise<void> {
  await sql`update job set payload = ${sql.json(payload as never)} where id = ${id}`;
}

export async function completeJob(sql: Db, id: string): Promise<void> {
  await sql`update job set status = 'done', locked_until = null, last_error = null where id = ${id}`;
}

/** Retries with exponential backoff (1, 2, 4, 8… min) until max_attempts, then marks failed. */
export async function failJob(sql: Db, job: Job, error: string, retryable: boolean): Promise<void> {
  const final = !retryable || job.attempts >= job.max_attempts;
  const delayMin = Math.min(60, 2 ** Math.max(0, job.attempts - 1));
  await sql`
    update job
       set status = ${final ? 'failed' : 'queued'},
           locked_until = null,
           last_error = ${error.slice(0, 2000)},
           run_after = now() + make_interval(mins => ${delayMin})
     where id = ${job.id}`;
}

/** Housekeeping: keep the job table small. */
export async function pruneJobs(sql: Db): Promise<void> {
  await sql`delete from job where status = 'done' and updated_at < now() - interval '3 days'`;
  await sql`delete from job where status = 'failed' and updated_at < now() - interval '30 days'`;
}
