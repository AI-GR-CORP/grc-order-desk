import { describe, expect, it } from 'vitest';
import { groupSubjects, type SheetRow } from '../../web/src/lib/sheet';

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
    points: [], customer_status: null, grc_status: null, last_in_at: null, last_out_at: null, is_meeting: false, price_quoted: null, sample_status: null, enquiry_ref: null, closed_at: null,
    ...p,
  } as SheetRow;
}

describe('groupSubjects', () => {
  it("puts a client's emails about one brand and type into one subject, with meetings inside it", () => {
    const rows = [
      row({ brand: 'LYLE & SCOTT', thread_subject: 'LYLE & SCOTT- BULK -ORDERS', last_at: '2026-10-23T10:00:00Z', last_in_at: '2026-10-23T10:00:00Z', customer_status: 'Shared order details', topics: ['pp_approval'] }),
      row({ brand: 'Lyle & Scott', thread_subject: 'LYLE & SCOTT- BULK -2nd-ORDERS', last_at: '2026-10-29T10:00:00Z', last_in_at: '2026-10-29T10:00:00Z', customer_status: 'Asked for sample dates', reply_state: 'awaiting', reply_due_at: '2026-10-29T11:00:00Z' }),
      row({ brand: 'G-STAR', thread_subject: 'G-STAR BULK ORDER -ELASTIC ORDERS', last_at: '2026-11-03T10:00:00Z', topics: ['complaint'] }),
      row({ brand: 'G-Star', thread_subject: 'G-star plan', last_at: '2026-10-27T10:00:00Z', last_out_at: '2026-10-28T10:00:00Z', grc_status: 'Confirmed PO quantities' }),
      row({ brand: 'G-STAR', thread_subject: 'G-STAR elastic discussion', is_meeting: true, last_at: '2026-10-27T09:00:00Z' }),
      row({ brand: 'G-STAR', source: 'item', row_kind: 'development', item_id: 'i1', thread_id: null, inquiry: 'G-STAR waistband 35MM' }), // a product row stays a row
      row({ brand: 'G-STAR', company_id: 'other', company_name: 'Other Ltd', thread_subject: 'G-STAR enquiry' }), // another client: never merged
      row({ brand: null, thread_subject: 'Hello' }), // no brand: its own row
    ];
    const out = groupSubjects(rows);
    expect(out).toHaveLength(5);

    const lyle = out.find((r) => r.brand?.toLowerCase() === 'lyle & scott')!;
    expect(lyle.members!.map((m) => m.thread_subject)).toEqual(['LYLE & SCOTT- BULK -ORDERS', 'LYLE & SCOTT- BULK -2nd-ORDERS']);
    expect(lyle.reply_state).toBe('awaiting');
    expect(lyle.customer_status).toBe('Asked for sample dates');
    expect(lyle.topics).toEqual(['pp_approval']);
    expect(lyle.thread_count).toBe(2);

    const gstar = out.find((r) => r.members && r.brand?.toLowerCase() === 'g-star')!;
    expect(gstar.members!.map((m) => m.thread_subject)).toEqual(['G-STAR elastic discussion', 'G-star plan', 'G-STAR BULK ORDER -ELASTIC ORDERS']);
    expect(gstar.members!.filter((m) => m.is_meeting)).toHaveLength(1);
    expect(gstar.grc_status).toBe('Confirmed PO quantities');
    expect(gstar.thread_subject).toBe('G-STAR BULK ORDER -ELASTIC ORDERS'); // the latest real enquiry leads
    expect(out.filter((r) => r.source === 'item')).toHaveLength(1);
    expect(out.find((r) => r.company_id === 'other')!.members).toBeUndefined();
  });

  it('keeps development and bulk of the same brand apart', () => {
    const out = groupSubjects([row({ brand: 'UCLA', row_kind: 'development' }), row({ brand: 'UCLA', row_kind: 'bulk' })]);
    expect(out).toHaveLength(2);
  });
});
