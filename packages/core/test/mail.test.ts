import { describe, expect, it } from 'vitest';
import { cleanEmailBody, normalizeSubject } from '../src/mail/clean';
import { messageDirection, parseAddressList } from '../src/mail/addresses';
import { companyKey, normalizeIsoDate, similarity } from '../src/text';
import { threadCategoryFromTriage } from '../src/constants';
import { fitThreadToBudget } from '../src/ai/prompts';
import { decryptSecret, encryptSecret } from '../src/crypto';
import { randomBytes } from 'node:crypto';

describe('parseAddressList', () => {
  it('handles quotes, commas and bare addresses', () => {
    const r = parseAddressList('"Kumar, Ravi" <Ravi@X.com>, sales@y.in; Priya <p@z.co.in>');
    expect(r).toEqual([
      { name: 'Kumar, Ravi', email: 'ravi@x.com' },
      { name: null, email: 'sales@y.in' },
      { name: 'Priya', email: 'p@z.co.in' },
    ]);
  });
  it('skips junk', () => {
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
  });
});

describe('messageDirection', () => {
  const internal = ['grcorporation.co.in'];
  it('classifies', () => {
    expect(messageDirection('buyer@arvind.com', ['admin@grcorporation.co.in'], internal)).toBe('inbound');
    expect(messageDirection('poornima@grcorporation.co.in', ['buyer@arvind.com'], internal)).toBe('outbound');
    expect(messageDirection('poornima@grcorporation.co.in', ['admin@grcorporation.co.in'], internal)).toBe('internal');
  });
});

describe('cleanEmailBody', () => {
  it('drops Gmail quoted history', () => {
    const body = 'Please share revised price for 25MM.\n\nRegards,\nRavi\n\nOn Tue, 12 Oct 2026 at 10:02, GRC <admin@grcorporation.co.in>\nwrote:\n> Dear Ravi,\n> PFA quote.';
    expect(cleanEmailBody(body)).toBe('Please share revised price for 25MM.\n\nRegards,\nRavi');
  });
  it('drops Outlook headers', () => {
    const body = 'Approved, go ahead.\n\nFrom: Poornima <p@grcorporation.co.in>\nSent: Monday, 2 Nov 2026 11:00\nTo: Ravi\nSubject: RE: samples';
    expect(cleanEmailBody(body)).toBe('Approved, go ahead.');
  });
  it('keeps forwarded content', () => {
    const body = 'FYI\n\n---------- Forwarded message ---------\nFrom: buyer@x.com\nNeed 30mm knitted elastic.';
    expect(cleanEmailBody(body)).toContain('Need 30mm knitted elastic.');
  });
  it('drops legal disclaimers', () => {
    const body = 'Send 3 meters for BV.\n\nDISCLAIMER: This email is confidential...';
    expect(cleanEmailBody(body)).toBe('Send 3 meters for BV.');
  });
});

describe('helpers', () => {
  it('normalizeSubject', () => expect(normalizeSubject('RE: Fwd: RE: VH-81 samples')).toBe('VH-81 samples'));
  it('companyKey', () => expect(companyKey('Arvind Fashion Pvt. Ltd.')).toBe(companyKey('ARVIND FASHION')));
  it('normalizeIsoDate', () => {
    expect(normalizeIsoDate('2026-10-26')).toBe('2026-10-26');
    expect(normalizeIsoDate('2026-10-26T10:00:00Z')).toBe('2026-10-26');
    expect(normalizeIsoDate('soon')).toBeNull();
  });
  it('similarity', () => expect(similarity('US POLO ELASTIC 25MM', 'us polo elastic')).toBeGreaterThan(0.6));
  it('threadCategoryFromTriage', () => {
    expect(threadCategoryFromTriage(['development', 'bulk'])).toBe('bulk');
    expect(threadCategoryFromTriage(['payment', 'development'])).toBe('development');
    expect(threadCategoryFromTriage(['marketing', 'courier'])).toBe('ignored');
    expect(threadCategoryFromTriage([])).toBe('unclassified');
  });
  it('fitThreadToBudget keeps the first and latest emails', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ id: i, body: 'x'.repeat(1000) }));
    const r = fitThreadToBudget(msgs, 5000);
    expect(r.kept[0]!.id).toBe(0);
    expect(r.kept.at(-1)!.id).toBe(9);
    expect(r.kept.length + r.omitted).toBe(10);
  });
  it('encrypts and decrypts', () => {
    const key = randomBytes(32).toString('base64');
    const enc = encryptSecret('1//refresh-token', key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(enc, key)).toBe('1//refresh-token');
    expect(() => decryptSecret(enc, randomBytes(32).toString('base64'))).toThrow();
  });
});

import { buildLearningContext } from '../src/ai/prompts';
describe('buildLearningContext', () => {
  it('renders sheet examples and corrections, and nothing when empty', () => {
    expect(buildLearningContext([], [])).toBe('');
    const out = buildLearningContext(
      [{ company: 'ARVIND FASHION', brand: 'UCLA', inquiry: 'DAISY', team_status: 'SAMPLES DISPATCH - WAITING FOR CUSTOMER FEEDBACK', stage: 'sample_dispatched' }],
      [{ field: 'stage', ai_value: 'prices_shared', human_value: 'sample_dispatched', context: 'UCLA DAISY' }],
    );
    expect(out).toContain('ARVIND FASHION | UCLA | DAISY | - | SAMPLES DISPATCH');
    expect(out).toContain('stage (UCLA DAISY): AI wrote "prices_shared" → team changed it to "sample_dispatched"');
  });
});
