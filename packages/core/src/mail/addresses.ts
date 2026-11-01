export interface Address {
  name: string | null;
  email: string;
}

/**
 * Parses an RFC 5322-ish address list: `"Kumar, Ravi" <ravi@x.com>, sales@y.in, Priya <p@z.com>`.
 * Commas inside quotes or angle brackets do not split. Invalid entries are skipped.
 */
export function parseAddressList(header: string | null | undefined): Address[] {
  if (!header) return [];
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of header) {
    if (ch === '"' ) inQuote = !inQuote;
    else if (ch === '<' && !inQuote) inAngle = true;
    else if (ch === '>' && !inQuote) inAngle = false;
    if ((ch === ',' || ch === ';') && !inQuote && !inAngle) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);

  const out: Address[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const angle = p.match(/<([^<>\s]+@[^<>\s]+)>/);
    let email: string | undefined;
    let name: string | null = null;
    if (angle) {
      email = angle[1];
      name = p.slice(0, angle.index).trim().replace(/^"|"$/g, '').trim() || null;
    } else {
      const bare = p.match(/[^\s<>"]+@[^\s<>"]+/);
      email = bare?.[0];
    }
    if (!email) continue;
    email = email.replace(/^mailto:/i, '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    out.push({ name: name ? decodeQuoted(name) : null, email });
  }
  return out;
}

function decodeQuoted(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function isInternal(email: string, internalDomains: readonly string[]): boolean {
  const d = domainOf(email);
  return internalDomains.some((x) => d === x.toLowerCase() || d.endsWith('.' + x.toLowerCase()));
}

export function isFreemail(email: string, freemailDomains: readonly string[]): boolean {
  return freemailDomains.includes(domainOf(email));
}

export type Direction = 'inbound' | 'outbound' | 'internal';

/** inbound = from outside; outbound = GRC to at least one outsider; internal = GRC to GRC only. */
export function messageDirection(
  from: string,
  recipients: readonly string[],
  internalDomains: readonly string[],
): Direction {
  if (!isInternal(from, internalDomains)) return 'inbound';
  return recipients.some((r) => !isInternal(r, internalDomains)) ? 'outbound' : 'internal';
}
