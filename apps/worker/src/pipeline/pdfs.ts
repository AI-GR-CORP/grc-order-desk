import { parseGmailMessage, type GmailApi } from '@grc/core/gmail';
import type { Ctx } from '../context';
import { errorMessage } from '../errors';

const MAX_DOCS = 4;
const MAX_FILE = 4_000_000;
const MAX_TOTAL = 8_000_000;

/**
 * PDF attachments of a thread (PI and PO first, newest first) for the extraction model.
 * Bulk-order numbers usually live in these PDFs, not in the email text.
 */
export async function loadThreadPdfs(ctx: Ctx, api: GmailApi, threadId: string): Promise<{ title: string; base64: string }[]> {
  const rows = await ctx.sql<{
    id: string;
    filename: string | null;
    part_id: string;
    gmail_attachment_id: string;
    size_bytes: number | null;
    gmail_message_id: string;
    gmail_thread_id: string;
  }[]>`
    select a.id, a.filename, a.part_id, a.gmail_attachment_id, a.size_bytes, m.gmail_message_id, t.gmail_thread_id
    from attachment a
    join email_message m on m.id = a.message_id
    join email_thread t on t.id = m.thread_id
    where m.thread_id = ${threadId}
      and (a.mime_type = 'application/pdf' or lower(a.filename) like '%.pdf')
      and coalesce(a.size_bytes, 0) between 1 and ${MAX_FILE}
    order by (a.kind in ('pi', 'po')) desc, m.sent_at desc
    limit ${MAX_DOCS}`;

  const out: { title: string; base64: string }[] = [];
  let total = 0;
  for (const r of rows) {
    try {
      let buf: Buffer;
      try {
        buf = await api.getAttachment(r.gmail_message_id, r.gmail_attachment_id);
      } catch {
        // Attachment ids expire; re-read the message to get a fresh one.
        const thread = await api.getThread(r.gmail_thread_id);
        const msg = thread.messages?.find((m) => m.id === r.gmail_message_id);
        const part = msg ? parseGmailMessage(msg).attachments.find((a) => a.partId === r.part_id) : undefined;
        if (!part) continue;
        await ctx.sql`update attachment set gmail_attachment_id = ${part.attachmentId} where id = ${r.id}`;
        buf = await api.getAttachment(r.gmail_message_id, part.attachmentId);
      }
      if (buf.subarray(0, 4).toString('latin1') !== '%PDF') continue;
      if (total + buf.length > MAX_TOTAL) break;
      total += buf.length;
      out.push({ title: r.filename ?? 'attachment.pdf', base64: buf.toString('base64') });
    } catch (e) {
      ctx.log.warn({ attachmentId: r.id, err: errorMessage(e) }, 'could not load PDF');
    }
  }
  return out;
}
