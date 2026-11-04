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
  topics: string[];
  type_confidence: number | null;
  type_needs_check: boolean;
  type_checked_at: string | null;
  type_reason: string | null;
  /** The conversation digest. */
  points: string[];
  customer_status: string | null;
  grc_status: string | null;
  last_in_at: string | null;
  last_out_at: string | null;
  is_meeting: boolean;
  price_quoted: string | null;
  sample_status: string | null;
  enquiry_ref: string | null;
  closed_at: string | null;
  /** A short heading for the enquiry (the only text in the Inquiry column). */
  title: string | null;
  /** Dates of the emails "Customer reply" and "GRC reply" describe. */
  customer_on: string | null;
  grc_on: string | null;
  /** (Legacy; unused.) */
  members?: SheetRow[];
}

/** Rows whose type and topics a person should look at (the AI wasn't sure, or disagreed with a clue). */
export const needsTypeCheck = (r: Pick<SheetRow, 'type_needs_check' | 'type_checked_at' | 'row_kind'>) =>
  !r.type_checked_at && (r.type_needs_check || r.row_kind === 'mixed');

export function typeInfo(r: SheetRow) {
  return {
    threadId: r.thread_id,
    threadIds: r.members ? (r.members.map((m) => m.thread_id).filter(Boolean) as string[]) : undefined,
    kind: r.row_kind,
    topics: r.topics ?? [],
    needsCheck: needsTypeCheck(r),
    checked: Boolean(r.type_checked_at),
    confidence: r.type_confidence,
    reason: r.type_reason,
  };
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
 * Type (Development or Bulk) right after City, then GRC's columns in the order of the "NEW INQUIRY"
 * tab (Company name and City are drawn separately, merged per client), then the added Reply /
 * Last email, then extra details.
 * `key` matches the column-label keys in Settings, so renamed columns keep working.
 */
export const SHEET_COLUMNS: SheetColumn[] = [
  { key: 'type', label: 'Type', width: 128, sortable: true },
  { key: 'merchant_name', label: 'Merchant', width: 140, devField: 'merchant_name', kind: 'text', sortable: true },
  { key: 'brand', label: 'Brand', width: 124, devField: 'brand', bulkField: 'brand', kind: 'text', sortable: true },
  { key: 'inquiry', label: 'Inquiry', width: 300, devField: 'inquiry', bulkField: 'description', kind: 'longtext', sortable: true },
  // What each side said last, per enquiry
  { key: 'customer_reply', label: 'Customer reply', width: 210 },
  { key: 'grc_reply', label: 'GRC reply', width: 210 },
  { key: 'picture', label: 'Picture', width: 150 },
  { key: 'brand_status', label: 'Status of brand', width: 164, devField: 'brand_status', kind: 'longtext' },
  // Development: what GRC quoted and where the sample stands
  { key: 'price_quoted', label: 'Price quoted', width: 130, devField: 'grc_rate', kind: 'text' },
  { key: 'sample_status', label: 'Sample approval', width: 140, devField: 'sample_approval', kind: 'text' },
  // Added columns (Type is first, right after City, because it tells development and bulk apart)
  { key: 'reply', label: 'Reply', width: 156, sortable: true },
  { key: 'last_email', label: 'Last email', width: 116, sortable: true },
  // More details (details panel; can be added as columns)
  { key: 'enquiry_date', label: 'Enquiry date', width: 116, devField: 'enquiry_date', kind: 'date', extra: true },
  { key: 'product_code', label: 'Product code', width: 130, devField: 'product_code', bulkField: 'product_code', kind: 'text', extra: true },
  { key: 'colours', label: 'Colours', width: 130, devField: 'colours', kind: 'text', extra: true },
  { key: 'sample_dispatch_date', label: 'Sample sent', width: 116, devField: 'sample_dispatch_date', kind: 'date', extra: true },
  { key: 'awb', label: 'AWB', width: 130, devField: 'awb', kind: 'text', extra: true },
  { key: 'edd', label: 'EDD', width: 110, devField: 'edd', kind: 'date', extra: true },
  { key: 'next_action', label: 'Work to be done', width: 190, devField: 'next_action', bulkField: 'next_action', kind: 'longtext', extra: true },
];

export type GridMode = 'orders' | 'client' | 'approvals';

/** Every column from GRC's sheet plus the added ones; the Columns menu can hide or add more. */
const ALL_MAIN = SHEET_COLUMNS.filter((c) => !c.extra).map((c) => c.key);
export const DEFAULT_COLUMNS: Record<GridMode, string[]> = {
  orders: ALL_MAIN,
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

const brandKey = (b: string | null) => (b ?? '').toLowerCase().replace(/[^a-z0-9&]+/g, '');

export interface SubjectInfo {
  key: string;
  brand: string;
  kind: string;
  /** Rows in this subject (enquiries, meetings, products). */
  size: number;
  /** True on the subject's first row: it carries the merged heading cell. */
  first: boolean;
  rows: SheetRow[];
}

/**
 * Within one client: rows about the same brand and type sit together as one subject, under one
 * heading; a meeting invite joins its brand's subject. Every enquiry stays its own row (with its own
 * Customer reply / GRC reply and its own Close). Subjects keep the order of the current sort.
 */
export function subjectBlocks(rows: SheetRow[]): { rows: SheetRow[]; info: Map<string, SubjectInfo> } {
  const keyOf = new Map<string, string>();
  const kinds = new Map<string, Set<string>>(); // company|brand → kinds present (non-meeting)
  for (const r of rows) {
    const b = brandKey(r.brand);
    if (!b || !r.company_id || r.is_meeting) continue;
    const cb = `${r.company_id}|${b}`;
    kinds.set(cb, (kinds.get(cb) ?? new Set()).add(r.row_kind));
  }
  for (const r of rows) {
    const b = brandKey(r.brand);
    if (!b || !r.company_id) continue;
    let kind: string = r.row_kind;
    if (r.is_meeting) {
      const have = kinds.get(`${r.company_id}|${b}`);
      if (have?.size) kind = have.has(r.row_kind) ? r.row_kind : have.has('bulk') ? 'bulk' : [...have][0]!;
    }
    keyOf.set(r.row_id, `${r.company_id}|${kind}|${b}`);
  }
  const order: string[] = [];
  const bySubject = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const k = keyOf.get(r.row_id) ?? `row:${r.row_id}`;
    if (!bySubject.has(k)) {
      bySubject.set(k, []);
      order.push(k);
    }
    bySubject.get(k)!.push(r);
  }
  const out: SheetRow[] = [];
  const info = new Map<string, SubjectInfo>();
  for (const k of order) {
    const list = bySubject.get(k)!;
    // Real enquiries first, meeting invites after them.
    const sorted = [...list.filter((r) => !r.is_meeting), ...list.filter((r) => r.is_meeting)];
    if (!k.startsWith('row:')) {
      const lead = sorted.find((r) => !r.is_meeting) ?? sorted[0]!;
      sorted.forEach((r, i) => info.set(r.row_id, { key: k, brand: lead.brand ?? '', kind: k.split('|')[1]!, size: sorted.length, first: i === 0, rows: sorted }));
    }
    out.push(...sorted);
  }
  return { rows: out, info };
}
