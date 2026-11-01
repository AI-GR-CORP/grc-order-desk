import type { BulkStatus, DevStage, ReplyState, ThreadCategory, WaitingOn } from './constants';

/** Row shapes of the main tables/views. Dates arrive as ISO strings through supabase-js. */

export interface CompanyRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  domains: string[];
  merged_into: string | null;
  needs_review: boolean;
  approval: ClientApproval;
  created_at: string;
}

export type ClientApproval = 'pending' | 'approved' | 'rejected';

/** v_client_queue: one row per client with development/bulk conversations. */
export interface ClientQueueRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  domains: string[];
  approval: ClientApproval;
  approval_at: string | null;
  tracked_threads: number;
  dev_threads: number;
  bulk_threads: number;
  mixed_threads: number;
  awaiting_reply: number;
  read_threads: number;
  email_count: number;
  first_at: string | null;
  last_at: string | null;
  contact_count: number;
}

/** v_thread_brief: a conversation summarised from its first and last email (no AI needed). */
export interface ThreadBriefRow {
  id: string;
  company_id: string | null;
  mailbox_id: string;
  mailbox_email: string | null;
  gmail_thread_id: string;
  subject: string | null;
  category: ThreadCategory;
  reply_state: ReplyState | null;
  summary: string | null;
  extracted_through: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  email_count: number;
  first_from_name: string | null;
  first_from_email: string | null;
  first_snippet: string | null;
  first_reason: string | null;
  company_guess: string | null;
  last_from_name: string | null;
  last_from_email: string | null;
  last_direction: 'inbound' | 'outbound' | 'internal' | null;
  last_snippet: string | null;
}

export interface TeamMemberRow {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  active: boolean;
}

export interface ThreadRow {
  id: string;
  mailbox_id: string;
  gmail_thread_id: string;
  subject: string | null;
  company_id: string | null;
  category: ThreadCategory;
  category_locked: boolean;
  topics: string[];
  topics_locked: boolean;
  type_confidence: number | null;
  type_reason: string | null;
  type_needs_check: boolean;
  type_checked_at: string | null;
  classified_at: string | null;
  company_locked: boolean;
  handled_by: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  reply_state: ReplyState | null;
  awaiting_reply_since: string | null;
  reply_due_at: string | null;
  snoozed_until: string | null;
  handled_offline_at: string | null;
  handled_offline_note: string | null;
  summary: string | null;
  next_action: string | null;
  waiting_on: WaitingOn | null;
  ai_confidence: number | null;
  needs_review: boolean;
  ai_updated_at: string | null;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  gmail_message_id: string;
  sent_at: string;
  direction: 'inbound' | 'outbound' | 'internal';
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_clean: string | null;
  needs_reply: boolean | null;
  triage: { category?: string; reason?: string } | null;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  kind: string | null;
  thumbnail_path: string | null;
}

export interface DevItemRow {
  id: string;
  company_id: string | null;
  primary_thread_id: string | null;
  enquiry_date: string | null;
  merchant_name: string | null;
  brand: string | null;
  inquiry: string | null;
  product_code: string | null;
  colours: string | null;
  sample_collected: string | null;
  grc_rate: string | null;
  sample_dispatch_date: string | null;
  courier: string | null;
  awb: string | null;
  edd: string | null;
  brand_status: string | null;
  team_status: string | null;
  next_action: string | null;
  owner_remark: string | null;
  summary: string | null;
  stage: DevStage;
  handled_by: string | null;
  last_activity_at: string | null;
  last_follow_up: string | null;
  locked_fields: string[];
  source: 'ai' | 'manual' | 'sheet_import';
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
}

/** v_dev_items: dev_item + company/team/thread context for the table. */
export interface DevItemView extends DevItemRow {
  company_name: string | null;
  company_region: string | null;
  company_city: string | null;
  handled_by_name: string | null;
  thread_subject: string | null;
  thread_reply_state: ReplyState | null;
  thread_waiting_on: WaitingOn | null;
  thread_count: number;
}

export interface BulkOrderRow {
  id: string;
  company_id: string | null;
  primary_thread_id: string | null;
  dev_item_id: string | null;
  brand: string | null;
  product_code: string | null;
  description: string | null;
  qty_mtrs: number | null;
  pi_number: string | null;
  po_number: string | null;
  status: BulkStatus;
  current_stage: string | null;
  next_action: string | null;
  owner_remark: string | null;
  summary: string | null;
  handled_by: string | null;
  last_activity_at: string | null;
  locked_fields: string[];
  source: 'ai' | 'manual' | 'sheet_import';
  created_at: string;
  updated_at: string;
}

export interface BulkOrderView extends BulkOrderRow {
  company_name: string | null;
  company_region: string | null;
  handled_by_name: string | null;
  /** stage_key → { value, done_on, locked } */
  stages: Record<string, { value: string | null; done_on: string | null; locked: boolean }>;
}

export interface BulkStageDefRow {
  key: string;
  label: string;
  sort_order: number;
  optional: boolean;
}

export interface NeedsReplyRow {
  id: string;
  subject: string | null;
  category: ThreadCategory;
  reply_state: ReplyState;
  company_id: string | null;
  company: string | null;
  handled_by: string | null;
  awaiting_reply_since: string;
  reply_due_at: string | null;
  summary: string | null;
  next_action: string | null;
  gmail_thread_id: string;
  mailbox_email: string;
}

export interface MailboxStatusRow {
  id: string;
  email: string;
  status: 'pending' | 'backfilling' | 'active' | 'needs_reconnect' | 'paused';
  backfill_stage: string | null;
  backfill_progress: Record<string, unknown> | null;
  last_synced_at: string | null;
  last_error: string | null;
  backfill_target: number;
}
