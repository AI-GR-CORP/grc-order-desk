/** Signature logos, recall emails, and the digest in the sheet view. Needs TEST_DATABASE_URL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
process.env.DATABASE_URL = url ?? 'postgres://unused';
process.env.DATABASE_SSL = 'disable';

d('digest, logos, recalls (integration)', () => {
  let sql: import('../src/db').Sql;
  let mb: string;
  beforeAll(async () => {
    sql = (await import('../src/db')).createDb();
    await sql`truncate mailbox, company, contact, team_member, job, ai_run, knowledge_profile, correction cascade`;
    const [m] = await sql<{ id: string }[]>`insert into mailbox (email, status) values ('yash@grcorporation.co.in','active') returning id`;
    mb = m!.id;
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function thread(subject: string, extra: Record<string, unknown> = {}) {
    const [t] = await sql<{ id: string }[]>`
      insert into email_thread ${sql({ mailbox_id: mb, gmail_thread_id: `g-${subject}`, subject, category: 'bulk', ...extra } as never)} returning id`;
    return t!.id;
  }
  async function message(threadId: string, id: string, from: string, images: { name: string; size: number }[] = [], subject = 'x') {
    const [m] = await sql<{ id: string }[]>`
      insert into email_message (thread_id, gmail_message_id, direction, from_email, sent_at, subject) values (${threadId}, ${id}, 'inbound', ${from}, now(), ${subject}) returning id`;
    for (const [i, im] of images.entries()) {
      await sql`insert into attachment (message_id, part_id, gmail_attachment_id, filename, mime_type, size_bytes, kind)
                values (${m!.id}, ${String(i)}, ${`a-${id}-${i}`}, ${im.name}, 'image/png', ${im.size}, 'image')`;
    }
    return m!.id;
  }

  it('flags a logo that the same sender attaches to 3+ emails, and nothing else', async () => {
    const t = await thread('G-STAR BULK ORDER');
    await message(t, 'm1', 'ravi@arvind.in', [{ name: 'image001.png', size: 48211 }, { name: 'artwork.png', size: 912345 }]);
    await message(t, 'm2', 'sakunthala@arvind.in', [{ name: 'image002.png', size: 48211 }]);
    await message(t, 'm3', 'ravi@arvind.in', [{ name: 'image001.png', size: 48211 }]);
    await message(t, 'm4', 'someone@other.com', [{ name: 'image001.png', size: 48211 }]); // other sender: only once
    const [res] = await sql<{ n: number }[]>`select mark_signature_images() as n`;
    expect(res!.n).toBe(3);
    const flagged = await sql`select a.filename, a.size_bytes, m.from_email from attachment a join email_message m on m.id = a.message_id where a.is_signature order by m.gmail_message_id`;
    expect(flagged.map((f) => f.from_email)).toEqual(['ravi@arvind.in', 'sakunthala@arvind.in', 'ravi@arvind.in']);
    const [art] = await sql`select is_signature from attachment where filename = 'artwork.png'`;
    expect(art!.is_signature).toBe(false);
  });

  it('recall emails are triaged without the AI and never need a reply', async () => {
    const { setProvider } = await import('../src/ai/provider');
    let calls = 0;
    setProvider({ name: 'fake', supportsBatch: false, call: async () => { calls++; throw new Error('should not be called'); }, batchCreate: async () => 'x', batchStatus: async () => ({ ended: true, processing: 0, succeeded: 0, errored: 0 }), async *batchResults() {} });
    const t = await thread('Recall: LYLE & SCOTT BULK');
    const id = await message(t, 'r1', 'ravi@arvind.in', [], 'Recall: LYLE & SCOTT BULK');
    const { triageMessages } = await import('../src/pipeline/triage');
    const { log } = await import('../src/log');
    const { getSettings } = await import('../src/db');
    await triageMessages({ sql, log, storage: null } as never, await getSettings(sql, true), '', [id]);
    expect(calls).toBe(0);
    const [m] = await sql`select triage from email_message where id = ${id}`;
    expect(m!.triage).toMatchObject({ category: 'other', needs_reply: false, reason: 'Message recall' });
  });

  it('the sheet view carries the brand, pointers, latest replies and the closed state', async () => {
    const [co] = await sql<{ id: string }[]>`insert into company (name, name_key) values ('Arvind Ltd', 'arvind') returning id`;
    const t = await thread('LYLE & SCOTT- BULK -2nd-ORDERS', {
      company_id: co!.id, brand: 'LYLE & SCOTT', points: ['Bulk needed 1st week Dec', 'Asks sample submission dates'],
      customer_status: 'Asked for sample dates', grc_status: null, is_meeting: false, enquiry_ref: 'PO 4512', closed_at: new Date(),
    });
    const [r] = await sql`select row_kind, brand, points, customer_status, enquiry_ref, closed_at is not null as closed from v_sheet_rows where thread_id = ${t}`;
    expect(r).toMatchObject({ row_kind: 'bulk', brand: 'LYLE & SCOTT', points: ['Bulk needed 1st week Dec', 'Asks sample submission dates'], customer_status: 'Asked for sample dates', enquiry_ref: 'PO 4512', closed: true });
    // A product row without a brand of its own shows its conversation's brand.
    await sql`insert into dev_item (company_id, primary_thread_id, inquiry, source) values (${co!.id}, ${t}, 'Waistband 40MM', 'ai')`;
    const [item] = await sql`select brand from v_sheet_rows where source = 'item' and thread_id = ${t}`;
    expect(item!.brand).toBe('LYLE & SCOTT');
  });
});
