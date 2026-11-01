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
  extra?: boolean;
}

/**
 * GRC's own columns, in the order and spelling of the "NEW INQUIRY" tab, then four added ones.
 * `key` matches the column-label keys in Settings, so renamed columns keep working.
 */
export const SHEET_COLUMNS: SheetColumn[] = [
  { key: 'merchant_name', label: 'merchant', width: 110, devField: 'merchant_name', kind: 'text' },
  { key: 'brand', label: 'brand', width: 100, devField: 'brand', bulkField: 'brand', kind: 'text' },
  { key: 'inquiry', label: 'Inquiry', width: 260, devField: 'inquiry', bulkField: 'description', kind: 'longtext' },
  { key: 'sample_collected', label: 'sample collected', width: 84, devField: 'sample_collected', kind: 'select', options: ['YES', 'NO', 'awaited'] },
  { key: 'picture', label: 'picture', width: 84 },
  { key: 'team_status', label: 'Status of Poornima', width: 170, devField: 'team_status', kind: 'longtext' },
  { key: 'brand_status', label: 'Status of brand', width: 140, devField: 'brand_status', kind: 'longtext' },
  { key: 'owner_remark', label: 'Yash remark', width: 170, devField: 'owner_remark', bulkField: 'owner_remark', kind: 'longtext' },
  // Added columns (Type is placed next to City on screen; see WorkSheet)
  { key: 'type', label: 'Type', width: 100 },
  { key: 'reply', label: 'Reply', width: 124 },
  { key: 'last_email', label: 'Last email', width: 88 },
  { key: 'email', label: 'Email', width: 92 },
  // Shown with "More columns"
  { key: 'enquiry_date', label: 'Enquiry date', width: 100, devField: 'enquiry_date', kind: 'date', extra: true },
  { key: 'product_code', label: 'Product code', width: 120, devField: 'product_code', bulkField: 'product_code', kind: 'text', extra: true },
  { key: 'colours', label: 'Colours', width: 120, devField: 'colours', kind: 'text', extra: true },
  { key: 'grc_rate', label: 'GRC rate', width: 110, devField: 'grc_rate', kind: 'text', extra: true },
  { key: 'sample_dispatch_date', label: 'Sample sent', width: 100, devField: 'sample_dispatch_date', kind: 'date', extra: true },
  { key: 'awb', label: 'AWB', width: 120, devField: 'awb', kind: 'text', extra: true },
  { key: 'edd', label: 'EDD', width: 100, devField: 'edd', kind: 'date', extra: true },
  { key: 'next_action', label: 'Work to be done', width: 180, devField: 'next_action', bulkField: 'next_action', kind: 'longtext', extra: true },
];

export const COMPANY_LABEL = 'COMPANY NAME';
export const CITY_LABEL = 'City';

export function label(col: SheetColumn, overrides: Record<string, string>): string {
  return overrides[col.key] ?? col.label;
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
