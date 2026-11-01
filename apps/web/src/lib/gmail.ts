import 'server-only';
import { decryptSecret } from '@grc/core/crypto';
import { GmailApi, GmailApiError, attachmentIdForPart, refreshAccessToken } from '@grc/core/gmail';
import { env } from './env';
import { createAdmin } from './supabase/admin';

const tokens = new Map<string, { token: string; exp: number }>();

/**
 * Read-only Gmail access for one connected mailbox, used to show attachments and original
 * emails inside the dashboard. Only call after checking the person is a GRC user.
 */
export async function gmailForMailbox(mailboxId: string): Promise<GmailApi> {
  const { data, error } = await createAdmin().from('mailbox').select('refresh_token_enc').eq('id', mailboxId).single();
  if (error || !data?.refresh_token_enc) throw new Error('Gmail is not connected for this mailbox.');
  const refreshToken = decryptSecret(data.refresh_token_enc as string, env.tokenKey());
  return new GmailApi(async (force) => {
    const cached = tokens.get(mailboxId);
    if (!force && cached && cached.exp - Date.now() > 120_000) return cached.token;
    const r = await refreshAccessToken({ refreshToken, clientId: env.googleClientId(), clientSecret: env.googleClientSecret() });
    tokens.set(mailboxId, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
    return r.access_token;
  });
}

/** Downloads an attachment; if Gmail rotated its id, looks it up again by the stable part id. */
export async function fetchAttachment(
  api: GmailApi,
  a: { gmailMessageId: string; gmailAttachmentId: string; partId: string },
): Promise<{ data: Buffer; attachmentId: string }> {
  try {
    return { data: await api.getAttachment(a.gmailMessageId, a.gmailAttachmentId), attachmentId: a.gmailAttachmentId };
  } catch (e) {
    if (!(e instanceof GmailApiError) || (e.status !== 400 && e.status !== 404)) throw e;
    const msg = await api.getMessage(a.gmailMessageId);
    const fresh = attachmentIdForPart(msg, a.partId);
    if (!fresh) throw e;
    return { data: await api.getAttachment(a.gmailMessageId, fresh), attachmentId: fresh };
  }
}
