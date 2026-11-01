const COMPANY_SUFFIXES = /\b(?:pvt|private|ltd|limited|llp|llc|inc|co|company|corp|corporation|plc|gmbh|sa|spa|bv|aps|pte|the|and|&)\b/g;

/** Key used to match company names: "Arvind Fashion Pvt. Ltd." and "ARVIND FASHION" → "arvind fashion". */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s]/gu, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.replace(/\s+/g, ' ').trim();
  return n.length ? n : null;
}

/** Accepts YYYY-MM-DD or anything Date can parse; returns YYYY-MM-DD or null. */
export function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v + 'T00:00:00Z');
    return Number.isNaN(d.getTime()) ? null : v;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function clamp01(n: number | null | undefined): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(1, n));
}

export function truncate(s: string | null | undefined, max: number): string | null {
  if (s === null || s === undefined) return null;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

/** Jaccard similarity of word sets, 0–1. Used by the evaluation script and duplicate detection. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
