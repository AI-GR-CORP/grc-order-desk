/**
 * Domain vocabulary shared by the worker, the dashboard and the AI prompts.
 * Stage lists mirror the wording GRC already uses in its customer-portfolio workbook.
 */

export type Tone = 'neutral' | 'waiting' | 'progress' | 'good' | 'alert' | 'muted';

export const DEV_STAGES = [
  { key: 'inquiry_received', label: 'Inquiry received', tone: 'neutral' },
  { key: 'awaiting_reference', label: 'Awaiting reference / artwork', tone: 'waiting' },
  { key: 'reference_received', label: 'Reference received', tone: 'progress' },
  { key: 'under_development', label: 'Under development', tone: 'progress' },
  { key: 'sample_ready', label: 'Sample ready', tone: 'progress' },
  { key: 'sample_dispatched', label: 'Sample dispatched', tone: 'waiting' },
  { key: 'prices_shared', label: 'Prices shared', tone: 'waiting' },
  { key: 'approved', label: 'Approved', tone: 'good' },
  { key: 'rejected_redevelop', label: 'Rejected, redevelop', tone: 'alert' },
  { key: 'converted_to_bulk', label: 'Converted to bulk', tone: 'good' },
  { key: 'on_hold', label: 'On hold', tone: 'muted' },
  { key: 'closed', label: 'Closed', tone: 'muted' },
] as const satisfies readonly { key: string; label: string; tone: Tone }[];

export type DevStage = (typeof DEV_STAGES)[number]['key'];
export const DEV_STAGE_KEYS = DEV_STAGES.map((s) => s.key) as [DevStage, ...DevStage[]];
export const DEV_STAGE_CLOSED: readonly DevStage[] = ['approved', 'converted_to_bulk', 'closed'];

export const BULK_STATUSES = [
  { key: 'open', label: 'Open', tone: 'neutral' },
  { key: 'in_production', label: 'In production', tone: 'progress' },
  { key: 'dispatched', label: 'Dispatched', tone: 'waiting' },
  { key: 'completed', label: 'Completed', tone: 'good' },
  { key: 'on_hold', label: 'On hold', tone: 'muted' },
  { key: 'cancelled', label: 'Cancelled', tone: 'muted' },
] as const satisfies readonly { key: string; label: string; tone: Tone }[];

export type BulkStatus = (typeof BULK_STATUSES)[number]['key'];
export const BULK_STATUS_KEYS = BULK_STATUSES.map((s) => s.key) as [BulkStatus, ...BulkStatus[]];

/** Default checklist heads from "Tripti - Bulk Orders". The live list is the bulk_stage_def table. */
export const DEFAULT_BULK_STAGES = [
  { key: 'pi_sent', label: 'PI Sent' },
  { key: 'pi_approved', label: 'PI Approved' },
  { key: 'po_date', label: 'PO Date' },
  { key: 'po_received', label: 'PO Received Date' },
  { key: 'order_generated', label: 'Order Generated' },
  { key: 'garment_stitching_1', label: 'Garment Stitching Approval' },
  { key: 'garment_washing_1', label: 'Garment Washing Approval' },
  { key: 'garment_fit_1', label: 'Garment Fit Trial Approval' },
  { key: 'delivery_schedule', label: 'Delivery Schedule Approval' },
  { key: 'pp_sample_sent', label: 'PP Sample Sent' },
  { key: 'pp_sample_record', label: 'PP Sample Record' },
  { key: 'pp_sample_approval', label: 'PP Sample Approval' },
  { key: 'garment_stitching_2', label: 'Garment Stitching Approval (post-PP)' },
  { key: 'garment_washing_2', label: 'Garment Washing Approval (post-PP)' },
  { key: 'garment_fit_2', label: 'Garment Fit Trial Approval (post-PP)' },
  { key: 'draft_invoice', label: 'Draft Invoice Approval' },
  { key: 'lc_acceptance', label: 'LC doc approval / bank acceptance' },
] as const;

/** What the triage model may call a single email. */
export const TRIAGE_CATEGORIES = [
  'development',
  'bulk',
  'payment',
  'courier',
  'lab_report',
  'marketing',
  'internal',
  'vendor',
  'other',
] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

/** Thread-level category stored on email_thread.category. */
export const THREAD_CATEGORIES = [
  'unclassified',
  'development',
  'bulk',
  'mixed',
  'payment',
  'other',
  'ignored',
] as const;
export type ThreadCategory = (typeof THREAD_CATEGORIES)[number];

export const TRACKED_CATEGORIES: readonly ThreadCategory[] = ['development', 'bulk', 'mixed'];

/** Orders are only ever one of these two. ("mixed" is a legacy value that re-sorting replaces.) */
export const ORDER_TYPES = ['development', 'bulk'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** What an order conversation is about, shown under its type. Any number may apply. */
export const ORDER_TOPICS = [
  { key: 'complaint', label: 'Complaint' },
  { key: 'payment_followup', label: 'Payment follow-up' },
  { key: 'pp_approval', label: 'PP / sample approval' },
  { key: 'lab_approval', label: 'Lab approval' },
] as const;
export const ORDER_TOPIC_KEYS = ORDER_TOPICS.map((t) => t.key) as unknown as readonly ['complaint', 'payment_followup', 'pp_approval', 'lab_approval'];
export type OrderTopic = (typeof ORDER_TOPICS)[number]['key'];
export const topicLabel = (k: string): string => ORDER_TOPICS.find((t) => t.key === k)?.label ?? k;

/** Outlook "Recall: <subject>" messages are housekeeping, not customer mail. */
export const isRecallSubject = (subject: string | null | undefined): boolean => /^\s*recall\s*:/i.test(subject ?? '');

export const REPLY_STATES = [
  'awaiting',
  'replied',
  'possibly_replied',
  'not_needed',
  'handled_offline',
] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export const WAITING_ON = ['us', 'customer', 'none'] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export const SAMPLE_COLLECTED = ['yes', 'no', 'awaited'] as const;

export function devStageLabel(key: string | null | undefined): string {
  return DEV_STAGES.find((s) => s.key === key)?.label ?? '—';
}

export function devStageTone(key: string | null | undefined): Tone {
  return DEV_STAGES.find((s) => s.key === key)?.tone ?? 'neutral';
}

export function bulkStatusLabel(key: string | null | undefined): string {
  return BULK_STATUSES.find((s) => s.key === key)?.label ?? '—';
}

/**
 * Thread category from the per-message triage results.
 * development + bulk in the same thread => bulk (provisional; the conversation-level sort decides). Anything tracked beats untracked.
 */
export function threadCategoryFromTriage(categories: readonly (TriageCategory | null | undefined)[]): ThreadCategory {
  const set = new Set(categories.filter(Boolean));
  const dev = set.has('development');
  const bulk = set.has('bulk');
  // Provisional only (thread-level sorting decides); an order mentioned anywhere makes it bulk.
  if (dev && bulk) return 'bulk';
  if (dev) return 'development';
  if (bulk) return 'bulk';
  if (set.has('payment')) return 'payment';
  if (set.size === 0) return 'unclassified';
  const onlyNoise = [...set].every((c) => c === 'marketing' || c === 'courier');
  return onlyNoise ? 'ignored' : 'other';
}
