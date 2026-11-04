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

  it('a logo that appears in 3+ different conversations is flagged, whoever sent it', async () => {
    const ids = [];
    for (const [i, from] of ['a@shori.in', 'b@grc.lk', 'c@arvind.in'].entries()) {
      const t = await thread(`Logo test ${i}`);
      await message(t, `logo-${i}`, from, [{ name: `image00${i}.png`, size: 77777 }, { name: `photo${i}.jpg`, size: 500000 + i }]);
      ids.push(t);
    }
    await sql`select mark_signature_images()`;
    const logos = await sql`select is_signature from attachment where size_bytes = 77777`;
    expect(logos).toHaveLength(3);
    expect(logos.every((r) => r.is_signature)).toBe(true);
    const photos = await sql`select is_signature from attachment where filename like 'photo%'`;
    expect(photos).toHaveLength(3);
    expect(photos.some((r) => r.is_signature)).toBe(false);
    // the earlier one-off image from another sender, in one conversation, is still not a logo
    const [oneOff] = await sql`select a.is_signature from attachment a join email_message m on m.id = a.message_id where m.from_email = 'someone@other.com'`;
    expect(oneOff!.is_signature).toBe(false);
  });

  it('after a GRC staff address is listed, their emails count as GRC replies and the reply state follows', async () => {
    const t = await thread('Shori Trends - Payment Advice');
    await sql`update email_message set sent_at = now() where false`;
    const [c] = await sql<{ id: string }[]>`
      insert into email_message (thread_id, gmail_message_id, direction, from_email, from_name, to_emails, sent_at, needs_reply)
      values (${t}, 'pay-1', 'inbound', 'accounts@shori.in', 'accounts shori', '{yash@grcorporation.co.in}', now() - interval '3 hours', true) returning id`;
    await sql`
      insert into email_message (thread_id, gmail_message_id, direction, from_email, from_name, to_emails, sent_at, needs_reply)
      values (${t}, 'pay-2', 'inbound', 'atif.rooma@gmail.com', 'Atif GRC Rooma', '{accounts@shori.in}', now() - interval '1 hour', null)`;
    await sql`update app_setting set value = ${sql.json(['grcorporation.co.in', 'grcorporation.com', 'atif.rooma@gmail.com'] as never)} where key = 'internal_domains'`;
    const { runRefreshDirections } = await import('../src/jobs/refresh-directions');
    const { log } = await import('../src/log');
    await runRefreshDirections({ sql, log, storage: null } as never, mb);
    const msgs = await sql`select gmail_message_id, direction from email_message where thread_id = ${t} order by sent_at`;
    expect(msgs.map((m) => `${m.gmail_message_id}:${m.direction}`)).toEqual(['pay-1:inbound', 'pay-2:outbound']);
    const [th] = await sql`select last_outbound_at is not null as answered, reply_state::text from email_thread where id = ${t}`;
    expect(th!.answered).toBe(true);
    expect(th!.reply_state).not.toBe('awaiting');
    expect(c).toBeTruthy();
    await sql`update app_setting set value = ${sql.json(['grcorporation.co.in', 'grcorporation.com'] as never)} where key = 'internal_domains'`;
  });

  it('the recompute repairs what an interrupted run left behind, and a second run changes nothing', async () => {
    const t = await thread('Interrupted run');
    await sql`
      insert into email_message (thread_id, gmail_message_id, direction, from_email, from_name, to_emails, sent_at, needs_reply)
      values (${t}, 'int-1', 'inbound', 'buyer@arvind.in', 'Buyer', '{yash@grcorporation.co.in}', now() - interval '3 hours', true),
             (${t}, 'int-2', 'outbound', 'sales5@grcorporation.in', 'Purnima GRC', '{buyer@arvind.in}', now() - interval '1 hour', null)`;
    // As if a broken run had already moved Purnima's email but stopped before fixing the conversation.
    await sql`update email_thread set last_inbound_at = now() - interval '3 hours', last_outbound_at = null, reply_state = 'awaiting' where id = ${t}`;
    await sql`update app_setting set value = ${sql.json(['grcorporation.co.in', 'grcorporation.com', 'grcorporation.in'] as never)} where key = 'internal_domains'`;
    const { runRefreshDirections } = await import('../src/jobs/refresh-directions');
    const { log } = await import('../src/log');
    await runRefreshDirections({ sql, log, storage: null } as never, mb);
    const [th] = await sql`select last_outbound_at is not null as answered, reply_state::text from email_thread where id = ${t}`;
    expect(th).toMatchObject({ answered: true });
    expect(th!.reply_state).not.toBe('awaiting');
    const again = await sql`select thread_id from refresh_message_directions(${mb}::uuid)`;
    expect(again).toHaveLength(0);
    // Running the whole job again leaves the conversation exactly as it is.
    const before = await sql`select last_inbound_at, last_outbound_at, reply_state::text from email_thread where id = ${t}`;
    await runRefreshDirections({ sql, log, storage: null } as never, mb);
    const after = await sql`select last_inbound_at, last_outbound_at, reply_state::text from email_thread where id = ${t}`;
    expect(after).toEqual(before);
    await sql`update app_setting set value = ${sql.json(['grcorporation.co.in', 'grcorporation.com'] as never)} where key = 'internal_domains'`;
  });
});
