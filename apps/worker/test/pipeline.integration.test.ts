/**
 * End-to-end pipeline test on a real Postgres with the migrations applied (see README → Testing).
 * Runs only when TEST_DATABASE_URL is set. Uses a fake AI provider and synthetic Gmail data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmailThread } from '@grc/core/gmail';
import type { ThreadExtraction, Triage } from '@grc/core/ai';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

process.env.DATABASE_URL = url ?? 'postgres://unused';
process.env.DATABASE_SSL = 'disable';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const T0 = Date.UTC(2026, 10, 2, 5, 0); // Mon 10:30 IST

function gmailMsg(id: string, at: number, from: string, to: string, body: string, subject = 'UCLA elastic samples') {
  return {
    id,
    threadId: 'gt-1',
    labelIds: ['INBOX'],
    internalDate: String(at),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: to },
        { name: 'Subject', value: subject },
      ],
      body: { data: b64(body) },
    },
  };
}

d('worker pipeline (integration)', () => {
  let sql: import('../src/db').Sql;
  let extraction: ThreadExtraction;
  const mods = {} as {
    ingest: typeof import('../src/pipeline/ingest');
    triage: typeof import('../src/pipeline/triage');
    companies: typeof import('../src/pipeline/companies');
    extract: typeof import('../src/pipeline/extract');
    reply: typeof import('../src/pipeline/reply');
    queue: typeof import('../src/queue');
    db: typeof import('../src/db');
    provider: typeof import('../src/ai/provider');
  };

  beforeAll(async () => {
    mods.db = await import('../src/db');
    mods.ingest = await import('../src/pipeline/ingest');
    mods.triage = await import('../src/pipeline/triage');
    mods.companies = await import('../src/pipeline/companies');
    mods.extract = await import('../src/pipeline/extract');
    mods.reply = await import('../src/pipeline/reply');
    mods.queue = await import('../src/queue');
    mods.provider = await import('../src/ai/provider');
    sql = mods.db.createDb();
    await sql`truncate mailbox, company, contact, team_member, job, ai_run, knowledge_profile cascade`;

    mods.provider.setProvider({
      name: 'fake',
      supportsBatch: false,
      async call(opts) {
        const usage = { model: opts.model, input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 };
        if (opts.purpose === 'triage') {
          const inbound = opts.user.includes('[CUSTOMER/EXTERNAL]');
          const t: Triage = {
            category: 'development',
            is_customer: inbound,
            needs_reply: inbound && !opts.user.includes('Thanks, received'),
            company_name: 'Arvind Fashion',
            contact_name: 'Ravi',
            confidence: 0.9,
            reason: 'sample request',
          };
          return { data: t as never, usage };
        }
        return { data: extraction as never, usage };
      },
      batchCreate: async () => 'x',
      batchStatus: async () => ({ ended: true, processing: 0, succeeded: 0, errored: 0 }),
      async *batchResults() {},
    });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('ingests, triages, extracts and tracks replies', async () => {
    const settings = await mods.db.getSettings(sql, true);
    const [mb] = await sql<{ id: string }[]>`insert into mailbox (email, status) values ('admin@grcorporation.co.in', 'active') returning id`;
    await sql`insert into team_member (name, email) values ('Poornima', 'poornima@grcorporation.co.in')`;
    await sql`insert into company (name, name_key, domains, approval) values ('Arvind Fashion', 'arvind fashion', '{arvindbrands.co.in}', 'approved')`;

    const thread: GmailThread = {
      id: 'gt-1',
      messages: [
        gmailMsg('m1', T0, 'Ravi <ravi@arvindbrands.co.in>', 'admin@grcorporation.co.in', 'Need 25MM samples for UCLA: DAISY and KAIA, 4 combos.'),
        gmailMsg('m2', T0 + 40 * 60000, 'Poornima <poornima@grcorporation.co.in>', 'ravi@arvindbrands.co.in', 'Noted, will develop. \n\nOn Mon, Ravi wrote:\n> old'),
        gmailMsg('m3', T0 + 120 * 60000, 'Ravi <ravi@arvindbrands.co.in>', 'admin@grcorporation.co.in', 'Please share price for DAISY.'),
      ],
    };
    const ing = (await mods.ingest.ingestThread(sql, settings, mb!.id, thread))!;
    expect(ing.newMessageIds).toHaveLength(3);
    expect(ing.needsTriageIds).toHaveLength(3); // 2 inbound + 1 outbound; none internal

    // Re-ingesting the same thread is a no-op.
    const again = (await mods.ingest.ingestThread(sql, settings, mb!.id, thread))!;
    expect(again.newMessageIds).toHaveLength(0);

    const [cleaned] = await sql<{ body_clean: string }[]>`select body_clean from email_message where gmail_message_id = 'm2'`;
    expect(cleaned!.body_clean).toBe('Noted, will develop.');

    const ctx = { sql, log: (await import('../src/log')).log, storage: null };
    await mods.triage.triageMessages(ctx, settings, '', ing.needsTriageIds);
    const nr = await sql<{ gmail_message_id: string; needs_reply: boolean }[]>`
      select gmail_message_id, needs_reply from email_message order by sent_at`;
    expect(nr.map((r) => r.needs_reply)).toEqual([true, false, true]);

    expect(await mods.triage.updateThreadCategory(sql, ing.threadId)).toBe('development');
    const companyId = await mods.companies.resolveThreadCompany(sql, settings, ing.threadId);
    expect(companyId).not.toBeNull();

    extraction = {
      thread_category: 'development',
      company: { name: 'Arvind Fashion', city: 'Bangalore', country: 'India' },
      primary_contact: { name: 'Ravi', email: 'ravi@arvindbrands.co.in' },
      summary: 'Arvind wants UCLA samples; price requested for DAISY.',
      next_action: 'Share DAISY price',
      waiting_on: 'us',
      latest_customer_email_needs_reply: true,
      handled_by_email: 'poornima@grcorporation.co.in',
      dev_items: [
        { existing_item_id: null, picture_files: [], brand: 'UCLA', inquiry: '25MM elastic DAISY', product_code: 'DAISY', colours: '4 combos', merchant_name: 'Ravi', enquiry_date: '2026-11-02', sample_collected: null, grc_rate: null, sample_dispatch_date: null, courier: null, awb: null, edd: null, brand_status: null, team_status: 'under development', next_action: 'share price', stage: 'under_development', summary: 'DAISY in development', confidence: 0.9 },
        { existing_item_id: null, picture_files: [], brand: 'UCLA', inquiry: '25MM elastic KAIA', product_code: 'KAIA', colours: '4 combos', merchant_name: 'Ravi', enquiry_date: '2026-11-02', sample_collected: null, grc_rate: null, sample_dispatch_date: null, courier: null, awb: null, edd: null, brand_status: null, team_status: 'under development', next_action: null, stage: 'under_development', summary: 'KAIA in development', confidence: 0.9 },
      ],
      bulk_orders: [
        { existing_order_id: null, picture_files: [], from_dev_item_id: null, brand: 'US POLO', product_code: 'VH-81', description: 'Waistband elastic', qty_mtrs: 8560, pi_number: 'PI-77', po_number: null, status: 'open', current_stage: 'pi_sent', stages: [{ key: 'pi_sent', value: '20/01/2025', date: '2025-01-20' }, { key: 'not_a_stage', value: 'x', date: null }], next_action: 'Get PI approved', summary: 'PI sent', confidence: 0.8 },
      ],
      confidence: 0.85,
    };
    expect(await mods.extract.extractThread(ctx, settings, '', ing.threadId)).toBe(true);

    const items = await sql<{ id: string; product_code: string; team_status: string; stage: string }[]>`
      select id, product_code, team_status, stage::text from dev_item order by product_code`;
    expect(items.map((i) => i.product_code)).toEqual(['DAISY', 'KAIA']);
    const stages = await sql`select stage_key from bulk_order_stage`;
    expect(stages.map((s) => s.stage_key)).toEqual(['pi_sent']); // unknown key ignored
    const [t] = await sql<{ summary: string; handled_by: string | null; waiting_on: string }[]>`select summary, handled_by, waiting_on from email_thread`;
    expect(t!.summary).toContain('UCLA');
    expect(t!.handled_by).not.toBeNull();

    // A person edits DAISY's status; the next AI run must not overwrite it or duplicate items.
    const daisy = items.find((i) => i.product_code === 'DAISY')!;
    await sql`update dev_item set team_status = 'price sent on WhatsApp', locked_fields = '{team_status}' where id = ${daisy.id}`;
    extraction = {
      ...extraction,
      dev_items: [
        { ...extraction.dev_items[0]!, existing_item_id: daisy.id, team_status: 'AI says something else', grc_rate: '$0.14/m', stage: 'prices_shared' },
        { ...extraction.dev_items[1]!, existing_item_id: null }, // no id: dedupe by product code
      ],
      bulk_orders: [],
    };
    await mods.extract.extractThread(ctx, settings, '', ing.threadId);
    const after = await sql<{ product_code: string; team_status: string; grc_rate: string | null; stage: string }[]>`
      select product_code, team_status, grc_rate, stage::text from dev_item order by product_code`;
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ product_code: 'DAISY', team_status: 'price sent on WhatsApp', grc_rate: '$0.14/m', stage: 'prices_shared' });

    await mods.reply.recomputeReply(sql, settings, ing.threadId);
    const [r] = await sql<{ reply_state: string; awaiting_reply_since: Date; reply_due_at: Date }[]>`
      select reply_state, awaiting_reply_since, reply_due_at from email_thread`;
    expect(r!.reply_state).toBe('awaiting');
    expect(r!.awaiting_reply_since.getTime()).toBe(T0 + 120 * 60000);
    expect(r!.reply_due_at.getTime()).toBe(T0 + 180 * 60000);

    const [nr2] = await sql`select count(*)::int as n from v_needs_reply`;
    expect(nr2!.n).toBe(1);
    const runs = await sql`select purpose, count(*)::int as n from ai_run group by purpose order by purpose`;
    expect(runs.map((x) => `${x.purpose}:${x.n}`)).toEqual(['extract:2', 'triage:3']);
  });

  it('reads a client only after it is approved', async () => {
    const { isThreadClientApproved } = await import('../src/pipeline/approval');
    const { runExtractCompany } = await import('../src/jobs/extract-company');
    const settings = await mods.db.getSettings(sql, true);
    const ctx = { sql, log: (await import('../src/log')).log, storage: null };
    const [mb] = await sql<{ id: string }[]>`select id from mailbox limit 1`;
    const [co] = await sql<{ id: string; approval: string }[]>`
      insert into company (name, name_key, domains) values ('Shori Trends', 'shori trends', '{shori.in}') returning id, approval`;
    expect(co!.approval).toBe('pending');

    const ing = (await mods.ingest.ingestThread(sql, settings, mb!.id, {
      id: 'gt-2',
      messages: [gmailMsg('n1', T0, 'Amit <amit@shori.in>', 'yash@grcorporation.co.in', 'Please send PI for VH-14A, 8560 mtrs.', 'VH-14A PI')],
    }))!;
    await mods.triage.triageMessages(ctx, settings, '', ing.needsTriageIds);
    await sql`update email_message set triage = triage || '{"category":"bulk"}'::jsonb where thread_id = ${ing.threadId}`;
    expect(await mods.triage.updateThreadCategory(sql, ing.threadId)).toBe('bulk');
    expect(await mods.companies.resolveThreadCompany(sql, settings, ing.threadId)).toBe(co!.id);
    expect(await isThreadClientApproved(sql, ing.threadId)).toBe(false);

    extraction = {
      ...extraction,
      thread_category: 'bulk',
      company: { name: 'Shori Trends', city: null, country: 'India' },
      dev_items: [],
      bulk_orders: [{ existing_order_id: null, picture_files: [], from_dev_item_id: null, brand: 'Van Heusen', product_code: 'VH-14A', description: 'Elastic', qty_mtrs: 8560, pi_number: null, po_number: null, status: 'open', current_stage: null, stages: [], next_action: 'Send PI', summary: 'PI requested', confidence: 0.9 }],
    };
    const orders = async () => (await sql<{ n: number }[]>`select count(*)::int as n from bulk_order where company_id = ${co!.id}`)[0]!.n;

    await runExtractCompany(ctx, co!.id); // pending: must not read
    expect(await orders()).toBe(0);
    const [q] = await sql`select tracked_threads, awaiting_reply, approval from v_client_queue where id = ${co!.id}`;
    expect(q).toMatchObject({ tracked_threads: 1, awaiting_reply: 0, approval: 'pending' });

    await sql`update company set approval = 'approved' where id = ${co!.id}`;
    await runExtractCompany(ctx, co!.id);
    expect(await orders()).toBe(1);
    const [t] = await sql<{ done: boolean }[]>`select extracted_through is not null as done from email_thread where id = ${ing.threadId}`;
    expect(t!.done).toBe(true);
  });

  it('queue dedupes, claims and retries', async () => {
    const { enqueue, claimJob, completeJob, failJob } = mods.queue;
    expect(await enqueue(sql, { kind: 'sync', dedupeKey: 'sync:a' })).toBe(true);
    expect(await enqueue(sql, { kind: 'sync', dedupeKey: 'sync:a' })).toBe(false);
    const job = (await claimJob(sql, 60))!;
    expect(job.kind).toBe('sync');
    expect(await claimJob(sql, 60)).toBeNull();
    await failJob(sql, job, 'boom', true);
    const [row] = await sql`select status, attempts from job where id = ${job.id}`;
    expect(row).toMatchObject({ status: 'queued', attempts: 1 });
    await sql`update job set run_after = now() where id = ${job.id}`;
    const again = (await claimJob(sql, 60))!;
    await completeJob(sql, again.id);
    expect(await enqueue(sql, { kind: 'sync', dedupeKey: 'sync:a' })).toBe(true);
  });
});
