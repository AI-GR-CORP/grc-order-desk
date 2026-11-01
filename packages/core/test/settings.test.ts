import { describe, expect, it } from 'vitest';
import { parseSettings } from '../src/settings';

describe('parseSettings', () => {
  it('fills defaults and keeps valid keys when one is broken', () => {
    const s = parseSettings([
      { key: 'reply_sla_minutes', value: 45 },
      { key: 'non_moving_days', value: 'oops' },
    ]);
    expect(s.reply_sla_minutes).toBe(45);
    expect(s.non_moving_days).toBe(21);
    expect(s.business_hours.tz).toBe('Asia/Kolkata');
    expect(s.ai_models.triage).toBe('claude-haiku-5-5');
  });
});
