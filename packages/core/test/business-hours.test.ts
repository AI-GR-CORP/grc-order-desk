import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, businessMinutesBetween } from '../src/business-hours';
import { BusinessHoursSchema } from '../src/settings';

const IST = BusinessHoursSchema.parse({}); // Mon–Sat 10:00–19:00 Asia/Kolkata
const ist = (s: string) => new Date(s + '+05:30');
const iso = (d: Date) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16);

describe('addBusinessMinutes (IST, Mon–Sat 10–19)', () => {
  it('stays inside the same working day', () => {
    expect(iso(addBusinessMinutes(ist('2026-11-02T11:00'), 60, IST))).toBe('2026-11-02T12:00');
  });
  it('rolls an evening email into the next morning', () => {
    // Mon 18:30 → 30 min left today, 30 min tomorrow
    expect(iso(addBusinessMinutes(ist('2026-11-02T18:30'), 60, IST))).toBe('2026-11-03T10:30');
  });
  it('skips Sunday', () => {
    // Sat 18:45 → 15 min Sat, 45 min Mon
    expect(iso(addBusinessMinutes(ist('2026-11-07T18:45'), 60, IST))).toBe('2026-11-09T10:45');
  });
  it('starts the clock at opening time for overnight email', () => {
    expect(iso(addBusinessMinutes(ist('2026-11-08T03:00'), 60, IST))).toBe('2026-11-09T11:00'); // Sunday 3am
    expect(iso(addBusinessMinutes(ist('2026-11-03T06:00'), 60, IST))).toBe('2026-11-03T11:00'); // Tue 6am
  });
  it('honours holidays', () => {
    const cfg = { ...IST, holidays: ['2026-11-09'] };
    expect(iso(addBusinessMinutes(ist('2026-11-07T18:45'), 60, cfg))).toBe('2026-11-10T10:45');
  });
  it('runs 24/7 when no days are configured', () => {
    const cfg = { ...IST, days: [] };
    expect(iso(addBusinessMinutes(ist('2026-11-08T03:00'), 60, cfg))).toBe('2026-11-08T04:00');
  });
  it('handles DST zones', () => {
    const ny = { ...IST, tz: 'America/New_York', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' };
    // 2026-11-01 is the US fall-back day. 16:30 EST + 60 → next day 09:30 EST
    const start = new Date('2026-11-01T16:30-05:00');
    expect(addBusinessMinutes(start, 60, ny).toISOString()).toBe('2026-11-02T14:30:00.000Z');
  });
});

describe('businessMinutesBetween', () => {
  it('counts only working time', () => {
    expect(businessMinutesBetween(ist('2026-11-02T18:30'), ist('2026-11-03T10:30'), IST)).toBe(60);
    expect(businessMinutesBetween(ist('2026-11-07T18:00'), ist('2026-11-09T11:00'), IST)).toBe(120);
  });
});
