import { describe, expect, it } from 'vitest';
import { parseGmailMessage } from '../src/gmail/parse';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('parseGmailMessage', () => {
  it('prefers text/plain and lists real attachments', () => {
    const p = parseGmailMessage({
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX'],
      internalDate: String(Date.UTC(2026, 9, 26, 5, 0)),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Ravi Kumar <ravi@arvindbrands.co.in>' },
          { name: 'To', value: 'admin@grcorporation.co.in' },
          { name: 'Cc', value: '"Sharma, A" <a@arvindbrands.co.in>' },
          { name: 'Subject', value: 'UCLA elastic samples' },
        ],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64('Need 25MM samples – 4 combos') } },
              { mimeType: 'text/html', body: { data: b64('<p>Need 25MM samples</p>') } },
            ],
          },
          { partId: '1', mimeType: 'image/jpeg', filename: 'swatch.jpg', body: { attachmentId: 'att-1', size: 120000 } },
        ],
      },
    });
    expect(p.text).toBe('Need 25MM samples – 4 combos');
    expect(p.from).toEqual({ name: 'Ravi Kumar', email: 'ravi@arvindbrands.co.in' });
    expect(p.cc[0]!.email).toBe('a@arvindbrands.co.in');
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]!.partId).toBe('1');
    expect(p.sentAt.toISOString()).toBe('2026-10-26T05:00:00.000Z');
  });
  it('falls back to HTML and skips Gmail quotes', () => {
    const p = parseGmailMessage({
      id: 'm2',
      threadId: 't1',
      payload: {
        mimeType: 'text/html',
        body: { data: b64('<div>Please send PI.</div><div class="gmail_quote">On Mon … wrote: old stuff</div>') },
      },
    });
    expect(p.text).toContain('Please send PI.');
    expect(p.text).not.toContain('old stuff');
  });
});
