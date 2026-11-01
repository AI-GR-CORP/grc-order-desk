import type { Db } from '../db';
import { estimateCostUsd, type UsageInfo } from './pricing';

export async function recordAiRun(
  sql: Db,
  r: {
    purpose: 'triage' | 'extract' | 'discovery' | 'eval';
    model: string;
    threadId?: string | null;
    batchId?: string | null;
    usage?: UsageInfo;
    ok: boolean;
    error?: string | null;
  },
): Promise<void> {
  const u = r.usage;
  await sql`
    insert into ai_run (purpose, model, thread_id, batch_id, input_tokens, output_tokens,
                        cache_read_tokens, cache_write_tokens, cost_usd, ok, error)
    values (${r.purpose}, ${r.model}, ${r.threadId ?? null}, ${r.batchId ?? null},
            ${u?.input_tokens ?? null}, ${u?.output_tokens ?? null}, ${u?.cache_read_tokens ?? null},
            ${u?.cache_write_tokens ?? null}, ${u ? estimateCostUsd(u, Boolean(r.batchId)) : null},
            ${r.ok}, ${r.error ? r.error.slice(0, 1000) : null})`;
}
