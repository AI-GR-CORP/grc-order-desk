import { companyKey, type AppSettings } from '@grc/core';
import { DirectorySchema, discoverySystem, type Directory } from '@grc/core/ai';
import { domainOf, isFreemail, isInternal } from '@grc/core/mail';
import { getProvider } from '../ai/provider';
import { recordAiRun } from '../ai/record';
import type { Ctx } from '../context';
import { getKnowledgeProfile } from '../db';
import { errorMessage } from '../errors';
import { attachContact, findOrCreateCompany } from './companies';

interface SenderRow {
  email: string;
  name: string | null;
  n: number;
  subjects: string[] | null;
  guesses: string[] | null;
}

const CHUNK = 150;

/**
 * One-time "learning pass": builds the client directory, the GRC team list and a glossary
 * from the backfilled mail. Everything it creates is flagged for human review.
 */
export async function runDiscovery(ctx: Ctx, settings: AppSettings, mailboxId: string): Promise<void> {
  const { sql } = ctx;
  const external = await sql<SenderRow[]>`
    with people as (
      select m.from_email as email, m.from_name as name, m.subject, m.triage->>'company_name' as guess
      from email_message m join email_thread t on t.id = m.thread_id
      where t.mailbox_id = ${mailboxId} and t.category in ('development','bulk','mixed') and m.direction = 'inbound'
      union all
      select unnest(m.to_emails), null, m.subject, null
      from email_message m join email_thread t on t.id = m.thread_id
      where t.mailbox_id = ${mailboxId} and t.category in ('development','bulk','mixed') and m.direction = 'outbound'
    )
    select email, max(name) as name, count(*)::int as n,
           (array_agg(distinct subject) filter (where subject is not null))[1:3] as subjects,
           (array_agg(distinct guess) filter (where guess is not null))[1:3] as guesses
    from people group by email order by n desc limit 900`;
  const customers = external.filter((s) => !isInternal(s.email, settings.internal_domains));

  const internal = await sql<{ email: string; name: string | null; n: number }[]>`
    select m.from_email as email, max(m.from_name) as name, count(*)::int as n
    from email_message m join email_thread t on t.id = m.thread_id
    where t.mailbox_id = ${mailboxId} and m.direction in ('outbound','internal')
    group by m.from_email order by n desc limit 100`;

  if (customers.length === 0 && internal.length === 0) return;

  const profile = await getKnowledgeProfile(sql);
  const system = discoverySystem({ internalDomains: settings.internal_domains, knowledgeProfile: profile });
  const model = settings.ai_models.discovery;
  const merged: Directory = { companies: [], team: [], glossary: '' };
  const glossaries: string[] = [];

  for (let i = 0; i < Math.max(1, Math.ceil(customers.length / CHUNK)); i++) {
    const chunk = customers.slice(i * CHUNK, (i + 1) * CHUNK);
    const lines = chunk.map(
      (s) => `${s.email} | ${s.name ?? '-'} | ${s.n} emails | guesses: ${(s.guesses ?? []).join('; ') || '-'} | subjects: ${(s.subjects ?? []).join(' / ')}`,
    );
    const team = i === 0 ? internal.map((s) => `${s.email} | ${s.name ?? '-'} | ${s.n} emails`).join('\n') : '(see earlier batch)';
    const user = `<external_senders>\n${lines.join('\n') || '(none)'}\n</external_senders>\n\n<grc_senders>\n${team}\n</grc_senders>`;
    try {
      const r = await getProvider().call({ purpose: 'discovery', model, system, user, schema: DirectorySchema, maxTokens: 24_000 });
      await recordAiRun(sql, { purpose: 'discovery', model, usage: r.usage, ok: true });
      merged.companies.push(...r.data.companies);
      merged.team.push(...r.data.team);
      if (r.data.glossary.trim()) glossaries.push(r.data.glossary.trim());
    } catch (e) {
      ctx.log.warn({ err: errorMessage(e), chunk: i }, 'discovery chunk failed');
      await recordAiRun(sql, { purpose: 'discovery', model, ok: false, error: errorMessage(e) });
    }
  }

  const knownEmails = new Set(customers.map((c) => c.email));
  const seen = new Set<string>();
  for (const c of merged.companies) {
    const key = companyKey(c.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const domains = c.domains
      .map((d) => d.toLowerCase().replace(/^@/, '').trim())
      .filter((d) => d.includes('.') && !settings.freemail_domains.includes(d) && !isInternal(`x@${d}`, settings.internal_domains));
    const { id } = await findOrCreateCompany(sql, { name: c.name, city: c.city, country: c.country, region: c.region, domains }, { needsReview: true });
    for (const email of c.contact_emails.map((e) => e.toLowerCase())) {
      if (knownEmails.has(email)) await attachContact(sql, email, null, id);
    }
    // Business-domain senders the model grouped implicitly.
    for (const s of customers) {
      if (!isFreemail(s.email, settings.freemail_domains) && domains.includes(domainOf(s.email))) {
        await attachContact(sql, s.email, s.name, id);
      }
    }
  }

  const teamSeen = new Set<string>();
  for (const m of merged.team) {
    const email = m.email.toLowerCase();
    if (teamSeen.has(email) || !isInternal(email, settings.internal_domains)) continue;
    teamSeen.add(email);
    await sql`
      insert into team_member (name, email, role) values (${m.name}, ${email}, ${m.role})
      on conflict (email) do update set role = coalesce(team_member.role, excluded.role)`;
  }

  const teamLines = merged.team.filter((m) => teamSeen.has(m.email.toLowerCase())).map((m) => `- ${m.name} <${m.email.toLowerCase()}>${m.role ? ` — ${m.role}` : ''}`);
  const content = [
    teamLines.length ? `## GRC team\n${[...new Set(teamLines)].join('\n')}` : '',
    glossaries.length ? `## Notes\n${glossaries.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (content) {
    const [{ v } = { v: 0 }] = await sql<{ v: number }[]>`select coalesce(max(version), 0)::int as v from knowledge_profile`;
    const hasActive = (await sql`select 1 from knowledge_profile where active`).length > 0;
    // First profile goes live; later suggestions wait for a person to review them.
    await sql`insert into knowledge_profile (version, content, active) values (${v + 1}, ${content}, ${!hasActive})`;
  }
}
