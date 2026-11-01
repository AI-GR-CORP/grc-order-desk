import { threadCategoryFromTriage, type AppSettings, type ThreadCategory, type TriageCategory } from '@grc/core';
import { TriageSchema, triageSystem, triageUserContent, type Triage } from '@grc/core/ai';
import { getProvider, type CallOptions } from '../ai/provider';
import { recordAiRun } from '../ai/record';
import { config } from '../config';
import type { Ctx } from '../context';
import type { Db } from '../db';
import { errorMessage } from '../errors';
import { mapLimit } from '../util';
import { loadMessages, type StoredMessage } from './messages';

export function triageCall(settings: AppSettings, profile: string, m: StoredMessage): CallOptions<Triage> {
  return {
    purpose: 'triage',
    model: settings.ai_models.triage,
    system: triageSystem({ internalDomains: settings.internal_domains, knowledgeProfile: profile }),
    user: triageUserContent(m),
    schema: TriageSchema,
    maxTokens: 2000,
    effort: config().AI_EFFORT_TRIAGE || undefined,
  };
}

export async function applyTriage(
  sql: Db,
  m: Pick<StoredMessage, 'id' | 'direction'>,
  result: Triage | null,
  error?: string,
): Promise<void> {
  if (result) {
    const needsReply = m.direction === 'inbound' ? result.needs_reply : false;
    await sql`
      update email_message
         set triage = ${sql.json(result as never)}, needs_reply = ${needsReply}, triaged_at = now()
       where id = ${m.id}`;
  } else {
    // Keep needs_reply null for customer mail: unknown is treated as "needs a reply" so nothing is missed.
    await sql`
      update email_message
         set triage = ${sql.json({ category: 'other', failed: true, error: (error ?? '').slice(0, 300) } as never)},
             needs_reply = ${m.direction === 'inbound' ? null : false},
             triaged_at = now()
       where id = ${m.id}`;
  }
}

/** Direct (non-batch) triage, used for live sync and small backfills. */
export async function triageMessages(ctx: Ctx, settings: AppSettings, profile: string, ids: readonly string[]): Promise<void> {
  const msgs = await loadMessages(ctx.sql, ids);
  const ai = getProvider();
  await mapLimit(msgs, config().AI_CONCURRENCY, async (m) => {
    const call = triageCall(settings, profile, m);
    try {
      const r = await ai.call(call);
      await applyTriage(ctx.sql, m, r.data);
      await recordAiRun(ctx.sql, { purpose: 'triage', model: call.model, threadId: m.threadId, usage: r.usage, ok: true });
    } catch (e) {
      ctx.log.warn({ err: errorMessage(e), messageId: m.id }, 'triage failed');
      await applyTriage(ctx.sql, m, null, errorMessage(e));
      await recordAiRun(ctx.sql, { purpose: 'triage', model: call.model, threadId: m.threadId, ok: false, error: errorMessage(e) });
    }
  });
}

/** Recomputes the thread category from its messages unless a person fixed it. */
export async function updateThreadCategory(sql: Db, threadId: string): Promise<ThreadCategory> {
  const rows = await sql<{ category: string | null; locked: boolean; current: ThreadCategory; sorted: boolean }[]>`
    select m.triage->>'category' as category, t.category_locked as locked, t.category as current, t.classified_at is not null as sorted
    from email_thread t
    left join email_message m on m.thread_id = t.id and m.direction in ('inbound','outbound')
    where t.id = ${threadId}`;
  if (rows.length === 0) return 'unclassified';
  // A person's choice, or the conversation-level sort, decides once it exists.
  if (rows[0]!.locked || rows[0]!.sorted) return rows[0]!.current;
  const cat = threadCategoryFromTriage(rows.map((r) => r.category as TriageCategory | null));
  // Extraction can refine development/bulk into mixed/other; don't let triage undo that once set.
  const current = rows[0]!.current;
  const next = cat === 'unclassified' && current !== 'unclassified' ? current : cat;
  if (next !== current) await sql`update email_thread set category = ${next} where id = ${threadId}`;
  return next;
}
