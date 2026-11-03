/**
 * The Development table / Excel export columns, in the order of GRC's sheet.
 * `sheet` documents which workbook column each one replaces.
 */
export interface ColumnDef {
  key: string;
  label: string;
  sheet: string;
  editable: boolean;
  width: number;
  kind?: 'text' | 'date' | 'stage' | 'longtext' | 'select';
  options?: readonly string[];
}

export const DEV_COLUMNS: readonly ColumnDef[] = [
  { key: 'enquiry_date', label: 'Enquiry date', sheet: 'Enquiry date / Date', editable: true, width: 104, kind: 'date' },
  { key: 'merchant_name', label: 'Merchant', sheet: 'merchant / team', editable: true, width: 130 },
  { key: 'brand', label: 'Brand', sheet: 'brand', editable: true, width: 120 },
  { key: 'inquiry', label: 'Inquiry', sheet: 'Inquiry / Sample Description', editable: true, width: 240, kind: 'longtext' },
  { key: 'product_code', label: 'Product code', sheet: 'Product code', editable: true, width: 130 },
  { key: 'colours', label: 'Colours', sheet: 'Colours', editable: true, width: 120 },
  { key: 'sample_collected', label: 'Sample collected', sheet: 'sample collected', editable: true, width: 100, kind: 'select', options: ['yes', 'no', 'awaited'] },
  { key: 'grc_rate', label: 'GRC rate', sheet: 'GRC rates', editable: true, width: 130 },
  { key: 'sample_dispatch_date', label: 'Dispatched', sheet: 'samples sent: Date', editable: true, width: 104, kind: 'date' },
  { key: 'awb', label: 'AWB', sheet: 'AWB / Blue Dart Tracking', editable: true, width: 130 },
  { key: 'edd', label: 'EDD', sheet: 'SAMPLE EDD', editable: true, width: 104, kind: 'date' },
  { key: 'brand_status', label: 'Status of brand', sheet: 'Status of brand', editable: true, width: 170, kind: 'longtext' },
  { key: 'sample_approval', label: 'Sample approval', sheet: '(new)', editable: true, width: 140 },
  { key: 'team_status', label: 'Team status', sheet: 'Status of Poornima / Aquib Status', editable: true, width: 200, kind: 'longtext' },
  { key: 'next_action', label: 'Work to be done', sheet: 'Work to be done / Aquib to do', editable: true, width: 200, kind: 'longtext' },
  { key: 'owner_remark', label: 'Owner remark', sheet: 'Yash remark', editable: true, width: 200, kind: 'longtext' },
  { key: 'stage', label: 'Stage', sheet: '(new)', editable: true, width: 150, kind: 'stage' },
] as const;

export const DEV_EDITABLE_FIELDS = new Set(DEV_COLUMNS.filter((c) => c.editable).map((c) => c.key));

export const BULK_EDITABLE_FIELDS = new Set([
  'brand',
  'product_code',
  'description',
  'qty_mtrs',
  'pi_number',
  'po_number',
  'status',
  'next_action',
  'owner_remark',
]);

export function columnLabel(col: ColumnDef, overrides: Record<string, string>): string {
  return overrides[col.key] ?? col.label;
}
