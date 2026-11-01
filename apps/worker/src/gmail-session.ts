import { decryptSecret } from '@grc/core/crypto';
import { GmailApi, OAuthError, refreshAccessToken } from '@grc/core/gmail';
import { need } from './config';
import type { Db } from './db';
import { NonRetryableError } from './errors';

export interface MailboxRow {
  id: string;
  email: string;
  refresh_token_enc: string | null;
  history_id: string | null;
  status: 'pending' | 'backfilling' | 'active' | 'needs_reconnect' | 'paused';
  backfill_stage: string;
  backfill_progress: Record<string, unknown>;
  backfill_target: number;
}

const tokens = new Map<string, { token: string; exp: number }>();

export async function loadMailbox(sql: Db, id: string): Promise<MailboxRow> {
  const [mb] = await sql<MailboxRow[]>`
    select id, email, refresh_token_enc, history_id, status, backfill_stage, backfill_progress, backfill_target
    from mailbox where id = ${id}`;
  if (!mb) throw new NonRetryableError(`Mailbox ${id} not found`);
  return mb;
}

/** A Gmail client whose access token is refreshed automatically. Marks the mailbox if Google revokes access. */
export function gmailFor(sql: Db, mb: MailboxRow): GmailApi {
  if (!mb.refresh_token_enc) throw new NonRetryableError(`Mailbox ${mb.email} has no Gmail connection`);
  const refreshToken = decryptSecret(mb.refresh_token_enc, need('TOKEN_ENCRYPTION_KEY'));

  return new GmailApi(async (force) => {
    const cached = tokens.get(mb.id);
    if (!force && cached && cached.exp - Date.now() > 120_000) return cached.token;
    try {
      const r = await refreshAccessToken({
        refreshToken,
        clientId: need('GOOGLE_CLIENT_ID'),
        clientSecret: need('GOOGLE_CLIENT_SECRET'),
      });
      tokens.set(mb.id, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
      return r.access_token;
    } catch (e) {
      if (e instanceof OAuthError && (e.code === 'invalid_grant' || e.code === 'unauthorized_client')) {
        tokens.delete(mb.id);
        await sql`
          update mailbox set status = 'needs_reconnect',
                 last_error = 'Google access was revoked or expired. Reconnect Gmail in Settings.'
          where id = ${mb.id}`;
        throw new NonRetryableError(`Gmail access revoked for ${mb.email}`);
      }
      throw e;
    }
  });
}
