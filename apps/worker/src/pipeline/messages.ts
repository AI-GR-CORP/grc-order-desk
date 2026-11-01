import type { PromptMessage } from '@grc/core/ai';
import type { Db } from '../db';

export interface StoredMessage extends PromptMessage {
  id: string;
  threadId: string;
  needsReply: boolean | null;
  triageCategory: string | null;
}

interface Row {
  id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound' | 'internal';
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  sent_at: Date;
  subject: string | null;
  body_clean: string | null;
  snippet: string | null;
  needs_reply: boolean | null;
  triage: { category?: string } | null;
  attachments: string[] | null;
}

function toStored(r: Row): StoredMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    direction: r.direction,
    from: r.from_email,
    fromName: r.from_name,
    to: r.to_emails,
    cc: r.cc_emails,
    sentAt: r.sent_at,
    subject: r.subject ?? '',
    body: r.body_clean ?? r.snippet ?? '',
    attachments: r.attachments ?? [],
    needsReply: r.needs_reply,
    triageCategory: r.triage?.category ?? null,
  };
}

const SELECT = (sql: Db) => sql`
  select m.id, m.thread_id, m.direction, m.from_email, m.from_name, m.to_emails, m.cc_emails, m.sent_at,
         m.subject, m.body_clean, m.snippet, m.needs_reply, m.triage,
         (select array_agg(a.filename order by a.filename) from attachment a
           where a.message_id = m.id and not (a.inline and coalesce(a.size_bytes, 0) < 15000)) as attachments
  from email_message m`;

export async function loadMessages(sql: Db, ids: readonly string[]): Promise<StoredMessage[]> {
  if (ids.length === 0) return [];
  const rows = await sql<Row[]>`${SELECT(sql)} where m.id = any(${ids as string[]}::uuid[]) order by m.sent_at`;
  return rows.map(toStored);
}

export async function loadThreadMessages(sql: Db, threadId: string): Promise<StoredMessage[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} where m.thread_id = ${threadId} order by m.sent_at`;
  return rows.map(toStored);
}
