-- =====================================================================
-- Sheet rows: one row per line of GRC's spreadsheet, for the sheet-style screens.
--
--   source = 'item'   a development item (the AI or a person filled the columns)
--   source = 'bulk'   a bulk order
--   source = 'thread' a development/bulk conversation that isn't an item yet,
--                     e.g. every conversation of a client waiting for approval
--
-- Every page (New clients, Development, a client's page) reads this one view, so a
-- client's three email conversations show as three rows under its company name.
-- =====================================================================

create view v_sheet_rows with (security_invoker = true) as
with msg as (
  select thread_id, count(*)::int as n from email_message group by thread_id
)
-- Development items
select
  'dev:' || d.id::text              as row_id,
  'item'::text                      as source,
  'development'::text               as row_kind,
  d.id                              as item_id,
  d.company_id,
  c.name                            as company_name,
  c.city                            as company_city,
  c.region                          as company_region,
  c.approval::text                  as company_approval,
  d.merchant_name                   as merchant,
  d.brand,
  d.inquiry,
  d.sample_collected,
  d.team_status,
  d.brand_status,
  d.owner_remark,
  d.stage::text                     as stage,
  d.locked_fields,
  d.summary,
  d.enquiry_date,
  d.product_code,
  d.colours,
  d.grc_rate,
  d.sample_dispatch_date,
  d.awb,
  d.edd,
  d.next_action,
  null::text                        as po_number,
  null::numeric                     as qty_mtrs,
  t.id                              as thread_id,
  t.subject                         as thread_subject,
  t.reply_state::text               as reply_state,
  t.waiting_on,
  t.reply_due_at,
  t.gmail_thread_id,
  mb.email                          as mailbox_email,
  coalesce(msg.n, 0)                as email_count,
  (select count(*) from item_thread it where it.dev_item_id = d.id)::int as thread_count,
  (t.id is null or t.extracted_through is not null) as is_read,
  coalesce(t.last_message_at, d.last_activity_at, d.created_at) as last_at,
  d.source                          as origin,
  d.created_at
from dev_item d
left join company c       on c.id  = d.company_id
left join email_thread t  on t.id  = d.primary_thread_id
left join mailbox mb      on mb.id = t.mailbox_id
left join msg             on msg.thread_id = t.id

union all

-- Bulk orders
select
  'bulk:' || b.id::text,
  'bulk',
  'bulk',
  b.id,
  b.company_id,
  c.name,
  c.city,
  c.region,
  c.approval::text,
  null::text,
  b.brand,
  coalesce(b.description, b.product_code),
  null::text,
  null::text,
  null::text,
  b.owner_remark,
  b.status::text,
  b.locked_fields,
  b.summary,
  null::date,
  b.product_code,
  null::text,
  null::text,
  null::date,
  null::text,
  null::date,
  b.next_action,
  b.po_number,
  b.qty_mtrs,
  t.id,
  t.subject,
  t.reply_state::text,
  t.waiting_on,
  t.reply_due_at,
  t.gmail_thread_id,
  mb.email,
  coalesce(msg.n, 0),
  (select count(*) from item_thread it where it.bulk_order_id = b.id)::int,
  (t.id is null or t.extracted_through is not null),
  coalesce(t.last_message_at, b.last_activity_at, b.created_at),
  b.source,
  b.created_at
from bulk_order b
left join company c       on c.id  = b.company_id
left join email_thread t  on t.id  = b.primary_thread_id
left join mailbox mb      on mb.id = t.mailbox_id
left join msg             on msg.thread_id = t.id

union all

-- Development/bulk conversations that aren't an item yet
select
  'thread:' || t.id::text,
  'thread',
  t.category::text,
  null::uuid,
  t.company_id,
  c.name,
  c.city,
  c.region,
  c.approval::text,
  coalesce(fi.from_name, split_part(fi.from_email, '@', 1)),
  null::text,
  t.subject,
  null::text,
  null::text,
  null::text,
  null::text,
  null::text,
  '{}'::text[],
  coalesce(t.summary, fi.triage->>'reason'),
  t.first_message_at::date,
  null::text,
  null::text,
  null::text,
  null::date,
  null::text,
  null::date,
  t.next_action,
  null::text,
  null::numeric,
  t.id,
  t.subject,
  t.reply_state::text,
  t.waiting_on,
  t.reply_due_at,
  t.gmail_thread_id,
  mb.email,
  coalesce(msg.n, 0),
  1,
  t.extracted_through is not null,
  t.last_message_at,
  'email',
  t.created_at
from email_thread t
join mailbox mb           on mb.id = t.mailbox_id
left join company c       on c.id  = t.company_id
left join msg             on msg.thread_id = t.id
left join lateral (
  select from_name, from_email, triage from email_message
  where thread_id = t.id and direction = 'inbound' order by sent_at limit 1
) fi on true
where t.category in ('development', 'bulk', 'mixed')
  and not exists (select 1 from item_thread it where it.thread_id = t.id)
  and not exists (select 1 from dev_item d where d.primary_thread_id = t.id)
  and not exists (select 1 from bulk_order b where b.primary_thread_id = t.id);

grant select on v_sheet_rows to authenticated;
revoke all on v_sheet_rows from anon;
