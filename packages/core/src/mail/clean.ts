/**
 * Turns an email body into the part a human actually wrote.
 * Every reply carries the whole thread underneath it; removing that is the biggest token saving.
 * Forwarded content is KEPT on purpose — when staff forward a customer inquiry, that IS the content.
 */

const REPLY_HEADERS: RegExp[] = [
  // Gmail / Apple: "On Tue, 12 Oct 2026 at 10:02, Ravi <r@x.com> wrote:" (may wrap onto 2–3 lines)
  /^\s*On\b[^\n]{0,250}(?:\n[^\n]{0,250}){0,2}?\bwrote:\s*$/m,
  // Outlook desktop / web
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$\n^\s*From:/im,
  /^\s*From:\s[^\n]+\n\s*(?:Sent|Date):\s[^\n]+\n(?:\s*To:)/im,
  // Some Indian corporate mail clients
  /^\s*-{2,}\s*Reply message\s*-{2,}\s*$/im,
  /^\s*Sent from my (?:iPhone|iPad|Android|Samsung|BlackBerry|mobile)[^\n]*$/im,
];

const DISCLAIMERS: RegExp[] = [
  /^\s*(?:DISCLAIMER|CONFIDENTIALITY NOTICE|CONFIDENTIALITY)\s*[:\-]/im,
  /^\s*This (?:e-?mail|message|communication)(?: and any (?:files|attachments)[^\n]*)? (?:is|are|may be) (?:confidential|intended)/im,
  /^\s*The information contained in this (?:e-?mail|message|communication)/im,
  /^\s*Please consider the environment before printing/im,
];

const MAX_CHARS = 6000;

export function cleanEmailBody(text: string | null | undefined): string {
  if (!text) return '';
  let t = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');

  let cut = t.length;
  for (const re of REPLY_HEADERS) {
    const m = re.exec(t);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  t = t.slice(0, cut);

  // Quoted lines ("> ...") that survived without a header.
  t = t
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  let dcut = t.length;
  for (const re of DISCLAIMERS) {
    const m = re.exec(t);
    if (m && m.index > 0 && m.index < dcut) dcut = m.index;
  }
  t = t.slice(0, dcut);

  // Standard "-- " signature delimiter: drop what follows only if it is short (a real signature).
  const sig = /^-- ?$/m.exec(t);
  if (sig && t.length - sig.index < 800) t = t.slice(0, sig.index);

  t = t
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (t.length > MAX_CHARS) t = t.slice(0, MAX_CHARS) + '\n[…truncated]';
  return t;
}

/** Subject without Re:/Fwd: prefixes, for grouping and display. */
export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return '';
  let s = subject.trim();
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/^(?:re|fw|fwd|aw|wg|r|tr)\s*(?:\[\d+\])?\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.trim();
}
