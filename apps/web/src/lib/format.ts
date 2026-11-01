const IST = 'Asia/Kolkata';

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : IST });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST });
}

/** "4 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "1 h 20 m", for time spent waiting. */
export function duration(fromIso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60000));
  if (mins < 60) return `${mins} m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h ${mins % 60} m`;
  return `${Math.floor(h / 24)} days`;
}

export function gmailLink(mailboxEmail: string | null | undefined, gmailThreadId: string): string {
  const user = mailboxEmail ? `?authuser=${encodeURIComponent(mailboxEmail)}` : '';
  return `https://mail.google.com/mail/${user}#all/${gmailThreadId}`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
