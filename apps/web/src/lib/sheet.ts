/** One line of the sheet, from the v_sheet_rows view. */
export interface SheetRow {
  row_id: string;
  source: 'item' | 'bulk' | 'thread';
  row_kind: 'development' | 'bulk' | 'mixed';
  item_id: string | null;
  company_id: string | null;
  company_name: string | null;
  company_city: string | null;
  company_region: string | null;
  company_approval: 'pending' | 'approved' | 'rejected' | null;
  merchant: string | null;
  brand: string | null;
  inquiry: string | null;
  sample_collected: string | null;
  team_status: string | null;
  brand_status: string | null;
  owner_remark: string | null;
  stage: string | null;
  locked_fields: string[];
  summary: string | null;
  enquiry_date: string | null;
  product_code: string | null;
  colours: string | null;
  grc_rate: string | null;
  sample_dispatch_date: string | null;
  awb: string | null;
  edd: string | null;
  next_action: string | null;
  po_number: string | null;
  qty_mtrs: number | null;
  thread_id: string | null;
  thread_subject: string | null;
  reply_state: string | null;
  waiting_on: string | null;
  reply_due_at: string | null;
  gmail_thread_id: string | null;
  mailbox_email: string | null;
  email_count: number;
  thread_count: number;
  is_read: boolean;
  last_at: string | null;
  origin: string;
  created_at: string;
}

export interface SheetColumn {
  key: string;
  label: string;
  width: number;
  /** Where edits go: dev item field / bulk order field. Missing = not editable. */
  devField?: string;
  bulkField?: string;
  kind?: 'text' | 'longtext' | 'date' | 'select';
  options?: string[];
  /** Shown only in the details panel unless switched on under Columns. */
  extra?: boolean;
  sortable?: boolean;
}

/**
 * GRC's columns in the order of the "NEW INQUIRY" tab (Company name and City are drawn
 * separately, merged per client), then the added Type / Reply / Last email, then extra details.
 * `key` matches the column-label keys in Settings, so renamed columns keep working.
 */
export const SHEET_COLUMNS: SheetColumn[] = [
  { key: 'merchant_name', label: 'Merchant', width: 140, devField: 'merchant_name', kind: 'text', sortable: true },
  { key: 'brand', label: 'Brand', width: 124, devField: 'brand', bulkField: 'brand', kind: 'text', sortable: true },
  { key: 'inquiry', label: 'Inquiry', width: 300, devField: 'inquiry', bulkField: 'description', kind: 'longtext', sortable: true },
  { key: 'sample_collected', label: 'Sample collected', width: 136, devField: 'sample_collected', kind: 'select', options: ['YES', 'NO', 'awaited'] },
  { key: 'picture', label: 'Picture', width: 96 },
  { key: 'team_status', label: 'Status of Poornima', width: 190, devField: 'team_status', kind: 'longtext' },
  { key: 'brand_status', label: 'Status of brand', width: 164, devField: 'brand_status', kind: 'longtext' },
  { key: 'owner_remark', label: 'Yash remark', width: 184, devField: 'owner_remark', bulkField: 'owner_remark', kind: 'longtext' },
  // Added columns
  { key: 'type', label: 'Type', width: 128 },
  { key: 'reply', label: 'Reply', width: 156, sortable: true },
  { key: 'last_email', label: 'Last email', width: 116, sortable: true },
  // More details (details panel; can be added as columns)
  { key: 'enquiry_date', label: 'Enquiry date', width: 116, devField: 'enquiry_date', kind: 'date', extra: true },
  { key: 'product_code', label: 'Product code', width: 130, devField: 'product_code', bulkField: 'product_code', kind: 'text', extra: true },
  { key: 'colours', label: 'Colours', width: 130, devField: 'colours', kind: 'text', extra: true },
  { key: 'grc_rate', label: 'GRC rate', width: 120, devField: 'grc_rate', kind: 'text', extra: true },
  { key: 'sample_dispatch_date', label: 'Sample sent', width: 116, devField: 'sample_dispatch_date', kind: 'date', extra: true },
  { key: 'awb', label: 'AWB', width: 130, devField: 'awb', kind: 'text', extra: true },
  { key: 'edd', label: 'EDD', width: 110, devField: 'edd', kind: 'date', extra: true },
  { key: 'next_action', label: 'Work to be done', width: 190, devField: 'next_action', bulkField: 'next_action', kind: 'longtext', extra: true },
];

export type GridMode = 'development' | 'client' | 'approvals';

/** Every column from GRC's sheet plus the added ones; the Columns menu can hide or add more. */
const ALL_MAIN = SHEET_COLUMNS.filter((c) => !c.extra).map((c) => c.key);
export const DEFAULT_COLUMNS: Record<GridMode, string[]> = {
  development: ALL_MAIN,
  client: ALL_MAIN,
  approvals: ALL_MAIN,
};

export const INQUIRY = SHEET_COLUMNS.find((c) => c.key === 'inquiry')!;

export const COMPANY_LABEL = 'Company name';
export const CITY_LABEL = 'City';

export function label(col: SheetColumn, overrides: Record<string, string>): string {
  return overrides[col.key] ?? col.label;
}

/** "Dubai, Export", or just "Tirupur" when city and region are the same. */
export function placeOf(city: string | null | undefined, region: string | null | undefined): string {
  const parts = [city, region].filter(Boolean) as string[];
  return [...new Set(parts.map((p) => p.trim()))].filter((p, i, a) => a.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i).join(', ');
}

/** The value behind a column for a row (merchant is stored as `merchant`). */
export function cellValue(r: SheetRow, key: string): string | null {
  const v = (r as unknown as Record<string, unknown>)[key === 'merchant_name' ? 'merchant' : key];
  return v === null || v === undefined ? null : String(v);
}

const REPLY_RANK: Record<string, number> = { awaiting: 0, possibly_replied: 1 };
/** Lower = more urgent: late, needs reply, maybe replied, waiting for customer, replied. */
export function replyRank(r: { reply_state: string | null; waiting_on?: string | null; reply_due_at?: string | null }): number {
  if (r.reply_state === 'awaiting') return r.reply_due_at && new Date(r.reply_due_at).getTime() < Date.now() ? -1 : 0;
  if (r.reply_state && r.reply_state in REPLY_RANK) return REPLY_RANK[r.reply_state]!;
  if (r.waiting_on === 'customer') return 3;
  return r.reply_state === 'replied' ? 4 : 5;
}

export interface SheetGroup<T> {
  key: string;
  companyId: string | null;
  name: string;
  city: string | null;
  region: string | null;
  approval: SheetRow['company_approval'];
  rows: T[];
  waiting: number;
  lastAt: number;
}

export function isWaiting(r: { reply_state: string | null }) {
  return r.reply_state === 'awaiting';
}

/** Rows grouped under their company, like the merged company cells in GRC's sheet. */
export function groupByCompany(rows: SheetRow[]): SheetGroup<SheetRow>[] {
  const map = new Map<string, SheetGroup<SheetRow>>();
  for (const r of rows) {
    const key = r.company_id ?? 'none';
    const g =
      map.get(key) ??
      { key, companyId: r.company_id, name: r.company_name ?? 'Client not known yet', city: r.company_city, region: r.company_region, approval: r.company_approval, rows: [], waiting: 0, lastAt: 0 };
    g.rows.push(r);
    if (isWaiting(r)) g.waiting++;
    g.lastAt = Math.max(g.lastAt, r.last_at ? new Date(r.last_at).getTime() : 0);
    map.set(key, g);
  }
  for (const g of map.values()) {
    g.rows.sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || (b.last_at ?? '').localeCompare(a.last_at ?? ''));
  }
  return [...map.values()].sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || b.lastAt - a.lastAt);
}
