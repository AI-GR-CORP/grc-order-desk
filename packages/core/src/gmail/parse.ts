import { htmlToText } from '../mail/html';
import { parseAddressList, type Address } from '../mail/addresses';
import type { GmailMessage, GmailPart } from './types';

export interface ParsedAttachment {
  partId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
}

export interface ParsedMessage {
  gmailId: string;
  threadId: string;
  labelIds: string[];
  sentAt: Date;
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string;
  rfcMessageId: string | null;
  snippet: string;
  /** Best-effort plain text of the body (text/plain preferred, else converted HTML). Not yet cleaned. */
  text: string;
  attachments: ParsedAttachment[];
}

function header(part: GmailPart | undefined, name: string): string | undefined {
  const n = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
}

function decodeBody(data: string, contentType: string | undefined): string {
  const bytes = Buffer.from(data, 'base64url');
  const charset = contentType?.match(/charset="?([^";\s]+)/i)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function walk(part: GmailPart, visit: (p: GmailPart) => void): void {
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

export function parseGmailMessage(msg: GmailMessage): ParsedMessage {
  const payload = msg.payload ?? {};
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: ParsedAttachment[] = [];

  walk(payload, (p) => {
    const mime = (p.mimeType ?? '').toLowerCase();
    const disposition = header(p, 'Content-Disposition') ?? '';
    if (p.body?.attachmentId && (p.filename || !mime.startsWith('text/'))) {
      attachments.push({
        partId: p.partId ?? p.body.attachmentId,
        attachmentId: p.body.attachmentId,
        filename: p.filename || 'attachment',
        mimeType: mime || 'application/octet-stream',
        size: p.body.size ?? 0,
        inline: /^\s*inline/i.test(disposition) || Boolean(header(p, 'Content-ID')),
      });
      return;
    }
    if (p.filename) return;
    if (!p.body?.data) return;
    if (mime === 'text/plain') plain.push(decodeBody(p.body.data, header(p, 'Content-Type')));
    else if (mime === 'text/html') html.push(decodeBody(p.body.data, header(p, 'Content-Type')));
  });

  const plainText = plain.join('\n').trim();
  const text = plainText.length > 0 ? plainText : html.map(htmlToText).join('\n').trim();

  const internal = msg.internalDate ? Number(msg.internalDate) : NaN;
  const dateHeader = header(payload, 'Date');
  const sentAt = Number.isFinite(internal) ? new Date(internal) : dateHeader ? new Date(dateHeader) : new Date();

  return {
    gmailId: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
    from: parseAddressList(header(payload, 'From'))[0] ?? null,
    to: parseAddressList(header(payload, 'To')),
    cc: parseAddressList(header(payload, 'Cc')),
    subject: header(payload, 'Subject') ?? '',
    rfcMessageId: header(payload, 'Message-ID') ?? header(payload, 'Message-Id') ?? null,
    snippet: msg.snippet ?? '',
    text,
    attachments,
  };
}

/** Gmail labels that mean "do not process". */
export function isSkippableMessage(labelIds: readonly string[]): boolean {
  return labelIds.some((l) => l === 'DRAFT' || l === 'SPAM' || l === 'TRASH' || l === 'CHAT');
}

/** Promotions/Social mail never needs AI: it is marketing by definition. */
export function isBulkMailCategory(labelIds: readonly string[]): boolean {
  return labelIds.some((l) => l === 'CATEGORY_PROMOTIONS' || l === 'CATEGORY_SOCIAL' || l === 'CATEGORY_FORUMS');
}

/** The message as it was written: its HTML part (or plain text), and its inline images by Content-ID. */
export function originalBody(msg: GmailMessage): { html: string | null; text: string | null; inline: { cid: string; partId: string }[] } {
  let html: string | null = null;
  let text: string | null = null;
  const inline: { cid: string; partId: string }[] = [];
  walk(msg.payload ?? {}, (p) => {
    const mime = (p.mimeType ?? '').toLowerCase();
    if (!p.body?.attachmentId && p.body?.data && !p.filename) {
      if (mime === 'text/html' && html === null) html = decodeBody(p.body.data, header(p, 'Content-Type'));
      else if (mime === 'text/plain' && text === null) text = decodeBody(p.body.data, header(p, 'Content-Type'));
    }
    const cid = header(p, 'Content-ID')?.replace(/^<|>$/g, '');
    if (cid && p.partId && p.body?.attachmentId) inline.push({ cid, partId: p.partId });
  });
  return { html, text, inline };
}

/** Gmail attachment ids change between fetches; the part id doesn't. */
export function attachmentIdForPart(msg: GmailMessage, partId: string): string | null {
  let id: string | null = null;
  walk(msg.payload ?? {}, (p) => {
    if (p.partId === partId && p.body?.attachmentId) id = p.body.attachmentId;
  });
  return id;
}
