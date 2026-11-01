import { z } from 'zod';
import { BULK_STATUS_KEYS, DEV_STAGE_KEYS, ORDER_TOPIC_KEYS, ORDER_TYPES, SAMPLE_COLLECTED, TRIAGE_CATEGORIES, WAITING_ON } from '../constants';

/**
 * Structured-output schemas. Kept JSON-Schema friendly (no transforms, no numeric bounds):
 * the API enforces the shape, and the worker clamps/normalises values when applying them.
 */
const text = z.string();
const maybe = z.string().nullable();
const isoDate = z.string().nullable().describe('YYYY-MM-DD or null');

export const TriageSchema = z.object({
  category: z.enum(TRIAGE_CATEGORIES),
  is_customer: z.boolean().describe('Sender is a customer or prospective customer of GRC'),
  needs_reply: z.boolean().describe('The sender is waiting for a response or action from GRC'),
  company_name: maybe.describe('Customer company as written in the email, or null'),
  contact_name: maybe,
  confidence: z.number().describe('0 to 1'),
  reason: text.describe('One short sentence'),
});
export type Triage = z.infer<typeof TriageSchema>;

export const DevItemSchema = z.object({
  existing_item_id: maybe.describe('id of an EXISTING development item this refers to, or null if it is new'),
  brand: maybe,
  inquiry: maybe.describe('What the customer wants, in their words: product, width, construction, use'),
  product_code: maybe.describe('Style no. / elastic code, e.g. VHMEL-14A, VH-81, 163-7601-DRA'),
  colours: maybe.describe('Colours / combos, e.g. "7 combos", "Navy/White"'),
  merchant_name: maybe.describe("Customer-side person handling it (the sheet's 'merchant')"),
  enquiry_date: isoDate,
  sample_collected: z.enum(SAMPLE_COLLECTED).nullable().describe('Has GRC received the reference sample/artwork?'),
  grc_rate: maybe.describe('Price GRC quoted, verbatim with unit and terms, e.g. "$0.14/m CIF Colombo"'),
  sample_dispatch_date: isoDate,
  courier: maybe,
  awb: maybe.describe('Courier tracking / AWB number'),
  edd: isoDate.describe('Expected delivery date of the sample, YYYY-MM-DD or null'),
  brand_status: maybe.describe('Colour / quality / test approval status from the customer or brand'),
  team_status: maybe.describe('Short status of where GRC stands, in the style of the sheet: "sample ready on 26 oct", "share the prices"'),
  next_action: maybe.describe('The next concrete thing GRC must do, or null'),
  stage: z.enum(DEV_STAGE_KEYS),
  summary: text.describe('1–3 sentences on this item across the thread'),
  confidence: z.number().describe('0 to 1'),
});
export type DevItemExtraction = z.infer<typeof DevItemSchema>;

export const BulkStageValueSchema = z.object({
  key: text.describe('One of the checklist keys listed in the instructions'),
  value: text.describe('What happened, e.g. "20/01/2025", "Signed copy awaited"'),
  date: isoDate,
});

export const BulkOrderSchema = z.object({
  existing_order_id: maybe.describe('id of an EXISTING bulk order this refers to, or null if it is new'),
  from_dev_item_id: maybe.describe('id of the existing development item this order came from, if any'),
  brand: maybe,
  product_code: maybe,
  description: maybe,
  qty_mtrs: z.number().nullable().describe('Total ordered quantity in metres, or null'),
  pi_number: maybe,
  po_number: maybe,
  status: z.enum(BULK_STATUS_KEYS),
  current_stage: maybe.describe('Checklist key of the latest completed step'),
  stages: z.array(BulkStageValueSchema),
  next_action: maybe,
  summary: text,
  confidence: z.number().describe('0 to 1'),
});
export type BulkOrderExtraction = z.infer<typeof BulkOrderSchema>;

export const ThreadExtractionSchema = z.object({
  thread_category: z.enum(['development', 'bulk', 'mixed', 'other']),
  company: z.object({
    name: maybe.describe('Customer company (the buyer/garment maker), not GRC and not the end brand'),
    city: maybe,
    country: maybe,
  }),
  primary_contact: z.object({ name: maybe, email: maybe }),
  summary: text.describe('3–5 short sentences: what they want, what GRC has done, what is pending, who is waiting'),
  next_action: maybe,
  waiting_on: z.enum(WAITING_ON),
  latest_customer_email_needs_reply: z.boolean(),
  handled_by_email: maybe.describe('GRC staff email that is handling this thread, if clear'),
  dev_items: z.array(DevItemSchema),
  bulk_orders: z.array(BulkOrderSchema),
  confidence: z.number().describe('0 to 1'),
});
export type ThreadExtraction = z.infer<typeof ThreadExtractionSchema>;

export const DirectorySchema = z.object({
  companies: z.array(
    z.object({
      name: text,
      city: maybe,
      country: maybe,
      region: maybe.describe('"Tirupur", "Domestic" or "Export - <Country>"'),
      domains: z.array(text).describe('Business email domains only — never gmail.com, yahoo.com etc.'),
      contact_emails: z.array(text),
    }),
  ),
  team: z.array(z.object({ name: text, email: text, role: maybe })),
  glossary: text.describe('Markdown notes: product codes, abbreviations, brands, how GRC works'),
});
export type Directory = z.infer<typeof DirectorySchema>;

/** Conversation-level sorting: one order type, plus any topics. */
export const ThreadTypeSchema = z.object({
  is_order: z.boolean().describe('true when the conversation is about GRC selling to this customer: an inquiry, sample, order, its approvals, payment or a complaint'),
  order_type: z.enum(ORDER_TYPES).describe('Exactly one. Required even when is_order is false (give the closer fit).'),
  topics: z.array(z.enum(ORDER_TOPIC_KEYS)).describe('Every topic that applies; empty if none'),
  evidence: text.describe('The words from the emails that decided it, quoted briefly (max 30 words)'),
  confidence: z.number().describe('0 to 1: how sure you are of order_type and topics'),
  reason: text.describe('One short sentence a merchandiser would understand'),
});
export type ThreadType = z.infer<typeof ThreadTypeSchema>;
