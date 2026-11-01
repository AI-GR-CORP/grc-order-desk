/**
 * Plain-text clues about what a conversation is. They are shown to the AI as hints and used to
 * cross-check its answer: when the AI's answer ignores a strong clue, the row is flagged for a
 * person to check. They never decide on their own (words can be quoted out of context).
 */

export type ClueKey = 'bulk' | 'development' | 'complaint' | 'payment_followup' | 'pp_approval' | 'lab_approval';

interface Rule {
  re: RegExp;
  /** A strong clue is unambiguous on its own (e.g. a PO number); a weak one only suggests. */
  strong?: boolean;
}

const RULES: Record<ClueKey, Rule[]> = {
  bulk: [
    { re: /\b(?:p\.?\s?o\.?|purchase\s+order)\s*(?:no\.?|number|#|:|-)?\s*[A-Z]{0,4}[-/]?\d{3,}/i, strong: true },
    { re: /\bproceed\s+(?:with|for)\s+(?:the\s+)?(?:bulk|production|order)/i, strong: true },
    { re: /\b(?:new|repeat|confirmed|top)\s+(?:order|qty|qtys|quantit(?:y|ies))\b/i, strong: true },
    { re: /\bbulk\s+(?:order|production|qty|quantit(?:y|ies)|dispatch|delivery)/i, strong: true },
    { re: /\border\s+confirm(?:ation|ed)?\b/i, strong: true },
    { re: /\b(?:proforma|p\.?\s?i\.?)\s*(?:no\.?|number|#|:)\s*[A-Z]{0,4}[-/]?\d{2,}/i, strong: true },
    { re: /\b(?:revise|revised|amend(?:ed)?)\s+(?:the\s+)?p\.?o\.?s?\b/i, strong: true },
    { re: /\b(?:dispatch|ex[-\s]?factory|packing\s+list|delivery\s+schedule|shipment\s+date)\b/i },
    { re: /\b(?:invoice|inv\.?\s*no)\b/i },
    { re: /\bL\/C\b|\bletter\s+of\s+credit\b|\bLC\s+(?:copy|documents?|draft|amendment|no\.?)\b/i },
  ],
  development: [
    { re: /\b(?:new\s+)?(?:inquiry|enquiry)\b/i },
    { re: /\b(?:reference|ref\.?)\s+sample/i },
    { re: /\b(?:artwork|swatch(?:es)?|cad|tech\s*pack)\b/i },
    { re: /\bdevelop(?:ment|ing|ed)?\b/i },
    { re: /\bsample\s+(?:request|required|needed|development)/i },
    { re: /\b(?:quotation|quote|costing|price\s+(?:for|of|request|list))\b/i },
    { re: /\bcatalog(?:ue)?\b/i },
  ],
  complaint: [
    { re: /\bcomplain(?:t|ts|ed|ing)?\b/i, strong: true },
    { re: /\b(?:defect(?:ive|s)?|faulty|damaged|rejected|rejection|claim)\b/i },
    { re: /\b(?:shade\s+variation|short\s+(?:qty|quantity|supply|shipment)|wrong\s+(?:colou?r|width|item|qty|quantity))\b/i, strong: true },
    { re: /\b(?:not\s+as\s+per\s+(?:approved\s+)?(?:sample|standard)|quality\s+(?:issue|problem))\b/i, strong: true },
  ],
  payment_followup: [
    { re: /\bpayment\s+(?:reminder|follow[-\s]?up|due|pending|received|made|done|release|status|advice|confirmation)\b/i, strong: true },
    { re: /\b(?:remittance|outstanding|overdue)\b/i, strong: true },
    { re: /\bpayment\b/i },
    { re: /\b(?:ledger|statement\s+of\s+account|due\s+amount|balance\s+(?:amount|due|payment))\b/i, strong: true },
    { re: /\b(?:swift\s+copy|bank\s+transfer|amount\s+transferred|advance\s+payment)\b/i, strong: true },
  ],
  pp_approval: [
    { re: /\bp\.?\s?p\.?\s*(?:sample|approval|appvl|comments?)\b/i, strong: true },
    { re: /\bpre[-\s]?production\b/i, strong: true },
    { re: /\bsample\s+approv(?:al|ed)\b/i, strong: true },
    { re: /\bapprove\s+(?:the\s+)?samples?\b/i, strong: true },
    { re: /\bapproved\s+samples?\b/i },
    { re: /\bsealer\b/i },
  ],
  lab_approval: [
    { re: /\blab\s*(?:test|report|approval|dip|result)s?\b/i, strong: true },
    { re: /\b(?:bureau\s+veritas|intertek|sgs|t[uü]v)\b/i, strong: true },
    { re: /\bBV\s+(?:test|report|approval|bills?|lab)\b/i, strong: true },
    { re: /\bBV\b/ },
    { re: /\bEPT\b/, strong: true },
    { re: /\b(?:test\s+report|colou?r\s*fastness|azo\s+test|physical\s+test|chemical\s+test)\b/i, strong: true },
  ],
};

/** File names that say what an attachment is. */
const ATTACHMENT_RULES: { key: ClueKey; re: RegExp }[] = [
  { key: 'bulk', re: /(?:^|[^a-z])(?:po|purchase[_\s-]?order|pi|proforma)(?:[^a-z]|$)/i },
  { key: 'lab_approval', re: /(?:test[_\s-]?report|lab|bv|intertek|sgs|ept)/i },
];

export interface Clue {
  key: ClueKey;
  strong: boolean;
  text: string;
}

export interface ClueText {
  subject?: string | null;
  body?: string | null;
  attachments?: readonly string[];
}

function around(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Finds clues in a conversation's subject, emails and attachment names (at most 3 per kind). */
export function findClues(parts: readonly ClueText[]): Clue[] {
  const out: Clue[] = [];
  const seen = new Set<string>();
  const add = (c: Clue) => {
    const id = `${c.key}:${c.text.toLowerCase()}`;
    if (seen.has(id) || out.filter((x) => x.key === c.key).length >= 3) return;
    seen.add(id);
    out.push(c);
  };
  for (const p of parts) {
    const text = [p.subject, p.body].filter(Boolean).join('\n');
    for (const key of Object.keys(RULES) as ClueKey[]) {
      for (const rule of RULES[key]) {
        const m = rule.re.exec(text);
        if (m) add({ key, strong: Boolean(rule.strong), text: around(text, m.index, m[0].length) });
      }
    }
    for (const name of p.attachments ?? []) {
      for (const r of ATTACHMENT_RULES) if (r.re.test(name)) add({ key: r.key, strong: true, text: `attachment "${name}"` });
    }
  }
  return out;
}

export interface ClueCheckInput {
  isOrder: boolean;
  orderType: 'development' | 'bulk';
  topics: readonly string[];
}

/**
 * Where the AI's answer disagrees with strong clues. Each item is a short, plain sentence for
 * the person checking. An empty list means the answer and the clues agree.
 */
export function clueConflicts(answer: ClueCheckInput, clues: readonly Clue[]): string[] {
  const strong = (k: ClueKey) => clues.some((c) => c.key === k && c.strong);
  const any = (k: ClueKey) => clues.some((c) => c.key === k);
  const out: string[] = [];
  if (!answer.isOrder) {
    if (strong('bulk') || strong('complaint')) out.push('marked as not an order, but the emails mention an order or a complaint');
    return out;
  }
  if (answer.orderType === 'development' && strong('bulk')) out.push('marked Development, but the emails mention a PO or a bulk order');
  if (answer.orderType === 'bulk' && !any('bulk') && any('development')) out.push('marked Bulk, but no order is mentioned and the emails look like development');
  const labels: Record<string, string> = { complaint: 'a complaint', payment_followup: 'a payment', pp_approval: 'a PP / sample approval', lab_approval: 'a lab test or approval' };
  for (const k of ['complaint', 'payment_followup', 'pp_approval', 'lab_approval'] as const) {
    if (strong(k) && !answer.topics.includes(k)) out.push(`the emails mention ${labels[k]}, but that topic wasn't added`);
  }
  return out;
}

/** Clues as short lines for the prompt. */
export function cluesForPrompt(clues: readonly Clue[]): string {
  if (clues.length === 0) return '(none found)';
  const names: Record<ClueKey, string> = {
    bulk: 'order / bulk',
    development: 'development',
    complaint: 'complaint',
    payment_followup: 'payment',
    pp_approval: 'PP / sample approval',
    lab_approval: 'lab',
  };
  return clues.map((c) => `- ${names[c.key]}${c.strong ? '' : ' (weak)'}: "${c.text}"`).join('\n');
}
