/**
 * Imports GRC's existing workbook.
 *
 *   pnpm --filter @grc/worker import-sheet ./customer_portfolio.xlsx --dry-run
 *   pnpm --filter @grc/worker import-sheet ./customer_portfolio.xlsx            # baseline only (for `eval`)
 *   pnpm --filter @grc/worker import-sheet ./customer_portfolio.xlsx --items    # also create dashboard rows
 *   pnpm --filter @grc/worker import-sheet ./customer_portfolio.xlsx --items --only-unmatched
 *
 * For a clean accuracy check: import the baseline, run the Gmail import + extraction, run `eval`,
 * then import --items --only-unmatched so the dashboard also has the rows the emails didn't cover.
 */
import { companyKey } from '@grc/core';
import { createDb } from '../db';
import { findOrCreateCompany } from '../pipeline/companies';
import { parseWorkbook } from '../sheet/parse-workbook';
import { matchSheetRows } from '../sheet/match';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: import-sheet <file.xlsx> [--dry-run] [--items] [--only-unmatched]');
    process.exit(1);
  }
  const dry = args.includes('--dry-run');
  const items = args.includes('--items');
  const onlyUnmatched = args.includes('--only-unmatched');

  const { dev, bulk, skippedTabs } = await parseWorkbook(file);
  const byTab = new Map<string, number>();
  for (const r of dev) byTab.set(r.tab, (byTab.get(r.tab) ?? 0) + 1);
  console.log(`Development rows: ${dev.length}`, Object.fromEntries(byTab));
  console.log(`Bulk orders: ${bulk.length}`);
  console.log(`Tabs not imported: ${skippedTabs.join(', ')}`);
  if (dry) {
    console.log(JSON.stringify({ sampleDev: dev.slice(0, 6), sampleBulk: bulk.slice(0, 3) }, null, 2));
    return;
  }

  const sql = createDb();
  try {
    for (const r of dev) {
      await sql`
        insert into sheet_baseline (sheet_ref, kind, tab, company_name, data)
        values (${r.sheetRef}, 'dev', ${r.tab}, ${r.company}, ${sql.json({ ...r.fields, stage: r.stage, region: r.region } as never)})
        on conflict (sheet_ref) do update set data = excluded.data, company_name = excluded.company_name, imported_at = now()`;
    }
    for (const b of bulk) {
      await sql`
        insert into sheet_baseline (sheet_ref, kind, tab, company_name, data)
        values (${b.sheetRef}, 'bulk', ${b.tab}, ${b.company}, ${sql.json({ label: b.label, product_code: b.product_code, stages: b.stages } as never)})
        on conflict (sheet_ref) do update set data = excluded.data, company_name = excluded.company_name, imported_at = now()`;
    }
    console.log('Baseline saved.');
    if (!items) return;

    const skip = onlyUnmatched ? new Set((await matchSheetRows(sql)).matched.map((m) => m.sheetRef)) : new Set<string>();
    const companyIds = new Map<string, string>();
    const companyFor = async (name: string | null, region: string | null, city?: string) => {
      if (!name) return null;
      const key = companyKey(name);
      if (!companyIds.has(key)) {
        const { id } = await findOrCreateCompany(sql, { name, region, city: city ?? null }, { needsReview: false });
        companyIds.set(key, id);
      }
      return companyIds.get(key)!;
    };

    let created = 0;
    for (const r of dev) {
      if (skip.has(r.sheetRef)) continue;
      const f = r.fields;
      const companyId = await companyFor(r.company, r.region, f.city);
      const res = await sql`
        insert into dev_item (company_id, enquiry_date, merchant_name, brand, inquiry, product_code, colours,
                              sample_collected, grc_rate, awb, edd, brand_status, team_status, next_action,
                              owner_remark, stage, source, sheet_ref)
        values (${companyId}, ${f.enquiry_date ?? null}, ${f.merchant_name ?? null}, ${f.brand ?? null}, ${f.inquiry ?? null},
                ${f.product_code ?? null}, ${f.colours ?? null}, ${f.sample_collected ?? null}, ${f.grc_rate ?? null},
                ${f.awb ?? null}, ${f.edd ?? null}, ${f.brand_status ?? null}, ${f.team_status ?? null},
                ${f.next_action ?? null}, ${f.owner_remark ?? null}, ${r.stage}, 'sheet_import', ${r.sheetRef})
        on conflict (sheet_ref) do nothing returning id`;
      created += res.length;
    }
    for (const b of bulk) {
      const companyId = await companyFor(b.company, null);
      const [order] = await sql<{ id: string }[]>`
        insert into bulk_order (company_id, product_code, description, source, sheet_ref)
        values (${companyId}, ${b.product_code}, ${b.label}, 'sheet_import', ${b.sheetRef})
        on conflict (sheet_ref) do nothing returning id`;
      if (!order) continue;
      for (const [key, s] of Object.entries(b.stages)) {
        await sql`
          insert into bulk_order_stage (bulk_order_id, stage_key, value, done_on, source)
          values (${order.id}, ${key}, ${s.value}, ${s.date}, 'sheet_import')
          on conflict do nothing`;
      }
      created++;
    }
    console.log(`Created ${created} dashboard rows.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
