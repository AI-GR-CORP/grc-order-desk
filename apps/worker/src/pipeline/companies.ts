import { companyKey, cleanName, type AppSettings } from '@grc/core';
import { domainOf, isFreemail, isInternal } from '@grc/core/mail';
import type { Db } from '../db';

export interface CompanyInput {
  name: string;
  city?: string | null;
  country?: string | null;
  region?: string | null;
  domains?: string[];
}

/** Follows merged_into so we always land on the surviving company. */
export async function canonicalCompanyId(sql: Db, id: string): Promise<string> {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const [row] = await sql<{ merged_into: string | null }[]>`select merged_into from company where id = ${current}`;
    if (!row?.merged_into) return current;
    current = row.merged_into;
  }
  return current;
}

export async function findCompanyByName(sql: Db, name: string): Promise<string | null> {
  const key = companyKey(name);
  if (!key) return null;
  const [row] = await sql<{ id: string }[]>`
    select id from company where name_key = ${key} and merged_into is null order by created_at limit 1`;
  return row?.id ?? null;
}

/** Finds by normalised name, else creates (flagged for review). Merges new info into blanks only. */
export async function findOrCreateCompany(
  sql: Db,
  input: CompanyInput,
  opts: { needsReview: boolean },
): Promise<{ id: string; created: boolean }> {
  const name = cleanName(input.name);
  if (!name) throw new Error('Company name is empty');
  const domains = (input.domains ?? []).map((d) => d.toLowerCase().trim()).filter(Boolean);
  const existing = await findCompanyByName(sql, name);
  if (existing) {
    await sql`
      update company set
        city    = coalesce(city, ${input.city ?? null}),
        country = coalesce(country, ${input.country ?? null}),
        region  = coalesce(region, ${input.region ?? null}),
        domains = array(select distinct unnest(domains || ${domains}::text[]))
      where id = ${existing}`;
    return { id: existing, created: false };
  }
  const [row] = await sql<{ id: string }[]>`
    insert into company (name, name_key, city, country, region, domains, needs_review)
    values (${name}, ${companyKey(name)}, ${input.city ?? null}, ${input.country ?? null}, ${input.region ?? null},
            ${domains}::text[], ${opts.needsReview})
    returning id`;
  return { id: row!.id, created: true };
}

export async function attachContact(sql: Db, email: string, name: string | null, companyId: string): Promise<void> {
  await sql`
    insert into contact (email, name, company_id) values (${email.toLowerCase()}, ${name}, ${companyId})
    on conflict (email) do update set
      company_id = coalesce(contact.company_id, excluded.company_id),
      name = coalesce(contact.name, excluded.name)`;
}

/**
 * Deterministic company match for a thread: known contact first, then business domain.
 * Freemail senders (gmail, yahoo…) only match through the contact table.
 */
export async function resolveThreadCompany(sql: Db, settings: AppSettings, threadId: string): Promise<string | null> {
  const [t] = await sql<{ company_id: string | null; company_locked: boolean }[]>`
    select company_id, company_locked from email_thread where id = ${threadId}`;
  if (!t) return null;
  if (t.company_locked || t.company_id) return t.company_id;

  const parts = await sql<{ email: string }[]>`
    select distinct e as email from (
      select from_email as e from email_message where thread_id = ${threadId} and direction = 'inbound'
      union all
      select unnest(to_emails || cc_emails) from email_message where thread_id = ${threadId} and direction = 'outbound'
    ) x`;
  const external = parts.map((p) => p.email).filter((e) => !isInternal(e, settings.internal_domains));
  if (external.length === 0) return null;

  const byContact = await sql<{ company_id: string; n: number }[]>`
    select company_id, count(*)::int as n from contact
    where email = any(${external}::text[]) and company_id is not null
    group by company_id order by n desc limit 1`;
  let companyId = byContact[0]?.company_id ?? null;

  if (!companyId) {
    const domains = [...new Set(external.filter((e) => !isFreemail(e, settings.freemail_domains)).map(domainOf))];
    if (domains.length) {
      const [row] = await sql<{ id: string }[]>`
        select id from company where domains && ${domains}::text[] and merged_into is null order by created_at limit 1`;
      companyId = row?.id ?? null;
    }
  }
  if (!companyId) return null;
  companyId = await canonicalCompanyId(sql, companyId);
  await sql`update email_thread set company_id = ${companyId} where id = ${threadId} and not company_locked`;
  return companyId;
}
