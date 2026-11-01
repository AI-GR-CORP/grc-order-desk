import { TRACKED_CATEGORIES, type AppSettings } from '@grc/core';
import { GmailApiError, type GmailApi } from '@grc/core/gmail';
import type { Ctx } from '../context';
import type { MailboxRow } from '../gmail-session';
import { resolveThreadCompany } from './companies';
import { extractThread } from './extract';
import { ingestThread } from './ingest';
import { recomputeReply } from './reply';
import { ensureThumbnails } from './thumbnails';
import { isThreadClientApproved } from './approval';
import { triageMessages, updateThreadCategory } from './triage';
import { classifyThread, needsClassification } from './classify';

export interface ProcessOptions {
  /** Run the extraction model if the thread is tracked and has unseen messages. */
  extract: boolean;
  /** Re-run extraction even if nothing new arrived (dashboard "Re-run AI"). */
  forceExtract?: boolean;
}

/** Fetch → store → triage → (extract) → reply state, for one Gmail thread. */
export async function processThread(
  ctx: Ctx,
  api: GmailApi,
  mb: MailboxRow,
  settings: AppSettings,
  profile: string,
  gmailThreadId: string,
  opts: ProcessOptions,
): Promise<void> {
  let thread;
  try {
    thread = await api.getThread(gmailThreadId);
  } catch (e) {
    if (e instanceof GmailApiError && e.status === 404) return; // deleted since
    throw e;
  }
  const ing = await ingestThread(ctx.sql, settings, mb.id, thread);
  if (!ing) return;

  if (ing.needsTriageIds.length) await triageMessages(ctx, settings, profile, ing.needsTriageIds);
  let category = await updateThreadCategory(ctx.sql, ing.threadId);
  await resolveThreadCompany(ctx.sql, settings, ing.threadId);
  // Conversation-level sort: development or bulk, plus topics (skipped if a person fixed them).
  if (await needsClassification(ctx.sql, ing.threadId)) {
    const o = await classifyThread(ctx, settings, profile, ing.threadId);
    if (o) category = o.category as typeof category;
  }

  // Only clients an owner approved are read in depth (and cost AI tokens).
  if (opts.extract && TRACKED_CATEGORIES.includes(category) && (await isThreadClientApproved(ctx.sql, ing.threadId))) {
    const [t] = await ctx.sql<{ stale: boolean }[]>`
      select (extracted_through is null or extracted_through < last_message_at) as stale
      from email_thread where id = ${ing.threadId}`;
    if (opts.forceExtract || t?.stale) {
      await extractThread(ctx, settings, profile, ing.threadId, api);
      await ensureThumbnails(ctx, api, ing.threadId);
    }
  }
  await recomputeReply(ctx.sql, settings, ing.threadId);
}
