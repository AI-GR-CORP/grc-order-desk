import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://unused';
const { retryOnConflict } = await import('../src/db');

const pgError = (code: string) => Object.assign(new Error(code === '40P01' ? 'deadlock detected' : 'boom'), { code });

describe('retryOnConflict', () => {
  it('retries deadlocks and then succeeds', async () => {
    let calls = 0;
    const r = await retryOnConflict(async () => {
      calls++;
      if (calls < 3) throw pgError('40P01');
      return 'saved';
    });
    expect(r).toBe('saved');
    expect(calls).toBe(3);
  });
  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw pgError('23505'); })).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
  it('gives up after the limit', async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw pgError('40P01'); }, 3)).rejects.toThrow('deadlock');
    expect(calls).toBe(3);
  });
});
