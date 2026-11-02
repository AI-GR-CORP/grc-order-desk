import sharp from 'sharp';
import { companyKey, similarity } from '@grc/core';
import type { Ctx } from '../context';
import type { Db, Sql } from '../db';
import { findOrCreateCompany } from '../pipeline/companies';
import { parseWorkbook, type SheetBulkOrder, type SheetDevRow } from './parse-workbook';
import { pictureRows, readSheetPictures, type SheetPicture } from './pictures';

/**
 * Brings GRC's spreadsheet into the dashboard row by row, with every picture on the row it sits
 * in. Rows already on the dashboard (from an earlier import, or found by the AI in the emails)
 * get the pictures; rows the emails haven't produced yet are added from the sheet.
 */

export type Target =
  | { kind: 'sheet_row'; itemId: string; label: string }
  | { kind: 'ai_row'; itemId: string; label: string; score: number }
  | { kind: 'new' };

export interface PlannedRow {
  row: SheetDevRow;
  target: Target;
  pictures: SheetPicture[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  bulk: SheetBulkOrder[];
  /** Pictures in tabs that aren't order rows (samples sent, complaints, …): reported, not imported. */
  elsewhere: SheetPicture[];
  pictureCount: number;
}

interface AiItem {
  id: string;
  company_name: string | null;
  brand: string | null;
  inquiry: string | null;
  product_code: string | null;
  merchant_name: string | null;
  team_status: string | null;
  sheet_ref: string | null;
}

const codeKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s\-_./]/g, '');
const describe = (x: { brand?: string | null; inquiry?: string | null; product_code?: string | null }) =>
  [x.brand, x.inquiry, x.product_code].filter(Boolean).join(' ');
/** An AI row is only linked to a sheet row when it's clearly the same product. */
const LINK_SCORE = 0.5;

export function rowLabel(r: { fields: SheetDevRow['fields'] } | AiItem): string {
  const f = 'fields' in r ? r.fields : r;
  return [f.brand, f.inquiry, f.product_code].filter(Boolean).join(' · ').slice(0, 120) || '(picture only)';
}

export async function planSheetImport(sql: Db, file: string): Promise<ImportPlan> {
  const pictures = await readSheetPictures(file);
  const { dev, bulk } = await parseWorkbook(file, { keepRows: pictureRows(pictures) });
  const byRef = new Map<string, SheetPicture[]>();
  for (const p of pictures) {
    if (!byRef.has(p.sheetRef)) byRef.set(p.sheetRef, []);
    byRef.get(p.sheetRef)!.push(p);
  }
  const devRefs = new Set(dev.map((r) => r.sheetRef));

  const existing = new Map(
    (await sql<{ id: string; sheet_ref: string; brand: string | null; inquiry: string | null; product_code: string | null }[]>`
      select id, sheet_ref, brand, inquiry, product_code from dev_item where sheet_ref is not null`).map((r) => [r.sheet_ref, r]),
  );
  const ai = await sql<AiItem[]>`
    select d.id, c.name as company_name, d.brand, d.inquiry, d.product_code, d.merchant_name, d.team_status, d.sheet_ref
    from dev_item d left join company c on c.id = d.company_id
    where d.source = 'ai' and d.sheet_ref is null`;
  const used = new Set<string>();

  const rows: PlannedRow[] = dev.map((row) => {
    const pics = byRef.get(row.sheetRef) ?? [];
    const have = existing.get(row.sheetRef);
    if (have) return { row, pictures: pics, target: { kind: 'sheet_row', itemId: have.id, label: rowLabel({ fields: have as never }) } };
    const ck = row.company ? companyKey(row.company) : null;
    let best: { item: AiItem; score: number } | null = null;
    for (const item of ai) {
      if (used.has(item.id) || !ck || !item.company_name) continue;
      const sameCompany = companyKey(item.company_name) === ck || similarity(item.company_name, row.company) >= 0.5;
      if (!sameCompany) continue;
      let score = similarity(describe(item), describe(row.fields));
      if (codeKey(item.product_code) && codeKey(item.product_code) === codeKey(row.fields.product_code ?? row.fields.inquiry)) score += 0.5;
      // Rows where the sheet only has a picture: the same merchant and a similar status note.
      if (!describe(row.fields)) {
        const sameMerchant = Boolean(item.merchant_name && row.fields.merchant_name) && companyKey(item.merchant_name!) === companyKey(row.fields.merchant_name!);
        score = (sameMerchant ? 0.3 : 0) + (item.team_status && row.fields.team_status ? similarity(item.team_status, row.fields.team_status) * 0.3 : 0);
      }
      if (!best || score > best.score) best = { item, score };
    }
    if (best && best.score >= LINK_SCORE) {
      used.add(best.item.id);
      return { row, pictures: pics, target: { kind: 'ai_row', itemId: best.item.id, label: rowLabel(best.item), score: best.score } };
    }
    return { row, pictures: pics, target: { kind: 'new' } };
  });

  return {
    rows,
    bulk,
    elsewhere: pictures.filter((p) => !devRefs.has(p.sheetRef)),
    pictureCount: pictures.length,
  };
}

async function webp(data: Buffer, size: number, quality: number): Promise<{ buf: Buffer; width: number; height: number }> {
  const { data: buf, info } = await sharp(data, { failOn: 'none' })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return { buf, width: info.width, height: info.height };
}

export interface ApplyResult {
  rowsAdded: number;
  rowsLinked: number;
  bulkAdded: number;
  picturesAdded: number;
  pictureErrors: string[];
}

/** Writes the plan: baseline, missing rows, links to AI rows, and every picture on its row. */
export async function applySheetImport(ctx: Ctx, plan: ImportPlan, onProgress?: (done: number, total: number) => void): Promise<ApplyResult> {
  const sql: Sql = ctx.sql;
  if (!ctx.storage) throw new Error('Picture storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  const res: ApplyResult = { rowsAdded: 0, rowsLinked: 0, bulkAdded: 0, picturesAdded: 0, pictureErrors: [] };

  // The sheet as a baseline (the AI learns GRC's note style from it).
  for (const { row: r } of plan.rows) {
    await sql`
      insert into sheet_baseline (sheet_ref, kind, tab, company_name, data)
      values (${r.sheetRef}, 'dev', ${r.tab}, ${r.company}, ${sql.json({ ...r.fields, stage: r.stage, region: r.region } as never)})
      on conflict (sheet_ref) do update set data = excluded.data, company_name = excluded.company_name, imported_at = now()`;
  }

  const companyIds = new Map<string, string>();
  const companyFor = async (name: string | null, region: string | null, city?: string | null) => {
    if (!name) return null;
    const key = companyKey(name);
    if (!companyIds.has(key)) {
      const { id } = await findOrCreateCompany(sql, { name, region, city: city ?? null }, { needsReview: false });
      companyIds.set(key, id);
    }
    return companyIds.get(key)!;
  };

  const total = plan.rows.reduce((n, p) => n + p.pictures.length, 0);
  let done = 0;
  const uploaded = new Map<string, { thumb: string; full: string; width: number; height: number }>();

  for (const p of plan.rows) {
    const r = p.row;
    let itemId: string | null = null;
    if (p.target.kind === 'sheet_row') itemId = p.target.itemId;
    else if (p.target.kind === 'ai_row') {
      const [hit] = await sql<{ id: string }[]>`update dev_item set sheet_ref = ${r.sheetRef} where id = ${p.target.itemId} and sheet_ref is null returning id`;
      itemId = hit?.id ?? p.target.itemId;
      res.rowsLinked++;
    } else {
      const f = r.fields;
      const companyId = await companyFor(r.company, r.region, f.city);
      const [created] = await sql<{ id: string }[]>`
        insert into dev_item (company_id, enquiry_date, merchant_name, brand, inquiry, product_code, colours,
                              sample_collected, grc_rate, awb, edd, brand_status, team_status, next_action,
                              owner_remark, stage, source, sheet_ref)
        values (${companyId}, ${f.enquiry_date ?? null}, ${f.merchant_name ?? null}, ${f.brand ?? null}, ${f.inquiry ?? null},
                ${f.product_code ?? null}, ${f.colours ?? null}, ${f.sample_collected ?? null}, ${f.grc_rate ?? null},
                ${f.awb ?? null}, ${f.edd ?? null}, ${f.brand_status ?? null}, ${f.team_status ?? null},
                ${f.next_action ?? null}, ${f.owner_remark ?? null}, ${r.stage}, 'sheet_import', ${r.sheetRef})
        on conflict (sheet_ref) do update set sheet_ref = excluded.sheet_ref
        returning id`;
      itemId = created!.id;
      res.rowsAdded++;
    }

    for (const pic of p.pictures) {
      try {
        let up = uploaded.get(pic.sha256);
        if (!up) {
          const full = await webp(pic.data, 1600, 80);
          const thumb = await webp(pic.data, 480, 72);
          const fullPath = `sheet/${pic.sha256}.webp`;
          const thumbPath = `sheet/${pic.sha256}-t.webp`;
          for (const [path, buf] of [[fullPath, full.buf], [thumbPath, thumb.buf]] as const) {
            const { error } = await ctx.storage.storage.from('thumbnails').upload(path, buf, { contentType: 'image/webp', upsert: true });
            if (error) throw new Error(error.message);
          }
          up = { thumb: thumbPath, full: fullPath, width: full.width, height: full.height };
          uploaded.set(pic.sha256, up);
        }
        const ins = await sql`
          insert into row_picture (dev_item_id, source, thumb_path, full_path, sheet_ref, sheet_cell, sha256, width, height, position)
          values (${itemId}, 'sheet', ${up.thumb}, ${up.full}, ${pic.sheetRef}, ${pic.cell}, ${pic.sha256}, ${up.width}, ${up.height}, ${pic.col})
          on conflict do nothing returning id`;
        res.picturesAdded += ins.length;
      } catch (e) {
        res.pictureErrors.push(`${pic.tab} ${pic.cell}: ${e instanceof Error ? e.message : String(e)}`);
      }
      onProgress?.(++done, total);
    }
  }

  for (const b of plan.bulk) {
    const companyId = await companyFor(b.company, null);
    const [order] = await sql<{ id: string }[]>`
      insert into bulk_order (company_id, product_code, description, source, sheet_ref)
      values (${companyId}, ${b.product_code}, ${b.label}, 'sheet_import', ${b.sheetRef})
      on conflict (sheet_ref) do nothing returning id`;
    if (!order) continue;
    res.bulkAdded++;
    for (const [key, s] of Object.entries(b.stages)) {
      await sql`
        insert into bulk_order_stage (bulk_order_id, stage_key, value, done_on, source)
        values (${order.id}, ${key}, ${s.value}, ${s.date}, 'sheet_import')
        on conflict do nothing`;
    }
  }
  return res;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A page to check the alignment before anything is written: every sheet row, its pictures, and where it goes. */
export async function planReportHtml(plan: ImportPlan): Promise<string> {
  const thumbs = new Map<string, string>();
  const img = async (p: SheetPicture) => {
    if (!thumbs.has(p.sha256)) {
      try {
        const { buf } = await webp(p.data, 220, 60);
        thumbs.set(p.sha256, `data:image/webp;base64,${buf.toString('base64')}`);
      } catch {
        thumbs.set(p.sha256, '');
      }
    }
    const src = thumbs.get(p.sha256);
    return src ? `<figure><img src="${src}" alt=""><figcaption>${esc(p.cell)}</figcaption></figure>` : `<figure class="bad">${esc(p.cell)}: can't read</figure>`;
  };
  const target = (t: Target) =>
    t.kind === 'sheet_row' ? `<span class="t ok">Already on the dashboard</span>`
    : t.kind === 'ai_row' ? `<span class="t ai">Matches the AI's row: ${esc(t.label)}</span>`
    : `<span class="t new">Will be added from the sheet</span>`;

  const withPics = plan.rows.filter((r) => r.pictures.length);
  const rowsHtml: string[] = [];
  for (const p of withPics) {
    const f = p.row.fields;
    rowsHtml.push(`<tr>
      <td class="ref">${esc(p.row.sheetRef)}</td>
      <td><b>${esc(p.row.company)}</b><br><span class="m">${esc(f.city)}</span></td>
      <td>${esc(f.brand)}</td>
      <td>${esc(f.inquiry ?? f.product_code ?? (f.brand ? '' : '(picture only)'))}<br><span class="m">${esc(f.team_status)}</span></td>
      <td class="pics">${(await Promise.all(p.pictures.map(img))).join('')}</td>
      <td>${target(p.target)}</td></tr>`);
  }
  const elsewhere = (await Promise.all(plan.elsewhere.map(async (p) => `<div class="el"><div class="m">${esc(p.tab)} ${esc(p.cell)}</div>${await img(p)}</div>`))).join('');
  const counts = {
    rows: plan.rows.length,
    withPics: withPics.length,
    pics: withPics.reduce((n, p) => n + new Set(p.pictures.map((x) => x.sha256)).size, 0),
    add: plan.rows.filter((r) => r.target.kind === 'new').length,
    ai: plan.rows.filter((r) => r.target.kind === 'ai_row').length,
    have: plan.rows.filter((r) => r.target.kind === 'sheet_row').length,
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sheet pictures: check before importing</title>
<style>
:root{--ink:#1e293b;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--head:#e6effb;--ok:#0f766e;--ai:#1e40af;--new:#a16207}
@media (prefers-color-scheme:dark){:root{--ink:#e2e8f0;--muted:#94a3b8;--line:#334155;--bg:#0f172a;--card:#111827;--head:#1e293b;--ok:#5eead4;--ai:#93c5fd;--new:#fcd34d}}
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:24px}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 14px;color:var(--muted)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:900px}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--head);font-size:13px;position:sticky;top:0}.ref{white-space:nowrap;color:var(--muted);font-size:12.5px}.m{color:var(--muted);font-size:12.5px}
.pics{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;text-align:center}figure img{max-width:150px;max-height:110px;border:1px solid var(--line);border-radius:6px;background:#fff}
figcaption{font-size:11px;color:var(--muted)}.bad{color:#b91c1c;font-size:12px}
.t{font-size:12.5px;font-weight:600}.ok{color:var(--ok)}.ai{color:var(--ai)}.new{color:var(--new)}
.els{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}.el{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}
</style></head><body>
<h1>Your sheet's pictures, row by row</h1>
<p>${counts.pics} pictures on ${counts.withPics} product rows (of ${counts.rows} rows in the order tabs). ${counts.have} rows are already on the dashboard, ${counts.ai} match a row the AI found in the emails, ${counts.add} will be added from the sheet. Nothing has been changed yet.</p>
<div class="wrap"><table><thead><tr><th>Sheet row</th><th>Company</th><th>Brand</th><th>Inquiry / status</th><th>Pictures (cell)</th><th>On the dashboard</th></tr></thead><tbody>
${rowsHtml.join('\n')}
</tbody></table></div>
<h1 style="margin-top:28px">Not imported (${plan.elsewhere.length})</h1>
<p>These tabs aren't order rows (samples sent, sample reports, complaints), so their pictures stay in the sheet.</p>
<div class="els">${elsewhere}</div>
</body></html>`;
}
