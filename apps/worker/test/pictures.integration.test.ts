/**
 * Pictures on rows: GRC's sheet (exact cells), email attachments (per product), type switches.
 * Runs only when TEST_DATABASE_URL is set.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ThreadExtraction } from '@grc/core/ai';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
process.env.DATABASE_URL = url ?? 'postgres://unused';
process.env.DATABASE_SSL = 'disable';

const png = (r: number, g: number, b: number) => sharp({ create: { width: 40, height: 30, channels: 3, background: { r, g, b } } }).png().toBuffer();

/** A small copy of GRC's layout: company merged down its product rows, pictures in cells. */
async function makeSheet(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('NEW INQUIRY');
  ws.addRow(['COMPANY NAME', 'City', 'merchant', 'brand', 'Inquiry', 'sample collected', 'picture', 'Status of Poornima']);
  ws.addRow(['ARVIND FASHION', 'Bangalore', 'SHAKUNTLA', 'UCLA', 'DAISY', 'YES', null, 'sample ready on 26 oct']); // row 2
  ws.addRow([null, null, null, null, 'KAIA', null, null, null]); // row 3
  ws.addRow([null, null, null, null, null, null, null, null]); // row 4: picture only
  ws.mergeCells('A2:A4');
  ws.addRow(['Kabeir Bahadur Director, KaRo Enterprise ApS CVR 45584631, Copenhagen, Denmark M: +45 51282222']); // row 5: a pasted signature
  const pic = async (sheet: ExcelJS.Worksheet, col: number, row: number, rgb: [number, number, number]) => {
    const id = wb.addImage({ buffer: (await png(...rgb)) as never, extension: 'png' });
    sheet.addImage(id, { tl: { col: col - 1, row: row - 1 }, ext: { width: 40, height: 30 } });
  };
  await pic(ws, 7, 2, [220, 30, 30]); // G2: DAISY
  await pic(ws, 5, 2, [220, 30, 30]); // E2: the same picture again in the same row
  await pic(ws, 7, 3, [30, 160, 60]); // G3: KAIA
  await pic(ws, 5, 4, [40, 70, 200]); // E4: picture-only row
  await pic(ws, 2, 5, [240, 200, 20]); // B5: signature row
  const other = wb.addWorksheet('samples sent ');
  other.addRow(['date', 'courier']);
  await pic(other, 2, 2, [120, 120, 120]);
  const file = join(mkdtempSync(join(tmpdir(), 'grc-')), 'portfolio.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

d('pictures (integration)', () => {
  let sql: import('../src/db').Sql;
  let file: string;
  const uploads: string[] = [];
  const storage = { storage: { from: () => ({ upload: async (p: string) => (uploads.push(p), { error: null }) }) } };
  let mods: {
    pics: typeof import('../src/sheet/import-pictures');
    apply: typeof import('../src/pipeline/apply');
    log: typeof import('../src/log');
  };
  let arvind: string;
  let daisyAi: string;

  beforeAll(async () => {
    const db = await import('../src/db');
    mods = { pics: await import('../src/sheet/import-pictures'), apply: await import('../src/pipeline/apply'), log: await import('../src/log') };
    sql = db.createDb();
    await sql`truncate mailbox, company, contact, team_member, job, ai_run, knowledge_profile, correction, sheet_baseline cascade`;
    const [co] = await sql<{ id: string }[]>`insert into company (name, name_key, approval) values ('Arvind Fashion', 'arvind fashion', 'approved') returning id`;
    arvind = co!.id;
    const [it] = await sql<{ id: string }[]>`
      insert into dev_item (company_id, brand, inquiry, product_code, source) values (${arvind}, 'UCLA', 'UCLA 25MM jacquard elastic DAISY', 'DAISY', 'ai') returning id`;
    daisyAi = it!.id;
    file = await makeSheet();
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('plans every picture onto its exact row; picture-only rows kept, signature rows and other tabs left out', async () => {
    const plan = await mods.pics.planSheetImport(sql, file);
    const rows = Object.fromEntries(plan.rows.map((r) => [r.row.sheetRef, r]));
    expect(Object.keys(rows).sort()).toEqual(['NEW INQUIRY!2', 'NEW INQUIRY!3', 'NEW INQUIRY!4']);
    expect(rows['NEW INQUIRY!2']!.pictures.map((p) => p.cell)).toEqual(['E2', 'G2']);
    expect(rows['NEW INQUIRY!2']!.target).toMatchObject({ kind: 'ai_row', itemId: daisyAi });
    expect(rows['NEW INQUIRY!3']!.row.company).toBe('ARVIND FASHION'); // merged company cell
    expect(rows['NEW INQUIRY!3']!.target.kind).toBe('new');
    expect(rows['NEW INQUIRY!4']!.pictures.map((p) => p.cell)).toEqual(['E4']);
    expect(plan.elsewhere.map((p) => `${p.tab}!${p.cell}`).sort()).toEqual(['NEW INQUIRY!B5', 'samples sent!B2']);

    const html = await mods.pics.planReportHtml(plan);
    expect(html).toContain("Matches the AI's row");
    expect(html).toContain('NEW INQUIRY!4');
  });

  it('applies: pictures on the right rows, the AI row linked, nothing duplicated on a second run', async () => {
    const ctx = { sql, log: mods.log.log, storage } as never;
    const first = await mods.pics.applySheetImport(ctx, await mods.pics.planSheetImport(sql, file));
    expect(first).toMatchObject({ rowsAdded: 2, rowsLinked: 1, picturesAdded: 3, pictureErrors: [] });

    const placed = await sql<{ sheet_ref: string; source: string; cells: string[] }[]>`
      select d.sheet_ref, d.source, array_agg(p.sheet_cell order by p.position) as cells
      from row_picture p join dev_item d on d.id = p.dev_item_id group by d.sheet_ref, d.source order by d.sheet_ref`;
    expect(placed).toEqual([
      { sheet_ref: 'NEW INQUIRY!2', source: 'ai', cells: ['E2'] }, // the same picture twice in one row is kept once
      { sheet_ref: 'NEW INQUIRY!3', source: 'sheet_import', cells: ['G3'] },
      { sheet_ref: 'NEW INQUIRY!4', source: 'sheet_import', cells: ['E4'] },
    ]);
    expect(uploads.filter((u) => u.endsWith('-t.webp'))).toHaveLength(3);
    const [signature] = await sql`select count(*)::int as n from company where name ilike 'Kabeir%'`;
    expect(signature!.n).toBe(0);

    const again = await mods.pics.applySheetImport(ctx, await mods.pics.planSheetImport(sql, file));
    expect(again).toMatchObject({ rowsAdded: 0, rowsLinked: 0, picturesAdded: 0 });
  });

  it('email pictures go on the product the AI names, never on a guess', async () => {
    const [mb] = await sql<{ id: string }[]>`insert into mailbox (email, status) values ('yash@grcorporation.co.in', 'active') returning id`;
    const [t] = await sql<{ id: string }[]>`
      insert into email_thread (mailbox_id, gmail_thread_id, subject, company_id, category, classified_at)
      values (${mb!.id}, 'g-ucla', 'UCLA artwork', ${arvind}, 'development', now()) returning id`;
    const msg = async (id: string, files: string[]) => {
      const [m] = await sql<{ id: string }[]>`
        insert into email_message (thread_id, gmail_message_id, direction, from_email, sent_at) values (${t!.id}, ${id}, 'inbound', 'ravi@arvind.in', now()) returning id`;
      for (const [i, f] of files.entries()) {
        await sql`insert into attachment (message_id, part_id, gmail_attachment_id, filename, mime_type, size_bytes, kind)
                  values (${m!.id}, ${String(i)}, ${'att-' + id + i}, ${f}, 'image/jpeg', 40000, 'image')`;
      }
    };
    await msg('m1', ['DAISY.jpg', 'image001.png']);
    await msg('m2', ['image001.png']); // Outlook names every pasted picture image001.png
    const x: ThreadExtraction = {
      thread_category: 'development',
      company: { name: 'Arvind Fashion', city: null, country: null },
      primary_contact: { name: null, email: null },
      summary: 'UCLA artwork',
      next_action: null,
      waiting_on: 'us',
      latest_customer_email_needs_reply: false,
      handled_by_email: null,
      dev_items: [{ existing_item_id: daisyAi, picture_files: ['DAISY.jpg', 'image001.png'], brand: 'UCLA', inquiry: 'UCLA 25MM jacquard elastic DAISY', product_code: 'DAISY', colours: null, merchant_name: null, enquiry_date: null, sample_collected: null, grc_rate: null, sample_dispatch_date: null, courier: null, awb: null, edd: null, brand_status: null, team_status: null, next_action: null, stage: 'under_development', summary: 'DAISY', confidence: 0.9 }],
      bulk_orders: [],
      confidence: 0.9,
    };
    await mods.apply.applyExtraction(sql, t!.id, x, { extractedThrough: new Date(), devIds: new Set([daisyAi]), bulkIds: new Set(), stageKeys: new Set() });
    const linked = await sql`select a.filename from row_picture p join attachment a on a.id = p.attachment_id where p.dev_item_id = ${daisyAi}`;
    expect(linked.map((r) => r.filename)).toEqual(['DAISY.jpg']);

    // A person removed it: re-reading the emails doesn't bring it back.
    await sql`update row_picture set hidden = true where dev_item_id = ${daisyAi} and source = 'email'`;
    await mods.apply.applyExtraction(sql, t!.id, x, { extractedThrough: new Date(), devIds: new Set([daisyAi]), bulkIds: new Set(), stageKeys: new Set() });
    const [h] = await sql`select count(*)::int as n, bool_and(hidden) as hidden from row_picture where dev_item_id = ${daisyAi} and source = 'email'`;
    expect(h).toEqual({ n: 1, hidden: true });

    // Switching the conversation to bulk keeps the row and moves its pictures with it.
    await sql`update dev_item set primary_thread_id = ${t!.id} where id = ${daisyAi}`;
    await sql`select retype_thread_items(${t!.id}::uuid, 'bulk')`;
    const [moved] = await sql`
      select count(*)::int as n from row_picture p join bulk_order b on b.id = p.bulk_order_id where b.primary_thread_id = ${t!.id}`;
    expect(moved!.n).toBe(2);
    const [gone] = await sql`select count(*)::int as n from dev_item where id = ${daisyAi}`;
    expect(gone!.n).toBe(0);
  });
});
