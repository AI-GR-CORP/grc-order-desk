import type { AppSettings } from '@grc/core';
import { isBulkMailCategory, isSkippableMessage, parseGmailMessage, type GmailThread, type ParsedMessage } from '@grc/core/gmail';
import { cleanEmailBody, isInternal, messageDirection } from '@grc/core/mail';
import { retryOnConflict, type Sql } from '../db';

export interface IngestResult {
  threadId: string;
  newMessageIds: string[];
  /** New external-facing messages (inbound/outbound) that still need AI triage. */
  needsTriageIds: string[];
  messageCount: number;
}

function attachmentKind(filename: string, mime: string): 'image' | 'pi' | 'po' | 'test_report' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  const f = filename.toLowerCase();
  if (/\b(pi|proforma|pro-forma)\b/.test(f)) return 'pi';
  if (/\b(po|purchase[ _-]?order)\b/.test(f)) return 'po';
  if (/(report|test|\bbv\b|intertek|sgs|tuv)/.test(f)) return 'test_report';
  return 'other';
}

/**
 * Stores a Gmail thread. Idempotent: messages are keyed by Gmail id, attachments by MIME part id.
 * Outbound/internal/promotional mail is pre-labelled here so it never costs an AI call.
 */
export async function ingestThread(
  sql: Sql,
  settings: AppSettings,
  mailboxId: string,
  g: GmailThread,
): Promise<IngestResult | null> {
  const parsed: (ParsedMessage & { from: NonNullable<ParsedMessage['from']> })[] = [];
  for (const raw of g.messages ?? []) {
    const m = parseGmailMessage(raw);
    if (!m.from || isSkippableMessage(m.labelIds)) continue;
    parsed.push(m as ParsedMessage & { from: NonNullable<ParsedMessage['from']> });
  }
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const subject = parsed[0]!.subject || null;

  return retryOnConflict(() => sql.begin(async (tx) => {
    const [thread] = await tx<{ id: string }[]>`
      insert into email_thread (mailbox_id, gmail_thread_id, subject)
      values (${mailboxId}, ${g.id}, ${subject})
      on conflict (mailbox_id, gmail_thread_id) do update set subject = coalesce(email_thread.subject, excluded.subject)
      returning id`;
    const threadId = thread!.id;

    const known = new Map(
      (await tx<{ id: string; gmail_message_id: string }[]>`
        select id, gmail_message_id from email_message where thread_id = ${threadId}`).map((r) => [r.gmail_message_id, r.id]),
    );

    const newMessageIds: string[] = [];
    const needsTriageIds: string[] = [];

    for (const m of parsed) {
      let messageId = known.get(m.gmailId);
      if (!messageId) {
        const recipients = [...m.to, ...m.cc].map((a) => a.email);
        const direction = messageDirection(m.from.email, recipients, settings.internal_domains);
        const promo = isBulkMailCategory(m.labelIds);
        const preTriage =
          direction === 'internal'
            ? { category: 'internal', auto: true }
            : promo
              ? { category: 'marketing', auto: true }
              : null;
        const body = promo ? null : cleanEmailBody(m.text);
        const [row] = await tx<{ id: string }[]>`
          insert into email_message (
            thread_id, gmail_message_id, rfc_message_id, sent_at, direction, from_email, from_name,
            to_emails, cc_emails, label_ids, subject, snippet, body_clean, triage, needs_reply, triaged_at)
          values (
            ${threadId}, ${m.gmailId}, ${m.rfcMessageId}, ${m.sentAt}, ${direction}, ${m.from.email}, ${m.from.name},
            ${m.to.map((a) => a.email)}::text[], ${m.cc.map((a) => a.email)}::text[], ${m.labelIds}::text[],
            ${m.subject || null}, ${m.snippet.slice(0, 500)}, ${body},
            ${preTriage ? tx.json(preTriage) : null},
            ${direction === 'inbound' && !promo ? null : false},
            ${preTriage ? new Date() : null})
          on conflict (gmail_message_id) do nothing
          returning id`;
        if (!row) continue;
        messageId = row.id;
        newMessageIds.push(messageId);
        if (!preTriage) needsTriageIds.push(messageId);

        if (direction === 'inbound' && !isInternal(m.from.email, settings.internal_domains)) {
          await tx`
            insert into contact (email, name) values (${m.from.email}, ${m.from.name})
            on conflict (email) do update set name = coalesce(contact.name, excluded.name)`;
        }
      }

      // Refresh attachment ids on every fetch: Gmail attachment ids are not stable over time.
      for (const a of m.attachments) {
        await tx`
          insert into attachment (message_id, part_id, gmail_attachment_id, filename, mime_type, size_bytes, inline, kind)
          values (${messageId}, ${a.partId}, ${a.attachmentId}, ${a.filename}, ${a.mimeType}, ${a.size}, ${a.inline},
                  ${attachmentKind(a.filename, a.mimeType)})
          on conflict (message_id, part_id) do update set gmail_attachment_id = excluded.gmail_attachment_id`;
      }
    }

    await tx`
      update email_thread t set
        first_message_at = a.first_at,
        last_message_at  = a.last_at,
        last_inbound_at  = a.last_in,
        last_outbound_at = a.last_out
      from (
        select min(sent_at) as first_at, max(sent_at) as last_at,
               max(sent_at) filter (where direction = 'inbound')  as last_in,
               max(sent_at) filter (where direction = 'outbound') as last_out
        from email_message where thread_id = ${threadId}
      ) a
      where t.id = ${threadId}`;

    return { threadId, newMessageIds, needsTriageIds, messageCount: parsed.length };
  }));
}
