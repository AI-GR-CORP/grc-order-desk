/**
 * Brings GRC's spreadsheet into the dashboard with every picture on its row.
 *
 *   tsx --env-file=.env src/scripts/import-pictures.ts <sheet.xlsx> <report.html>            # check only
 *   tsx --env-file=.env src/scripts/import-pictures.ts <sheet.xlsx> <report.html> --apply    # write it
 *
 * Normally run through `pnpm ops pictures`.
 */
import { writeFileSync } from 'node:fs';
import { createCtx } from '../context';
import { createDb } from '../db';
import { applySheetImport, planReportHtml, planSheetImport } from '../sheet/import-pictures';

async function main() {
  const args = process.argv.slice(2);
  const [file, report] = args.filter((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  if (!file || !report) {
    console.error('Usage: import-pictures <sheet.xlsx> <report.html> [--apply]');
    process.exit(1);
  }
  const sql = createDb();
  try {
    const plan = await planSheetImport(sql, file);
    const withPics = plan.rows.filter((r) => r.pictures.length);
    const n = (k: string) => plan.rows.filter((r) => r.target.kind === k).length;
    const placed = withPics.reduce((s, r) => s + new Set(r.pictures.map((p) => p.sha256)).size, 0);
    console.log(`  Sheet: ${plan.pictureCount} pictures; ${placed} go on ${withPics.length} product rows (of ${plan.rows.length} rows in the order tabs; a picture repeated in the same row counts once).`);
    console.log(`  Dashboard: ${n('sheet_row')} rows already there, ${n('ai_row')} match a row the AI found in the emails, ${n('new')} will be added from the sheet.`);
    console.log(`  ${plan.elsewhere.length} pictures are in tabs that aren't order rows (samples sent, sample reports, complaints): left in the sheet.`);
    writeFileSync(report, await planReportHtml(plan));
    console.log(`  Check page: ${report}`);
    if (!apply) return;

    const ctx = createCtx(sql);
    let last = 0;
    const r = await applySheetImport(ctx, plan, (done, total) => {
      if (done - last >= 20 || done === total) {
        last = done;
        console.log(`  … ${done} of ${total} pictures`);
      }
    });
    console.log(`  Done: ${r.rowsAdded} rows added, ${r.rowsLinked} linked to the AI's rows, ${r.bulkAdded} bulk orders added, ${r.picturesAdded} pictures placed.`);
    for (const e of r.pictureErrors.slice(0, 10)) console.log(`  ! ${e}`);

    // Email pictures for every order conversation (no AI cost).
    const mbs = await sql<{ id: string }[]>`select id from mailbox where status = 'active'`;
    for (const mb of mbs) {
      await sql`
        insert into job (kind, mailbox_id, payload, dedupe_key, priority)
        values ('picture_backfill', ${mb.id}, '{}', ${'picture_backfill:' + mb.id}, 4)
        on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing`;
    }
    if (mbs.length) console.log('  Email pictures for every order conversation are queued (the worker does this; no AI cost).');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
