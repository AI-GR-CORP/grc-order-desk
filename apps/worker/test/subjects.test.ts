import { describe, expect, it } from 'vitest';
import { subjectBlocks, type SheetRow } from '../../web/src/lib/sheet';

let n = 0;
function row(p: Partial<SheetRow>): SheetRow {
  n++;
  return {
    row_id: `thread:${n}`, source: 'thread', row_kind: 'bulk', item_id: null, company_id: 'arvind', company_name: 'Arvind Ltd', company_city: 'Bangalore', company_region: 'Domestic', company_approval: 'pending',
    merchant: 'Sakunthala K K', brand: null, inquiry: null, sample_collected: null, team_status: null, brand_status: null, owner_remark: null, stage: null, locked_fields: [], summary: null,
    enquiry_date: null, product_code: null, colours: null, grc_rate: null, sample_dispatch_date: null, awb: null, edd: null, next_action: null, po_number: null, qty_mtrs: null,
    thread_id: `t${n}`, thread_subject: null, reply_state: null, waiting_on: null, reply_due_at: null, gmail_thread_id: `g${n}`, mailbox_email: 'yash@grcorporation.co.in',
    email_count: 2, thread_count: 1, is_read: false, last_at: null, origin: 'email', created_at: '2026-10-01T00:00:00Z',
    topics: [], type_confidence: 0.9, type_needs_check: false, type_checked_at: null, type_reason: null,
    points: [], customer_status: null, grc_status: null, last_in_at: null, last_out_at: null, is_meeting: false, price_quoted: null, sample_status: null, enquiry_ref: null, closed_at: null, title: null, customer_on: null, grc_on: null, awaiting_grc: false,
    ...p,
  } as SheetRow;
}

describe('subjectBlocks', () => {
  it('keeps every enquiry its own row, grouped under one subject heading per brand', () => {
    const shah = (p: Partial<SheetRow>) => row({ company_id: 'shah', company_name: 'Shah Asia', merchant: 'Krishnan Iyer', ...p });
    const rows = [
      shah({ brand: 'Cintas', title: 'Shah Safari Wire - Payment Confirmation', customer_status: 'Confirm receipt of payment' }),
      row({ brand: 'G-STAR', title: 'G-STAR Bulk Order' }),
      shah({ brand: 'CINTAS', title: 'FCL Shipment Booking', customer_status: 'Brief CHA, share shipping instructions' }),
      row({ brand: 'G-Star', title: 'G-STAR elastic discussion', is_meeting: true }),
      row({ brand: 'LYLE & SCOTT', title: 'LYLE & SCOTT - Bulk Orders' }),
      shah({ brand: 'Cintas', title: 'Shah Safari Wire - Second Payment' }),
      row({ brand: 'G-STAR', title: 'G-star plan' }),
      row({ brand: 'Cintas', company_id: 'other', title: 'Other client Cintas' }), // another client: separate
      row({ brand: 'UCLA', source: 'item', row_kind: 'development', item_id: 'i1', thread_id: null, inquiry: 'DAISY' }),
      row({ brand: null, title: 'No brand' }),
    ];
    const { rows: out, info } = subjectBlocks(rows);
    expect(out).toHaveLength(rows.length); // nothing collapsed: one row per enquiry
    const titles = out.map((r) => r.title ?? r.inquiry);
    // Cintas (Shah Asia) together, in sort order; then G-STAR with the meeting last; then the rest
    expect(titles).toEqual([
      'Shah Safari Wire - Payment Confirmation', 'FCL Shipment Booking', 'Shah Safari Wire - Second Payment',
      'G-STAR Bulk Order', 'G-star plan', 'G-STAR elastic discussion',
      'LYLE & SCOTT - Bulk Orders', 'Other client Cintas', 'DAISY', 'No brand',
    ]);
    const cintas = info.get(out[0]!.row_id)!;
    expect(cintas).toMatchObject({ brand: 'Cintas', kind: 'bulk', size: 3, first: true });
    expect(info.get(out[1]!.row_id)).toMatchObject({ size: 3, first: false });
    // each enquiry keeps its own customer reply
    expect(out.slice(0, 2).map((r) => r.customer_status)).toEqual(['Confirm receipt of payment', 'Brief CHA, share shipping instructions']);
    expect(info.get(out[3]!.row_id)).toMatchObject({ brand: 'G-STAR', size: 3, first: true });
    expect(info.get(out[7]!.row_id)).toMatchObject({ size: 1 }); // the other client's Cintas
    expect(info.has(out[9]!.row_id)).toBe(false); // no brand: no subject heading
  });

  it('keeps development and bulk of the same brand as separate subjects', () => {
    const { info, rows: out } = subjectBlocks([row({ brand: 'UCLA', row_kind: 'development' }), row({ brand: 'UCLA', row_kind: 'bulk' })]);
    expect(info.get(out[0]!.row_id)!.key).not.toBe(info.get(out[1]!.row_id)!.key);
  });
});
