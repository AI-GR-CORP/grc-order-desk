import { describe, expect, it } from 'vitest';
import { attachmentIdForPart, originalBody } from '../src/gmail/parse';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const msg = {
  id: 'm1',
  threadId: 't1',
  payload: {
    mimeType: 'multipart/related',
    parts: [
      {
        partId: '0',
        mimeType: 'multipart/alternative',
        parts: [
          { partId: '0.0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: { data: b64('Qty 5,400 mtrs') } },
          { partId: '0.1', mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: { data: b64('<table><tr><td>Qty</td><td>5,400 mtrs</td></tr></table><img src="cid:logo123">') } },
        ],
      },
      { partId: '1', mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo123>' }], body: { attachmentId: 'ATT-NEW', size: 900 } },
      { partId: '2', mimeType: 'application/pdf', filename: 'PO_4512.pdf', body: { attachmentId: 'ATT-PO', size: 52000 } },
    ],
  },
};

describe('original email body', () => {
  it('keeps the HTML (tables intact) and finds inline images', () => {
    const o = originalBody(msg as never);
    expect(o.html).toContain('<td>5,400 mtrs</td>');
    expect(o.text).toBe('Qty 5,400 mtrs');
    expect(o.inline).toEqual([{ cid: 'logo123', partId: '1' }]);
  });
  it('resolves the current attachment id from the stable part id', () => {
    expect(attachmentIdForPart(msg as never, '2')).toBe('ATT-PO');
    expect(attachmentIdForPart(msg as never, '9')).toBeNull();
  });
});
