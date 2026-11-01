import type { BusinessHours } from './settings';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  ss: number;
  weekday: number; // 0 = Sunday
}

export function localParts(date: Date, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const y = p.year!, m = p.month!, d = p.day!;
  return { y, m, d, hh: p.hour!, mm: p.minute!, ss: p.second!, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** Offset of `tz` from UTC at `date`, in minutes (IST = +330). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  const whole = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

/** The UTC instant of a wall-clock time in `tz`. Handles DST by re-checking the offset. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let result = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(result), tz);
  if (off2 !== off1) result = guess - off2 * 60000;
  return new Date(result);
}

function hm(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isWorkingDay(p: { y: number; m: number; d: number; weekday: number }, cfg: BusinessHours): boolean {
  return cfg.days.includes(p.weekday) && !cfg.holidays.includes(ymd(p.y, p.m, p.d));
}

/**
 * Adds `minutes` of business time to `start`.
 * Example (IST, Mon–Sat 10:00–19:00): Mon 18:30 + 60 → Tue 10:30. Sat 18:45 + 60 → Mon 10:45.
 */
export function addBusinessMinutes(start: Date, minutes: number, cfg: BusinessHours): Date {
  if (cfg.days.length === 0) return new Date(start.getTime() + minutes * 60000);
  const [sh, sm] = hm(cfg.start);
  const [eh, em] = hm(cfg.end);
  if (eh * 60 + em <= sh * 60 + sm) return new Date(start.getTime() + minutes * 60000);

  let t = start.getTime();
  let remaining = minutes;
  for (let guard = 0; guard < 800; guard++) {
    const p = localParts(new Date(t), cfg.tz);
    const dayStart = zonedTimeToUtc(p.y, p.m, p.d, sh, sm, cfg.tz).getTime();
    const dayEnd = zonedTimeToUtc(p.y, p.m, p.d, eh, em, cfg.tz).getTime();
    if (!isWorkingDay(p, cfg) || t >= dayEnd) {
      const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
      t = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), sh, sm, cfg.tz).getTime();
      continue;
    }
    if (t < dayStart) t = dayStart;
    const available = (dayEnd - t) / 60000;
    if (remaining <= available) return new Date(t + remaining * 60000);
    remaining -= available;
    t = dayEnd;
  }
  // Misconfigured calendar (e.g. every day a holiday): fall back to wall-clock time.
  return new Date(start.getTime() + minutes * 60000);
}

/** Business minutes elapsed between two instants (used for "waiting 2h 10m" labels). */
export function businessMinutesBetween(from: Date, to: Date, cfg: BusinessHours): number {
  if (to <= from) return 0;
  if (cfg.days.length === 0) return Math.floor((to.getTime() - from.getTime()) / 60000);
  const [sh, sm] = hm(cfg.start);
  const [eh, em] = hm(cfg.end);
  let total = 0;
  let t = from.getTime();
  const endT = to.getTime();
  for (let guard = 0; guard < 800 && t < endT; guard++) {
    const p = localParts(new Date(t), cfg.tz);
    const dayStart = zonedTimeToUtc(p.y, p.m, p.d, sh, sm, cfg.tz).getTime();
    const dayEnd = zonedTimeToUtc(p.y, p.m, p.d, eh, em, cfg.tz).getTime();
    if (isWorkingDay(p, cfg) && t < dayEnd) {
      const s = Math.max(t, dayStart);
      const e = Math.min(endT, dayEnd);
      if (e > s) total += e - s;
    }
    const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    t = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, cfg.tz).getTime();
  }
  return Math.floor(total / 60000);
}
