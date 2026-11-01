import type { GmailApi } from '@grc/core/gmail';
import type { Ctx } from '../context';
import { getKnowledgeProfile, getSettings } from '../db';
import { errorMessage } from '../errors';
import { gmailFor, loadMailbox } from '../gmail-session';
import { extractThread } from '../pipeline/extract';
import { recomputeReply } from '../pipeline/reply';
import { ensureThumbnails } from '../pipeline/thumbnails';

/**
 * Runs right after an owner approves a client: reads that client's development and bulk
 * conversations one after another (oldest first, so later threads see items found earlier).
 */
export async function runExtractCompany(ctx: Ctx, companyId: string): Promise<void> {
  const { sql } = ctx;
  const [company] = await sql<{ name: string; approval: string }[]>`select name, approval from company where id = ${companyId}`;
  if (!company || company.approval !== 'approved') return;

  const settings = await getSettings(sql, true);
  const profile = await getKnowledgeProfile(sql);
  const threads = await sql<{ id: string; mailbox_id: string }[]>`
    select id, mailbox_id from email_thread
    where company_id = ${companyId} and category in ('development','bulk','mixed')
      and (extracted_through is null or extracted_through < last_message_at)
    order by first_message_at`;

  // One Gmail client per mailbox, used for PDFs and pictures. Without Gmail access the text is still read.
  const apis = new Map<string, GmailApi | undefined>();
  const apiFor = async (mailboxId: string) => {
    if (!apis.has(mailboxId)) {
      try {
        const mb = await loadMailbox(sql, mailboxId);
        apis.set(mailboxId, mb.refresh_token_enc && mb.status !== 'needs_reconnect' ? gmailFor(sql, mb) : undefined);
      } catch {
        apis.set(mailboxId, undefined);
      }
    }
    return apis.get(mailboxId);
  };

  let ok = 0;
  for (const t of threads) {
    const api = await apiFor(t.mailbox_id);
    try {
      if (await extractThread(ctx, settings, profile, t.id, api)) ok++;
      if (api) await ensureThumbnails(ctx, api, t.id);
    } catch (e) {
      ctx.log.warn({ threadId: t.id, err: errorMessage(e) }, 'extract_company: thread failed');
    }
    await recomputeReply(sql, settings, t.id);
  }
  ctx.log.info({ company: company.name, threads: threads.length, ok }, 'client approved and read');
}
