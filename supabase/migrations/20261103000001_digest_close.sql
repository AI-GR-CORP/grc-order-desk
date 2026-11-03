-- =====================================================================
-- A digest per conversation, so GRC can skim every client in minutes
--
-- * brand        : the END brand (G-STAR, LYLE & SCOTT…), never the customer company
-- * points       : at most 5 short pointers on what is going on
-- * customer_status / grc_status : the latest from the customer, and from GRC
-- * is_meeting   : a meeting/call invite; shown inside its brand's subject, not as its own
-- * price_quoted / sample_status / enquiry_ref : for development and order tracking
-- * closed_at    : a person closed the subject / enquiry (a new customer email reopens a subject)
-- Plus: recall emails ("Recall: …") are not tracked, and signature logos are not pictures.
-- =====================================================================

alter table email_thread
  add column brand           text,
  add column points          text[] not null default '{}',
  add column customer_status text,
  add column grc_status      text,
  add column is_meeting      boolean not null default false,
  add column price_quoted    text,
  add column sample_status   text,
  add column enquiry_ref     text,
  add column closed_at       timestamptz,
  add column closed_by       uuid;

alter table dev_item   add column closed_at timestamptz, add column closed_by uuid, add column sample_approval text;
alter table bulk_order add column closed_at timestamptz, add column closed_by uuid;

-- Signature logos: the same sender attaching an image of the exact same size to 3+ different
-- emails is a logo or banner, not a product picture.
alter table attachment add column is_signature boolean not null default false;

create or replace function mark_signature_images() returns int
language sql security definer set search_path = public as $$
  with img as (
    select a.id, a.size_bytes, a.message_id, lower(split_part(m.from_email, '@', 2)) as domain
    from attachment a join email_message m on m.id = a.message_id
    where a.kind = 'image' and a.size_bytes is not null
  ), repeated as (
    select domain, size_bytes from img group by domain, size_bytes having count(distinct message_id) >= 3
  ), upd as (
    update attachment a set is_signature = true
    from img join repeated r using (domain, size_bytes)
    where a.id = img.id and not a.is_signature
    returning a.id
  )
  select count(*)::int from upd
$$;
revoke execute on function mark_signature_images() from public, anon, authenticated;
select mark_signature_images();
-- Email pictures that were logos come off the rows.
update row_picture p set hidden = true
from attachment a where a.id = p.attachment_id and a.is_signature and not p.hidden;

-- Recall emails ("Recall: …") are Outlook housekeeping, not customer mail.
update email_message
   set triage = coalesce(triage, '{}'::jsonb) || '{"category":"other","is_customer":false,"needs_reply":false,"reason":"Message recall"}'::jsonb
 where subject ~* '^\s*recall\s*:';
update email_thread t set category = 'ignored', category_locked = true
 where not exists (select 1 from email_message m where m.thread_id = t.id and coalesce(m.subject, '') !~* '^\s*recall\s*:')
   and exists (select 1 from email_message m where m.thread_id = t.id);

-- Sheet rows: brand from the conversation, the digest, and closed rows.
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
  coalesce(d.closed_at, case when d.stage = 'closed' then coalesce(d.last_activity_at, d.created_at) end) as closed_at
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
  coalesce(b.closed_at, case when b.status in ('completed','cancelled') then coalesce(b.last_activity_at, b.created_at) end)
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
  t.is_meeting, t.price_quoted, t.sample_status, t.enquiry_ref, t.closed_at
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
