-- =====================================================================
-- One row per enquiry
--
-- * title              : a short heading for the enquiry (the only thing in the Inquiry column)
-- * customer_status_on : date of the customer email that "Customer reply" describes
-- * grc_status_on      : date of the GRC email that "GRC reply" describes
-- =====================================================================

alter table email_thread
  add column title              text,
  add column customer_status_on date,
  add column grc_status_on      date;

create or replace view v_sheet_rows with (security_invoker = true) as
with msg as (
  select thread_id, count(*)::int as n from email_message group by thread_id
)
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
  coalesce(d.brand, t.brand)        as brand,
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
  d.created_at,
  coalesce(t.topics, '{}'::text[])  as topics,
  t.type_confidence,
  coalesce(t.type_needs_check, false) as type_needs_check,
  t.type_checked_at,
  t.type_reason,
  coalesce(t.points, '{}'::text[])  as points,
  t.customer_status,
  t.grc_status,
  t.last_inbound_at                 as last_in_at,
  t.last_outbound_at                as last_out_at,
  coalesce(t.is_meeting, false)     as is_meeting,
  coalesce(d.grc_rate, t.price_quoted) as price_quoted,
  coalesce(d.sample_approval, t.sample_status) as sample_status,
  t.enquiry_ref,
  coalesce(d.closed_at, case when d.stage = 'closed' then coalesce(d.last_activity_at, d.created_at) end) as closed_at,
  t.title                           as title,
  t.customer_status_on              as customer_on,
  t.grc_status_on                   as grc_on
from dev_item d
left join company c       on c.id  = d.company_id
left join email_thread t  on t.id  = d.primary_thread_id
left join mailbox mb      on mb.id = t.mailbox_id
left join msg             on msg.thread_id = t.id

union all

select
  'bulk:' || b.id::text, 'bulk', 'bulk', b.id, b.company_id, c.name, c.city, c.region, c.approval::text,
  null::text, coalesce(b.brand, t.brand), coalesce(b.description, b.product_code), null::text, null::text, null::text, b.owner_remark,
  b.status::text, b.locked_fields, b.summary, null::date, b.product_code, null::text, null::text,
  null::date, null::text, null::date, b.next_action, b.po_number, b.qty_mtrs,
  t.id, t.subject, t.reply_state::text, t.waiting_on, t.reply_due_at, t.gmail_thread_id, mb.email,
  coalesce(msg.n, 0),
  (select count(*) from item_thread it where it.bulk_order_id = b.id)::int,
  (t.id is null or t.extracted_through is not null),
  coalesce(t.last_message_at, b.last_activity_at, b.created_at),
  b.source, b.created_at,
  coalesce(t.topics, '{}'::text[]), t.type_confidence, coalesce(t.type_needs_check, false), t.type_checked_at, 
  t.type_reason,
  coalesce(t.points, '{}'::text[]), t.customer_status, t.grc_status, t.last_inbound_at, t.last_outbound_at,
  coalesce(t.is_meeting, false), t.price_quoted, t.sample_status, t.enquiry_ref,
  coalesce(b.closed_at, case when b.status in ('completed','cancelled') then coalesce(b.last_activity_at, b.created_at) end),
  t.title, t.customer_status_on, t.grc_status_on
from bulk_order b
left join company c       on c.id  = b.company_id
left join email_thread t  on t.id  = b.primary_thread_id
left join mailbox mb      on mb.id = t.mailbox_id
left join msg             on msg.thread_id = t.id

union all

select
  'thread:' || t.id::text, 'thread', t.category::text, null::uuid, t.company_id, c.name, c.city, c.region, c.approval::text,
  coalesce(fi.from_name, split_part(fi.from_email, '@', 1)), t.brand, t.subject, null::text, null::text, null::text, null::text,
  null::text, '{}'::text[], coalesce(t.summary, fi.triage->>'reason'), t.first_message_at::date, null::text, null::text, null::text,
  null::date, null::text, null::date, t.next_action, null::text, null::numeric,
  t.id, t.subject, t.reply_state::text, t.waiting_on, t.reply_due_at, t.gmail_thread_id, mb.email,
  coalesce(msg.n, 0), 1, t.extracted_through is not null, t.last_message_at, 'email', t.created_at,
  t.topics, t.type_confidence, t.type_needs_check, t.type_checked_at, t.type_reason,
  t.points, t.customer_status, t.grc_status, t.last_inbound_at, t.last_outbound_at,
  t.is_meeting, t.price_quoted, t.sample_status, t.enquiry_ref, t.closed_at,
  t.title, t.customer_status_on, t.grc_status_on
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
