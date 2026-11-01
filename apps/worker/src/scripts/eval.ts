/**
 * Scores the AI against GRC's own spreadsheet.
 *   pnpm --filter @grc/worker eval            # prints a report, writes eval-report.json
 */
import { writeFile } from 'node:fs/promises';
import { similarity } from '@grc/core';
import { createDb } from '../db';
import { matchSheetRows } from '../sheet/match';

const codeKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s\-_./]/g, '');

const CHECKS: Record<string, (sheet: string | null | undefined, ai: string | null | undefined) => boolean | null> = {
  brand: (s, a) => (s ? similarity(s, a) >= 0.5 : null),
  inquiry: (s, a) => (s ? similarity(s, a) >= 0.3 : null),
  product_code: (s, a) => (s ? codeKey(s) === codeKey(a) || codeKey(a ?? '').includes(codeKey(s)) : null),
  colours: (s, a) => (s ? similarity(s, a) >= 0.3 : null),
  sample_collected: (s, a) => (s && ['yes', 'no', 'awaited'].includes(s) ? s === a : null),
  stage: (s, a) => (s ? s === a : null),
};

async function main() {
  const sql = createDb();
  try {
    const { matched, unmatched, aiOnly } = await matchSheetRows(sql);
    const total = matched.length + unmatched.length;
    const fields: Record<string, { agree: number; compared: number }> = {};
    for (const m of matched) {
      for (const [field, check] of Object.entries(CHECKS)) {
        const ok = check(m.sheet[field] ?? null, (m.ai as unknown as Record<string, string | null>)[field]);
        if (ok === null) continue;
        fields[field] ??= { agree: 0, compared: 0 };
        fields[field].compared++;
        if (ok) fields[field].agree++;
      }
    }
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    console.log(`\nSheet rows: ${total}   found by AI: ${matched.length} (${pct(matched.length, total)})   AI items not in sheet: ${aiOnly.length}\n`);
    console.log('Field agreement on matched rows:');
    for (const [f, v] of Object.entries(fields)) console.log(`  ${f.padEnd(18)} ${pct(v.agree, v.compared).padStart(5)}  (${v.compared} compared)`);
    console.log('\nSheet rows the AI did not find (first 20):');
    for (const u of unmatched.slice(0, 20)) console.log(`  ${u.sheet_ref.padEnd(26)} ${u.company_name ?? '-'} — ${[u.data.brand, u.data.inquiry].filter(Boolean).join(' / ')}`);
    await writeFile('eval-report.json', JSON.stringify({ total, matched: matched.length, aiOnly: aiOnly.length, fields, unmatched }, null, 2));
    console.log('\nFull report: eval-report.json');
    console.log('Note: sheet rows with no email in the imported window cannot be found — widen the backfill if coverage is low.');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
