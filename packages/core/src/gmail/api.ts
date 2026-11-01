import type { GmailMessage, GmailHistoryList, GmailProfile, GmailThread, GmailThreadList } from './types';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/';

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}

export type TokenProvider = (forceRefresh?: boolean) => Promise<string>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal read-only Gmail client with retry/backoff. Never sends, modifies or deletes mail. */
export class GmailApi {
  constructor(
    private readonly token: TokenProvider,
    private readonly maxRetries = 5,
  ) {}

  private async get<T>(path: string, query: Record<string, string | string[] | number | undefined> = {}): Promise<T> {
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { authorization: `Bearer ${await this.token(false)}` } });
      if (res.ok) return (await res.json()) as T;

      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason;
      const msg = body.error?.message ?? res.statusText;

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.token(true);
        continue;
      }
      const rateLimited = res.status === 429 || (res.status === 403 && /rate|quota/i.test(reason ?? ''));
      if ((rateLimited || res.status >= 500) && attempt < this.maxRetries) {
        await sleep(Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 300);
        continue;
      }
      throw new GmailApiError(`Gmail ${res.status} on ${path}: ${msg}`, res.status, reason);
    }
  }

  getProfile(): Promise<GmailProfile> {
    return this.get('profile');
  }

  listThreads(opts: { q?: string; pageToken?: string; maxResults?: number }): Promise<GmailThreadList> {
    return this.get('threads', { q: opts.q, pageToken: opts.pageToken, maxResults: opts.maxResults ?? 100 });
  }

  getThread(id: string): Promise<GmailThread> {
    return this.get(`threads/${encodeURIComponent(id)}`, { format: 'full' });
  }

  /** Throws GmailApiError with status 404 when startHistoryId is too old — caller must resync. */
  listHistory(opts: { startHistoryId: string; pageToken?: string }): Promise<GmailHistoryList> {
    return this.get('history', {
      startHistoryId: opts.startHistoryId,
      pageToken: opts.pageToken,
      historyTypes: ['messageAdded'],
      maxResults: 500,
    });
  }

  getMessage(id: string): Promise<GmailMessage> {
    return this.get(`messages/${encodeURIComponent(id)}`, { format: 'full' });
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const r = await this.get<{ data?: string; size: number }>(
      `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return Buffer.from(r.data ?? '', 'base64url');
  }
}
