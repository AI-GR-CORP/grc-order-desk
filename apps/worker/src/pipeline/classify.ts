import type { AppSettings } from '@grc/core';
import {
  buildTypeLessons,
  classifySystem,
  classifyUserContent,
  clueConflicts,
  cluesForPrompt,
  findClues,
  fitThreadToBudget,
  ThreadTypeSchema,
  type Clue,
  type ThreadType,
  type TypeLesson,
} from '@grc/core/ai';
import { getProvider, type CallOptions } from '../ai/provider';
import { recordAiRun } from '../ai/record';
import { config } from '../config';
import type { Ctx } from '../context';
import type { Db, Sql } from '../db';
import { errorMessage } from '../errors';
import { loadThreadMessages } from './messages';

/** Trims an AI text field; empty becomes null. */
const clean = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').replace(/^[•\-*\s]+/, '').trim();
  return t ? t.slice(0, max) : null;
};

/** A YYYY-MM-DD date the model copied from the emails; anything else (or a future date) becomes null. */
export const isoDay = (v: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  if (d.getUTCMonth() !== +m[2]! - 1 || d.getTime() > Date.now() + 86_400_000) return null;
  return m[0];
};

/** Below this confidence a person is asked to check the type and topics. */
export const CHECK_BELOW = 0.8;
const PER_EMAIL_CHARS = 1800;
const THREAD_CHARS = 16_000;

/** Conversations that look like order work, from triage or an earlier sort. */
const CANDIDATE = (sql: Db) => sql`(
  t.category in ('development','bulk','mixed','payment')
  or exists (select 1 from email_message m
             where m.thread_id = t.id and m.direction <> 'internal'
               and m.triage->>'category' in ('development','bulk','payment','lab_report'))
)`;

/** Order-like conversations. Ones a person checked keep their type and topics; only their summary is refreshed. */
export async function classificationCandidates(sql: Db, mailboxId: string, onlyUnsorted: boolean): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select t.id from email_thread t
    where t.mailbox_id = ${mailboxId}
      and ${CANDIDATE(sql)}
      ${onlyUnsorted ? sql`and (t.classified_at is null or cardinality(t.points) = 0)` : sql``}
    order by t.last_message_at desc nulls last`;
  return rows.map((r) => r.id);
}

/** True when a conversation is order-like and has news since it was last read (checked ones too: their summary stays current). */
export async function needsClassification(sql: Db, threadId: string): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`
    select (${CANDIDATE(sql)}
            and (t.classified_at is null or t.last_message_at > t.classified_at)) as ok
    from email_thread t where t.id = ${threadId}`;
  return Boolean(r?.ok);
}

let globalCache: { at: number; value: string } | null = null;

/** The team's most recent corrections and confirmations across all clients (system prompt; cached 5 min). */
export async function getGlobalTypeLessons(sql: Db): Promise<string> {
  if (globalCache && Date.now() - globalCache.at < 5 * 60_000) return globalCache.value;
  const fixes = await sql<TypeLesson[]>`
    select c.field, c.context, c.ai_value, c.human_value
    from correction c
    where c.entity = 'email_thread' and c.field in ('order_type','topics')
    order by c.created_at desc limit 40`;
  const confirmed = await sql<TypeLesson[]>`
    select 'confirmed' as field, left(concat_ws(' | ', co.name, t.subject), 200) as context, null as ai_value,
           t.category::text || case when cardinality(t.topics) > 0 then '; topics: ' || array_to_string(t.topics, ', ') else '' end as human_value
    from email_thread t left join company co on co.id = t.company_id
    where t.type_checked_at is not null and t.category in ('development','bulk')
      and not exists (select 1 from correction c where c.entity = 'email_thread' and c.entity_id = t.id)
    order by t.type_checked_at desc limit 15`;
  const value = buildTypeLessons([...fixes, ...confirmed]);
  globalCache = { at: Date.now(), value };
  return value;
}

export function resetLessonCache(): void {
  globalCache = null;
}

/** This client's own history and corrections (they matter most, so they go next to the emails). */
async function getClientContext(sql: Db, companyId: string | null, threadId: string): Promise<{ history: string | null; lessons: string }> {
  if (!companyId) return { history: null, lessons: '' };
  const [h] = await sql<{ bulk: number; dev: number }[]>`
    select count(*) filter (where category = 'bulk')::int as bulk, count(*) filter (where category = 'development')::int as dev
    from email_thread where company_id = ${companyId} and type_checked_at is not null and id <> ${threadId}`;
  const fixes = await sql<TypeLesson[]>`
    select c.field, c.context, c.ai_value, c.human_value
    from correction c join email_thread t on t.id = c.entity_id
    where c.entity = 'email_thread' and c.field in ('order_type','topics') and t.company_id = ${companyId} and t.id <> ${threadId}
    order by c.created_at desc limit 15`;
  const history = h && h.bulk + h.dev > 0 ? `Conversations with this client that GRC's team checked: ${h.bulk} bulk, ${h.dev} development.` : null;
  return { history, lessons: buildTypeLessons(fixes, 'this_client_corrections') };
}

export interface ClassifyRequest {
  threadId: string;
  call: CallOptions<ThreadType>;
}

/** Builds the model call for one conversation, or null if there is nothing to read. */
export async function buildClassifyCall(sql: Db, settings: AppSettings, profile: string, threadId: string, model?: string): Promise<ClassifyRequest | null> {
  const [t] = await sql<{ company_id: string | null; company_name: string | null }[]>`
    select t.company_id, c.name as company_name from email_thread t left join company c on c.id = t.company_id where t.id = ${threadId}`;
  if (!t) return null;
  const all = (await loadThreadMessages(sql, threadId)).filter((m) => m.triageCategory !== 'marketing');
  if (all.length === 0) return null;
  const trimmed = all.map((m) => ({ ...m, body: m.body.length > PER_EMAIL_CHARS ? `${m.body.slice(0, PER_EMAIL_CHARS)} […]` : m.body }));
  const { kept, omitted } = fitThreadToBudget(trimmed, THREAD_CHARS);
  const clues = findClues(all.map((m) => ({ subject: m.subject, body: m.body, attachments: m.attachments })));
  const [global, client] = await Promise.all([getGlobalTypeLessons(sql), getClientContext(sql, t.company_id, threadId)]);
  const others = t.company_id
    ? await sql<{ category: string; subject: string | null; brand: string | null }[]>`
        select category::text as category, subject, brand from email_thread
        where company_id = ${t.company_id} and id <> ${threadId} and category in ('development','bulk','mixed')
        order by last_message_at desc nulls last limit 25`
    : [];
  const cfg = config();
  return {
    threadId,
    call: {
      purpose: 'classify',
      model: model ?? settings.ai_models.classify,
      system: classifySystem({ internalDomains: settings.internal_domains, knowledgeProfile: profile, learning: global }),
      user: classifyUserContent({
        companyName: t.company_name,
        clientHistory: client.history,
        clientLessons: client.lessons,
        otherConversations: others.map((o) => `[${o.category}] ${(o.subject ?? '(no subject)').slice(0, 100)}${o.brand ? ` (brand ${o.brand})` : ''}`),
        clues: cluesForPrompt(clues),
        omittedCount: omitted,
        messages: kept,
      }),
      schema: ThreadTypeSchema,
      maxTokens: 8000,
      effort: cfg.AI_EFFORT_CLASSIFY || cfg.AI_EFFORT_EXTRACT || undefined,
    },
  };
}

/** Clues are recomputed from the stored emails (they are cheap and deterministic). */
export async function threadClues(sql: Db, threadId: string): Promise<Clue[]> {
  const all = await loadThreadMessages(sql, threadId);
  return findClues(all.map((m) => ({ subject: m.subject, body: m.body, attachments: m.attachments })));
}

export interface ClassifyOutcome {
  category: string;
  changedType: boolean;
  approved: boolean;
  needsCheck: boolean;
}

/**
 * Writes the AI's answer, unless a person fixed the type/topics (then theirs stays).
 * Flags the row for a person when the AI isn't sure or disagrees with a strong clue.
 */
export async function applyClassification(
  sql: Sql,
  threadId: string,
  result: ThreadType | null,
  clues: readonly Clue[],
  error?: string,
  opts: { forceCheck?: boolean } = {},
): Promise<ClassifyOutcome | null> {
  return sql.begin(async (tx) => {
    const [t] = await tx<{ category: string; category_locked: boolean; topics: string[]; topics_locked: boolean; type_checked_at: Date | null; approval: string | null }[]>`
      select t.category::text as category, t.category_locked, t.topics, t.topics_locked, t.type_checked_at, c.approval
      from email_thread t left join company c on c.id = t.company_id
      where t.id = ${threadId} for update of t`;
    if (!t) return null;
    if (!result) {
      await tx`update email_thread set type_needs_check = ${!t.type_checked_at}, type_reason = ${`The AI could not sort this conversation (${(error ?? 'error').slice(0, 120)}).`} where id = ${threadId}`;
      return { category: t.category, changedType: false, approved: t.approval === 'approved', needsCheck: !t.type_checked_at };
    }
    const category = t.category_locked ? t.category : result.is_order ? result.order_type : 'other';
    const topics = t.topics_locked ? t.topics : [...new Set(result.topics)].sort();
    const confidence = Math.max(0, Math.min(1, Number.isFinite(result.confidence) ? result.confidence : 0));
    const conflicts = t.category_locked && t.topics_locked ? [] : clueConflicts({ isOrder: result.is_order, orderType: result.order_type, topics }, clues);
    const needsCheck = !t.type_checked_at && (confidence < CHECK_BELOW || conflicts.length > 0 || Boolean(opts.forceCheck));
    const reason = [result.reason.trim(), result.evidence?.trim() ? `Evidence: "${result.evidence.trim().slice(0, 200)}"` : '', conflicts.length ? `Please check: ${conflicts.join('; ')}.` : '']
      .filter(Boolean)
      .join(' ')
      .slice(0, 1000);

    await tx`
      update email_thread set
        category         = ${category},
        topics           = ${topics},
        type_confidence  = ${confidence},
        type_reason      = ${reason},
        type_needs_check = ${needsCheck},
        brand            = ${clean(result.brand, 60)},
        points           = ${(result.points ?? []).map((x) => clean(x, 140)).filter(Boolean).slice(0, 5) as string[]},
        title            = ${clean(result.title, 90)},
        customer_status  = ${clean(result.customer_status, 120)},
        customer_status_on = ${isoDay(result.customer_status_date)},
        grc_status       = ${clean(result.grc_status, 120)},
        grc_status_on    = ${isoDay(result.grc_status_date)},
        awaiting_grc     = ${Boolean(result.awaiting_grc)},
        is_meeting       = ${Boolean(result.is_meeting)},
        price_quoted     = ${clean(result.price_quoted, 60)},
        sample_status    = ${clean(result.sample_status, 40)},
        enquiry_ref      = ${clean(result.enquiry_ref, 60)},
        classified_at    = now()
      where id = ${threadId}`;

    const wasType = t.category === 'mixed' ? null : t.category;
    const changedType = (category === 'development' || category === 'bulk') && wasType !== category && ['development', 'bulk', 'mixed'].includes(t.category);
    // Rows the AI made for the old type go; rows a person edited are converted (see migration).
    if (changedType) await tx`select retype_thread_items(${threadId}::uuid, ${category})`;
    return { category, changedType, approved: t.approval === 'approved', needsCheck };
  });
}

/** True when an answer shouldn't be trusted without a second look. */
export function isDoubtful(r: ThreadType, clues: readonly Clue[]): boolean {
  const confidence = Number.isFinite(r.confidence) ? r.confidence : 0;
  return confidence < CHECK_BELOW || clueConflicts({ isOrder: r.is_order, orderType: r.order_type, topics: r.topics }, clues).length > 0;
}

const shortModel = (m: string) => (m.includes('opus') ? 'Opus' : m.includes('sonnet') ? 'Sonnet' : m.includes('haiku') ? 'Haiku' : m);

/**
 * When the first answer is doubtful, the stronger model reads the conversation again and its
 * answer is used. If the two disagree on the type, a person is asked to check.
 */
export async function secondOpinion(
  ctx: Ctx,
  settings: AppSettings,
  profile: string,
  threadId: string,
  first: ThreadType,
  clues: readonly Clue[],
): Promise<{ result: ThreadType; forceCheck: boolean }> {
  const reviewModel = settings.ai_models.classify_review;
  if (!reviewModel || reviewModel === settings.ai_models.classify || !isDoubtful(first, clues)) return { result: first, forceCheck: false };
  // A person already decided this conversation's type and topics: no second opinion needed.
  const [lock] = await ctx.sql<{ locked: boolean }[]>`select category_locked and topics_locked as locked from email_thread where id = ${threadId}`;
  if (lock?.locked) return { result: first, forceCheck: false };
  const req = await buildClassifyCall(ctx.sql, settings, profile, threadId, reviewModel);
  if (!req) return { result: first, forceCheck: false };
  try {
    const r = await getProvider().call(req.call);
    await recordAiRun(ctx.sql, { purpose: 'classify', model: reviewModel, threadId, usage: r.usage, ok: true });
    const second = r.data;
    const disagree = second.is_order !== first.is_order || second.order_type !== first.order_type;
    const firstSaid = first.is_order ? `${first.order_type}${first.topics.length ? ` + ${first.topics.join(', ')}` : ''}` : 'not an order';
    return {
      result: { ...second, reason: `${second.reason} (Checked twice: ${shortModel(reviewModel)} decided${disagree ? `; the first answer was ${firstSaid}` : ', both agree'}.)` },
      forceCheck: disagree,
    };
  } catch (e) {
    ctx.log.warn({ err: errorMessage(e), threadId }, 'classify second opinion failed');
    await recordAiRun(ctx.sql, { purpose: 'classify', model: reviewModel, threadId, ok: false, error: errorMessage(e) });
    return { result: first, forceCheck: false };
  }
}

/** Sorts one conversation now (live sync), with a second opinion when the first answer is doubtful. */
export async function classifyThread(ctx: Ctx, settings: AppSettings, profile: string, threadId: string): Promise<ClassifyOutcome | null> {
  const req = await buildClassifyCall(ctx.sql, settings, profile, threadId);
  if (!req) return null;
  const clues = await threadClues(ctx.sql, threadId);
  try {
    const r = await getProvider().call(req.call);
    await recordAiRun(ctx.sql, { purpose: 'classify', model: req.call.model, threadId, usage: r.usage, ok: true });
    const final = await secondOpinion(ctx, settings, profile, threadId, r.data, clues);
    return applyClassification(ctx.sql, threadId, final.result, clues, undefined, { forceCheck: final.forceCheck });
  } catch (e) {
    ctx.log.warn({ err: errorMessage(e), threadId }, 'classify failed');
    await recordAiRun(ctx.sql, { purpose: 'classify', model: req.call.model, threadId, ok: false, error: errorMessage(e) });
    return applyClassification(ctx.sql, threadId, null, clues, errorMessage(e));
  }
}
