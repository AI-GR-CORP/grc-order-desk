/** A picture on a dashboard row (signed URLs, valid for an hour). */
export interface RowPic {
  /** row_picture id; null for a conversation's email pictures shown as a fallback. */
  id: string | null;
  thumb: string;
  full: string;
  source: 'sheet' | 'email' | 'upload' | 'thread';
  /** Sheet cell it came from, e.g. "E14". */
  cell: string | null;
}

export type RowTarget = { kind: 'dev' | 'bulk' | 'thread'; id: string };

/** Which record a row's pictures belong to. */
export function rowTarget(r: { source: string; item_id: string | null; thread_id: string | null }): RowTarget | null {
  if (r.source === 'item' && r.item_id) return { kind: 'dev', id: r.item_id };
  if (r.source === 'bulk' && r.item_id) return { kind: 'bulk', id: r.item_id };
  if (r.source === 'thread' && r.thread_id) return { kind: 'thread', id: r.thread_id };
  return null;
}

export function picSourceLabel(p: RowPic): string {
  if (p.source === 'sheet') return p.cell ? `From your sheet (${p.cell})` : 'From your sheet';
  if (p.source === 'upload') return 'Added here';
  return 'From the email';
}
