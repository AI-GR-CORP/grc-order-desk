import ExcelJS from 'exceljs';
import { DEFAULT_BULK_STAGES, type DevStage } from '@grc/core';

/**
 * Reads GRC's customer-portfolio workbook. Every development tab uses slightly different
 * headers for the same columns, so headers are matched by alias, and the company name is
 * carried down to the item rows below it (that's how the sheet is laid out).
 */

export type DevField =
  | 'company'
  | 'city'
  | 'merchant_name'
  | 'brand'
  | 'inquiry'
  | 'product_code'
  | 'colours'
  | 'sample_collected'
  | 'team_status'
  | 'brand_status'
  | 'owner_remark'
  | 'next_action'
  | 'grc_rate'
  | 'enquiry_date'
  | 'awb'
  | 'edd';

export interface SheetDevRow {
  sheetRef: string;
  tab: string;
  company: string | null;
  region: string | null;
  fields: Partial<Record<DevField, string>>;
  stage: DevStage;
}

export interface SheetBulkOrder {
  sheetRef: string;
  tab: string;
  label: string;
  company: string | null;
  product_code: string | null;
  stages: Record<string, { value: string; date: string | null }>;
}

const ALIASES: [DevField, string[]][] = [
  ['company', ['company name', 'company', 'customer name', 'customer']],
  ['city', ['city']],
  ['merchant_name', ['merchant', 'team']],
  ['brand', ['brand']],
  ['inquiry', ['product', 'inquiry', 'sample description']],
  ['product_code', ['product code', 'style no', 'style']],
  ['colours', ['colours', 'colors', 'colour']],
  ['sample_collected', ['sample collected', 'sample received']],
  ['brand_status', ['status of brand', 'colour approval status', 'quality approval status']],
  ['owner_remark', ['yash remark', 'yash sir remarks', 'yash sir']],
  ['next_action', ['work to be done', 'aquib to do']],
  ['grc_rate', ['grc rates', 'grc rate']],
  ['enquiry_date', ['enquiry date', 'date']],
  ['awb', ['awb']],
  ['edd', ['sample edd']],
  ['team_status', ['status of poornima', 'poonima remark', 'poornima remark', 'aquib status', 'remark']],
];
/** Fields that may combine several columns ("Product" + "Inquiry"). */
const MULTI: ReadonlySet<DevField> = new Set(['inquiry', 'brand_status']);
const DATE_FIELDS: ReadonlySet<DevField> = new Set(['enquiry_date', 'edd']);
const NOTE_FIELDS: ReadonlySet<DevField> = new Set(['team_status', 'brand_status', 'owner_remark', 'next_action']);

interface TabConfig {
  region: string | null;
  defaultCompany?: string;
}

const DEV_TABS: Record<string, TabConfig> = {
  'kaushlya inquiry': { region: null, defaultCompany: 'Kaushlya' },
  'non moving': { region: null },
  'new inquiry': { region: null },
  tirupur: { region: 'Tirupur' },
  export: { region: 'Export' },
  'vanhusen inquiries': { region: 'Domestic' },
  'srilanka local': { region: 'Export - Sri Lanka' },
  southafrica: { region: 'Export - South Africa' },
};
const BULK_TABS = new Set(['tripti - bulk orders']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function serialToIso(n: number): string {
  return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText((v as { result: ExcelJS.CellValue }).result);
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return '';
    return '';
  }
  return String(v);
}

function toIsoDate(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 30000 && v < 60000) return serialToIso(v);
  const s = cellText(v).trim();
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // Indian day-month-year
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (/^\d+(\.0+)?$/.test(s) && Number(s) > 30000 && Number(s) < 60000) return serialToIso(Number(s));
  return null;
}

function noteText(v: ExcelJS.CellValue): string {
  if (typeof v === 'number' && v > 40000 && v < 60000) return serialToIso(v);
  return cellText(v);
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Placeholders people type into empty cells. */
const EMPTY_MARKERS: ReadonlySet<string> = new Set(['-', '–', '—', '0', 'na', 'n/a', 'NA', 'N/A']);

export function deriveStage(text: string): DevStage {
  const t = text.toLowerCase();
  if (/confirmed order|order rec[ei]+ved|bulk pi|order generated/.test(t)) return 'converted_to_bulk';
  if (/reject|fail/.test(t)) return 'rejected_redevelop';
  if (/approved/.test(t)) return 'approved';
  if (/\bhold\b/.test(t)) return 'on_hold';
  if (/inquiry closed|\bclosed\b/.test(t)) return 'closed';
  if (/dispatch|disaptch|disapatch|dispach|despatch|courier|\bawb\b|re-?send|samples? sent|sent to brand/.test(t)) return 'sample_dispatched';
  if (/sample ready/.test(t)) return 'sample_ready';
  if (/price/.test(t)) return 'prices_shared';
  if (/under (lab )?test|under process|on process|yarn development|re ?develop|development/.test(t)) return 'under_development';
  if (/reference|refence|refrence|referance|artwork|swatch|awaited/.test(t)) return 'awaiting_reference';
  return 'inquiry_received';
}

function headerMap(row: ExcelJS.Row): Map<number, DevField> | null {
  const map = new Map<number, DevField>();
  const used = new Set<DevField>();
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = norm(cellText(cell.value));
    if (!h) return;
    for (const [field, aliases] of ALIASES) {
      if (!aliases.includes(h)) continue;
      if (used.has(field) && !MULTI.has(field)) continue;
      // A repeated header block (the NON moving tab has two) maps to the first block only.
      if (used.has(field) && MULTI.has(field) && [...map.values()].filter((f) => f === field).length >= 2) continue;
      map.set(col, field);
      used.add(field);
      break;
    }
  });
  return map.size >= 2 ? map : null;
}

function parseDevSheet(ws: ExcelJS.Worksheet, tab: string, cfg: TabConfig, keepRows?: ReadonlySet<number>): SheetDevRow[] {
  const out: SheetDevRow[] = [];
  let headers: Map<number, DevField> | null = null;
  let headerRow = 0;
  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    headers = headerMap(ws.getRow(r));
    if (headers) {
      headerRow = r;
      break;
    }
  }
  if (!headers) return out;

  let company: string | null = cfg.defaultCompany ?? null;
  let city: string | null = null;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const fields: Partial<Record<DevField, string>> = {};
    for (const [col, field] of headers) {
      const v = row.getCell(col).value;
      let text: string;
      if (DATE_FIELDS.has(field)) text = toIsoDate(v) ?? '';
      else if (NOTE_FIELDS.has(field)) text = clean(noteText(v));
      else text = clean(cellText(v));
      if (!text || EMPTY_MARKERS.has(text)) continue;
      if (MULTI.has(field) && fields[field]) fields[field] = `${fields[field]} · ${text}`;
      else fields[field] = text;
    }
    if (fields.company) {
      company = fields.company;
      city = fields.city ?? null;
    }
    const meaningful = (['inquiry', 'brand', 'product_code', 'team_status', 'brand_status', 'owner_remark', 'next_action', 'sample_collected', 'grc_rate', 'awb'] as const)
      .some((f) => fields[f]);
    // A row whose only content is a picture (or a name) is still a product row in GRC's sheet.
    // (Not when the "company" is really a pasted email signature: long, or with phone numbers.)
    const plausibleCompany = Boolean(company) && company!.length <= 60 && !/\+?\d[\d\s-]{7,}/.test(company!);
    if (!meaningful && !(keepRows?.has(r) && plausibleCompany)) continue;
    delete fields.company;
    if (!fields.city && city) fields.city = city;
    if (fields.sample_collected) {
      const s = fields.sample_collected.toLowerCase();
      fields.sample_collected = /^(yes|received|done)/.test(s) ? 'yes' : /^no/.test(s) ? 'no' : /await/.test(s) ? 'awaited' : fields.sample_collected;
    }
    out.push({
      sheetRef: `${tab}!${r}`,
      tab,
      company,
      region: cfg.region,
      fields,
      stage: deriveStage([fields.team_status, fields.brand_status, fields.next_action, fields.owner_remark].filter(Boolean).join(' | ')),
    });
  }
  return out;
}

function stageKeyFor(label: string, seen: Map<string, number>): string | null {
  const l = norm(label);
  const candidates = DEFAULT_BULK_STAGES.filter((s) => norm(s.label.replace(/\(post-pp\)/i, '')) === l);
  if (candidates.length === 0) {
    if (l.startsWith('in case of lc') || l.includes('lc acceptance')) return 'lc_acceptance';
    return null;
  }
  const n = seen.get(l) ?? 0;
  seen.set(l, n + 1);
  return candidates[Math.min(n, candidates.length - 1)]!.key;
}

function parseBulkSheet(ws: ExcelJS.Worksheet, tab: string): SheetBulkOrder[] {
  const header = ws.getRow(1);
  const cols: { col: number; label: string }[] = [];
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    if (col === 1) return;
    const label = clean(cellText(cell.value));
    if (label) cols.push({ col, label });
  });
  const orders = cols.map(({ col, label }) => {
    const code = label.match(/\b([A-Z]{1,6}-\d[\w.-]*)\b/i)?.[1] ?? null;
    const company = clean(code ? label.replace(code, '') : label) || null;
    return { col, order: { sheetRef: `${tab}!col${col}`, tab, label, company, product_code: code, stages: {} } as SheetBulkOrder };
  });
  const seen = new Map<string, number>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const key = stageKeyFor(cellText(row.getCell(1).value), seen);
    if (!key) continue;
    for (const { col, order } of orders) {
      const v = row.getCell(col).value;
      const text = clean(noteText(v));
      if (!text) continue;
      order.stages[key] = { value: text, date: toIsoDate(v) };
    }
  }
  return orders.map((o) => o.order).filter((o) => Object.keys(o.stages).length > 0);
}

export interface ParseOptions {
  /** Rows (per tab name, as in the sheet) to keep even without text, e.g. rows that hold a picture. */
  keepRows?: ReadonlyMap<string, ReadonlySet<number>>;
}

export async function parseWorkbook(path: string, opts: ParseOptions = {}): Promise<{ dev: SheetDevRow[]; bulk: SheetBulkOrder[]; skippedTabs: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const dev: SheetDevRow[] = [];
  const bulk: SheetBulkOrder[] = [];
  const skippedTabs: string[] = [];
  for (const ws of wb.worksheets) {
    const key = ws.name.trim().toLowerCase();
    const tab = ws.name.trim();
    if (DEV_TABS[key]) dev.push(...parseDevSheet(ws, tab, DEV_TABS[key], opts.keepRows?.get(tab)));
    else if (BULK_TABS.has(key)) bulk.push(...parseBulkSheet(ws, tab));
    else skippedTabs.push(tab);
  }
  return { dev, bulk, skippedTabs };
}
