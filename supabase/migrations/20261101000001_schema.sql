-- =====================================================================
-- GR Corporation · Email Tracker — schema
-- Verelios Labs
--
-- Layout mirrors GRC's "customer portfolio" workbook:
--   dev_item      = one row of NEW INQUIRY / Export / tirupur / Vanhusen / srilanka tabs
--   bulk_order    = one column of "Tripti - Bulk Orders" (checklist heads -> bulk_stage_def)
--   company.region replaces the per-region tabs; "NON moving" is a view (v_non_moving).
-- The worker writes with the service role; the dashboard reads/edits under RLS (0002_security.sql).
-- =====================================================================

create extension if not exists pgcrypto;

create type thread_category as enum ('unclassified','development','bulk','mixed','payment','other','ignored');
create type msg_direction   as enum ('inbound','outbound','internal');
create type reply_state     as enum ('awaiting','replied','possibly_replied','not_needed','handled_offline');
create type dev_stage as enum (
  'inquiry_received','awaiting_reference','reference_received','under_development','sample_ready',
  'sample_dispatched','prices_shared','approved','rejected_redevelop','converted_to_bulk','on_hold','closed'
);
create type bulk_status as enum ('open','in_production','dispatched','completed','on_hold','cancelled');

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
create table app_setting (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_setting (key, value) values
  ('reply_sla_minutes', '60'),
  ('realert_minutes',   '30'),
  ('business_hours',    '{"tz":"Asia/Kolkata","days":[1,2,3,4,5,6],"start":"10:00","end":"19:00","holidays":[]}'),
  ('non_moving_days',   '21'),
  ('internal_domains',  '["grcorporation.co.in","grcorporation.com"]'),
  ('freemail_domains',  '["gmail.com","yahoo.com","yahoo.co.in","outlook.com","hotmail.com","rediffmail.com","icloud.com"]'),
  ('login_domains',     '["grcorporation.co.in"]'),
  ('owner_emails',      '[]'),
  ('ai_models',         '{"triage":"claude-haiku-5-5","extract":"claude-sonnet-5-5","discovery":"claude-sonnet-5-5"}'),
  ('column_labels',     '{}');

-- ---------------------------------------------------------------------
-- People & companies
-- ---------------------------------------------------------------------
create table team_member (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text unique check (email is null or email = lower(email)),
  role       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table company (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_key     text not null,              -- companyKey(name), maintained by the app
  city         text,
  country      text,
  region       text,
  domains      text[] not null default '{}',
  merged_into  uuid references company(id) on delete set null,
  needs_review boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index company_domains_idx on company using gin (domains);
create index company_name_key_idx on company (name_key) where merged_into is null;
create trigger company_updated before update on company for each row execute function set_updated_at();

create table contact (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references company(id) on delete set null,
  name       text,
  email      text not null unique check (email = lower(email)),
  role       text,
  created_at timestamptz not null default now()
);
create index contact_company_idx on contact (company_id);

-- ---------------------------------------------------------------------
-- Mailbox & mail
-- ---------------------------------------------------------------------
create table mailbox (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  refresh_token_enc text,                   -- AES-256-GCM; never granted to dashboard users
  history_id        text,                   -- Gmail checkpoint for incremental sync
  status            text not null default 'pending'
                    check (status in ('pending','backfilling','active','needs_reconnect','paused')),
  backfill_stage    text not null default 'pending'
                    check (backfill_stage in ('pending','ingesting','triaging','discovery','awaiting_review','extracting','done')),
  backfill_progress jsonb not null default '{}',
  backfill_target   int not null default 1000,
  connected_by      uuid,
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);

create table email_thread (
  id                   uuid primary key default gen_random_uuid(),
  mailbox_id           uuid not null references mailbox(id) on delete cascade,
  gmail_thread_id      text not null,
  subject              text,
  company_id           uuid references company(id) on delete set null,
  company_locked       boolean not null default false,
  category             thread_category not null default 'unclassified',
  category_locked      boolean not null default false,
  handled_by           uuid references team_member(id) on delete set null,
  first_message_at     timestamptz,
  last_message_at      timestamptz,
  last_inbound_at      timestamptz,
  last_outbound_at     timestamptz,
  reply_state          reply_state,
  awaiting_reply_since timestamptz,
  reply_due_at         timestamptz,
  snoozed_until        timestamptz,
  handled_offline_at   timestamptz,
  handled_offline_note text,
  summary              text,
  next_action          text,
  waiting_on           text check (waiting_on in ('us','customer','none')),
  ai_state             jsonb,               -- last extraction output (for incremental runs & audit)
  extracted_through    timestamptz,         -- sent_at of the newest message the AI has seen
  ai_confidence        real,
  needs_review         boolean not null default false,
  ai_updated_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (mailbox_id, gmail_thread_id)
);
create index email_thread_company_idx on email_thread (company_id);
create index email_thread_category_idx on email_thread (category);
create index email_thread_due_idx on email_thread (reply_due_at) where reply_state = 'awaiting';
create index email_thread_last_msg_idx on email_thread (last_message_at desc);
create trigger email_thread_updated before update on email_thread for each row execute function set_updated_at();

create table email_message (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references email_thread(id) on delete cascade,
  gmail_message_id text not null unique,
  rfc_message_id   text,
  sent_at          timestamptz not null,
  direction        msg_direction not null,
  from_email       text not null,
  from_name        text,
  to_emails        text[] not null default '{}',
  cc_emails        text[] not null default '{}',
  label_ids        text[] not null default '{}',
  subject          text,
  snippet          text,
  body_clean       text,
  triage           jsonb,
  needs_reply      boolean,
  triaged_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index email_message_thread_idx on email_message (thread_id, sent_at);
create index email_message_from_idx on email_message (from_email);
create index email_message_untriaged_idx on email_message (created_at) where triaged_at is null and direction = 'inbound';
create index email_message_outbound_to_idx on email_message using gin (to_emails) where direction = 'outbound';

create table attachment (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid not null references email_message(id) on delete cascade,
  part_id             text not null,        -- stable; Gmail attachment ids change between fetches
  gmail_attachment_id text not null,
  filename            text,
  mime_type           text,
  size_bytes          int,
  inline              boolean not null default false,
  kind                text check (kind in ('image','pi','po','test_report','other')),
  thumbnail_path      text,
  unique (message_id, part_id)
);

-- ---------------------------------------------------------------------
-- Development items
-- ---------------------------------------------------------------------
create table dev_item (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid references company(id) on delete set null,
  primary_thread_id    uuid references email_thread(id) on delete set null,
  enquiry_date         date,
  merchant_contact_id  uuid references contact(id) on delete set null,
  merchant_name        text,
  brand                text,
  inquiry              text,
  product_code         text,
  colours              text,
  sample_collected     text,
  grc_rate             text,
  sample_dispatch_date date,
  courier              text,
  awb                  text,
  edd                  date,
  brand_status         text,
  team_status          text,               -- was "Status of Poornima" / "Aquib Status"
  next_action          text,               -- was "Work to be done" / "Aquib to do"
  owner_remark         text,               -- was "Yash remark": people only, AI never writes it
  summary              text,
  stage                dev_stage not null default 'inquiry_received',
  handled_by           uuid references team_member(id) on delete set null,
  last_activity_at     timestamptz,
  last_follow_up       date,
  locked_fields        text[] not null default '{}',
  converted_to_bulk_id uuid,
  source               text not null default 'ai' check (source in ('ai','manual','sheet_import')),
  sheet_ref            text unique,        -- "NEW INQUIRY!12" for imported rows
  ai_confidence        real,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index dev_item_company_idx on dev_item (company_id);
create index dev_item_stage_idx on dev_item (stage);
create trigger dev_item_updated before update on dev_item for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Bulk orders
-- ---------------------------------------------------------------------
create table bulk_stage_def (
  key        text primary key,
  label      text not null,
  sort_order int  not null,
  optional   boolean not null default false
);

insert into bulk_stage_def (key, label, sort_order, optional) values
  ('pi_sent',             'PI Sent',                               10, false),
  ('pi_approved',         'PI Approved',                           20, false),
  ('po_date',             'PO Date',                               30, false),
  ('po_received',         'PO Received Date',                      40, false),
  ('order_generated',     'Order Generated',                       50, false),
  ('garment_stitching_1', 'Garment Stitching Approval',            60, true),
  ('garment_washing_1',   'Garment Washing Approval',              70, true),
  ('garment_fit_1',       'Garment Fit Trial Approval',            80, true),
  ('delivery_schedule',   'Delivery Schedule Approval',            90, false),
  ('pp_sample_sent',      'PP Sample Sent',                       100, false),
  ('pp_sample_record',    'PP Sample Record',                     110, true),
  ('pp_sample_approval',  'PP Sample Approval',                   120, false),
  ('garment_stitching_2', 'Garment Stitching Approval (post-PP)', 130, true),
  ('garment_washing_2',   'Garment Washing Approval (post-PP)',   140, true),
  ('garment_fit_2',       'Garment Fit Trial Approval (post-PP)', 150, true),
  ('draft_invoice',       'Draft Invoice Approval',               160, false),
  ('lc_acceptance',       'LC doc approval / bank acceptance',    170, true);

create table bulk_order (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references company(id) on delete set null,
  primary_thread_id uuid references email_thread(id) on delete set null,
  dev_item_id       uuid references dev_item(id) on delete set null,
  brand             text,
  product_code      text,
  description       text,
  qty_mtrs          numeric,
  pi_number         text,
  po_number         text,
  status            bulk_status not null default 'open',
  current_stage     text references bulk_stage_def(key),
  next_action       text,
  owner_remark      text,
  summary           text,
  handled_by        uuid references team_member(id) on delete set null,
  last_activity_at  timestamptz,
  locked_fields     text[] not null default '{}',
  source            text not null default 'ai' check (source in ('ai','manual','sheet_import')),
  sheet_ref         text unique,
  ai_confidence     real,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index bulk_order_company_idx on bulk_order (company_id);
create trigger bulk_order_updated before update on bulk_order for each row execute function set_updated_at();

alter table dev_item
  add constraint dev_item_converted_to_bulk_fk foreign key (converted_to_bulk_id) references bulk_order(id) on delete set null;

create table bulk_order_stage (
  bulk_order_id       uuid not null references bulk_order(id) on delete cascade,
  stage_key           text not null references bulk_stage_def(key) on update cascade,
  value               text,
  done_on             date,
  source              text not null default 'ai' check (source in ('ai','manual','sheet_import')),
  locked              boolean not null default false,
  evidence_message_id uuid references email_message(id) on delete set null,
  updated_at          timestamptz not null default now(),
  primary key (bulk_order_id, stage_key)
);
create trigger bulk_order_stage_updated before update on bulk_order_stage for each row execute function set_updated_at();

create table item_thread (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references email_thread(id) on delete cascade,
  dev_item_id   uuid references dev_item(id) on delete cascade,
  bulk_order_id uuid references bulk_order(id) on delete cascade,
  check (num_nonnulls(dev_item_id, bulk_order_id) = 1)
);
create unique index item_thread_dev_uq  on item_thread (thread_id, dev_item_id)   where dev_item_id is not null;
create unique index item_thread_bulk_uq on item_thread (thread_id, bulk_order_id) where bulk_order_id is not null;
create index item_thread_dev_idx  on item_thread (dev_item_id);
create index item_thread_bulk_idx on item_thread (bulk_order_id);

-- ---------------------------------------------------------------------
-- Learning loop, AI accounting, job queue
-- ---------------------------------------------------------------------
create table knowledge_profile (
  version    int primary key,
  content    text not null,
  active     boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index knowledge_profile_one_active on knowledge_profile (active) where active;

create table correction (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null check (entity in ('dev_item','bulk_order','bulk_order_stage','email_thread','company','contact')),
  entity_id    uuid not null,
  field        text not null,
  ai_value     text,
  human_value  text,
  corrected_by uuid,
  created_at   timestamptz not null default now()
);
create index correction_created_idx on correction (created_at desc);

create table ai_run (
  id                 uuid primary key default gen_random_uuid(),
  purpose            text not null check (purpose in ('triage','extract','discovery','eval')),
  model              text not null,
  thread_id          uuid references email_thread(id) on delete set null,
  batch_id           text,
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cache_write_tokens int,
  cost_usd           numeric(12,6),
  ok                 boolean not null default true,
  error              text,
  created_at         timestamptz not null default now()
);
create index ai_run_created_idx on ai_run (created_at);

create table job (
  id           bigserial primary key,
  kind         text not null check (kind in ('backfill','extract_backfill','sync','reprocess_thread')),
  mailbox_id   uuid references mailbox(id) on delete cascade,
  payload      jsonb not null default '{}',
  dedupe_key   text,
  priority     int not null default 0,
  status       text not null default 'queued' check (status in ('queued','running','done','failed')),
  run_after    timestamptz not null default now(),
  locked_until timestamptz,
  attempts     int not null default 0,
  max_attempts int not null default 5,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index job_claim_idx on job (status, priority desc, run_after);
create unique index job_dedupe_active on job (dedupe_key) where dedupe_key is not null and status in ('queued','running');
create trigger job_updated before update on job for each row execute function set_updated_at();

create table app_user (
  user_id        uuid primary key,
  email          text,
  team_member_id uuid references team_member(id) on delete set null,
  role           text not null default 'staff' check (role in ('owner','staff','admin')),
  created_at     timestamptz not null default now()
);

-- Rows imported from GRC's existing workbook, kept untouched so the AI can be scored against them.
create table sheet_baseline (
  id           uuid primary key default gen_random_uuid(),
  sheet_ref    text not null unique,
  kind         text not null check (kind in ('dev','bulk')),
  tab          text not null,
  company_name text,
  data         jsonb not null,
  imported_at  timestamptz not null default now()
);
