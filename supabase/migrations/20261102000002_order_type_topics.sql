-- =====================================================================
-- Order type and topics
--
-- Every order conversation is exactly one type: development or bulk (no more "mixed").
-- Topics say what it's about, shown under the type: complaint, payment follow-up,
-- PP / sample approval, lab approval (any number of them).
--
-- A person can switch the type or topics, or confirm the AI got it right. Either way the
-- conversation is locked (the AI never changes it again) and every change is saved as a
-- correction that the AI reads before sorting the next conversations.
-- =====================================================================

alter table email_thread
  add column topics           text[] not null default '{}',
  add column topics_locked    boolean not null default false,
  add column type_confidence  real,
  add column type_reason      text,
  add column type_needs_check boolean not null default false,
  add column type_checked_at  timestamptz,
  add column type_checked_by  uuid,
  add column classified_at    timestamptz;

alter table email_thread add constraint email_thread_topics_check
  check (topics <@ array['complaint','payment_followup','pp_approval','lab_approval']::text[]);

create index email_thread_needs_check_idx on email_thread (type_needs_check) where type_needs_check;

-- Corrections keep a snapshot of what the conversation was about, so the lesson survives later edits.
alter table correction add column context text;

alter table ai_run drop constraint if exists ai_run_purpose_check;
alter table ai_run add constraint ai_run_purpose_check
  check (purpose in ('triage','extract','discovery','eval','classify'));

alter table job drop constraint if exists job_kind_check;
alter table job add constraint job_kind_check
  check (kind in ('backfill','extract_backfill','extract_company','classify_backfill','sync','reprocess_thread'));

-- The model that decides type and topics (accuracy matters most here).
update app_setting
   set value = value || jsonb_build_object('classify', coalesce(value->>'classify', 'claude-sonnet-5-5'))
 where key = 'ai_models';

create or replace function enqueue_job(
  p_kind text, p_mailbox uuid, p_payload jsonb default '{}'::jsonb, p_dedupe text default null, p_priority int default 0
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  if p_kind not in ('reprocess_thread','extract_backfill','extract_company','classify_backfill','backfill') then raise exception 'unknown job kind'; end if;
  if p_kind <> 'reprocess_thread' and not is_app_admin() then raise exception 'owners only'; end if;
  insert into job (kind, mailbox_id, payload, dedupe_key, priority)
  values (p_kind, p_mailbox, coalesce(p_payload, '{}'::jsonb), p_dedupe, p_priority)
  on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
  returning id into v_id;
  return v_id is not null;
end $$;
revoke execute on function enqueue_job(text, uuid, jsonb, text, int) from public, anon;

-- ---------------------------------------------------------------------
-- When a conversation's type changes, its rows follow: rows the AI made are removed (the AI
-- re-reads the conversation as the right type); rows a person edited are converted, keeping
-- what they typed. Internal: used by the dashboard function below and by the worker.
-- ---------------------------------------------------------------------
create or replace function retype_thread_items(p_thread uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare
  d dev_item%rowtype;
  b bulk_order%rowtype;
  v_new uuid;
begin
  if p_type = 'bulk' then
    for d in select * from dev_item where primary_thread_id = p_thread loop
      if d.source = 'ai' and cardinality(d.locked_fields) = 0 then
        delete from dev_item where id = d.id;
      else
        insert into bulk_order (company_id, primary_thread_id, brand, product_code, description, next_action, owner_remark, summary, source, locked_fields)
        values (d.company_id, d.primary_thread_id, d.brand, d.product_code, coalesce(d.inquiry, d.product_code), d.next_action, d.owner_remark, d.summary, 'manual',
                array(select case when f = 'inquiry' then 'description' else f end from unnest(d.locked_fields) f
                      where f in ('brand','product_code','inquiry','next_action','owner_remark')))
        returning id into v_new;
        insert into item_thread (thread_id, bulk_order_id) values (p_thread, v_new) on conflict do nothing;
        delete from dev_item where id = d.id;
      end if;
    end loop;
  elsif p_type = 'development' then
    for b in select * from bulk_order where primary_thread_id = p_thread loop
      if b.source = 'ai' and cardinality(b.locked_fields) = 0 then
        delete from bulk_order where id = b.id;
      else
        insert into dev_item (company_id, primary_thread_id, brand, product_code, inquiry, next_action, owner_remark, summary, source, locked_fields)
        values (b.company_id, b.primary_thread_id, b.brand, b.product_code, coalesce(b.description, b.product_code), b.next_action, b.owner_remark, b.summary, 'manual',
                array(select case when f = 'description' then 'inquiry' else f end from unnest(b.locked_fields) f
                      where f in ('brand','product_code','description','next_action','owner_remark')))
        returning id into v_new;
        insert into item_thread (thread_id, dev_item_id) values (p_thread, v_new) on conflict do nothing;
        delete from bulk_order where id = b.id;
      end if;
    end loop;
  end if;
end $$;
revoke execute on function retype_thread_items(uuid, text) from public, anon, authenticated;

create or replace function thread_context(p_thread uuid) returns text
language sql stable security definer set search_path = public as $$
  select left(concat_ws(' | ',
           c.name,
           t.subject,
           (select left(regexp_replace(coalesce(m.body_clean, m.snippet, ''), '\s+', ' ', 'g'), 240)
              from email_message m where m.thread_id = t.id and m.direction = 'inbound' order by m.sent_at limit 1)), 500)
  from email_thread t left join company c on c.id = t.company_id
  where t.id = p_thread
$$;
revoke execute on function thread_context(uuid) from public, anon, authenticated;

/** A person sets the type (and topics) of one conversation. */
create or replace function set_thread_type(p_thread uuid, p_type text, p_topics text[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_topics text[];
  v_old_topics text[];
  v_ctx text;
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  if p_type not in ('development','bulk') then raise exception 'The type must be Development or Bulk.'; end if;

  select th.id, th.category::text as category, th.topics, th.mailbox_id, th.company_id, c.approval as company_approval
    into t
    from email_thread th left join company c on c.id = th.company_id
   where th.id = p_thread
   for update of th;
  if not found then raise exception 'Conversation not found.'; end if;

  v_topics := coalesce(p_topics, t.topics, '{}');
  if not (v_topics <@ array['complaint','payment_followup','pp_approval','lab_approval']::text[]) then
    raise exception 'Unknown topic.';
  end if;
  v_topics := array(select distinct x from unnest(v_topics) x order by x);
  v_old_topics := array(select distinct x from unnest(coalesce(t.topics, '{}')) x order by x);
  v_ctx := thread_context(p_thread);

  if t.category is distinct from p_type then
    insert into correction (entity, entity_id, field, ai_value, human_value, corrected_by, context)
    values ('email_thread', p_thread, 'order_type', t.category, p_type, auth.uid(), v_ctx);
  end if;
  if v_old_topics is distinct from v_topics then
    insert into correction (entity, entity_id, field, ai_value, human_value, corrected_by, context)
    values ('email_thread', p_thread, 'topics', array_to_string(v_old_topics, ', '), array_to_string(v_topics, ', '), auth.uid(), v_ctx);
  end if;

  update email_thread set
    category         = p_type::thread_category,
    category_locked  = true,
    topics           = v_topics,
    topics_locked    = true,
    type_needs_check = false,
    type_checked_at  = now(),
    type_checked_by  = auth.uid(),
    needs_review     = false
  where id = p_thread;

  if t.category is distinct from p_type and t.category in ('development','bulk','mixed') then
    perform retype_thread_items(p_thread, p_type);
    -- Approved clients: let the AI re-read the conversation as the right type.
    if t.company_approval = 'approved' then
      insert into job (kind, mailbox_id, payload, dedupe_key, priority)
      values ('reprocess_thread', t.mailbox_id, jsonb_build_object('threadId', p_thread, 'force', true), 'reprocess:' || p_thread, 7)
      on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing;
    end if;
  end if;
end $$;

/** A person confirms the AI's type and topics are right. */
create or replace function confirm_thread_type(p_thread uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cat text;
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  select category::text into v_cat from email_thread where id = p_thread for update;
  if not found then raise exception 'Conversation not found.'; end if;
  if v_cat not in ('development','bulk') then raise exception 'Choose Development or Bulk first.'; end if;
  update email_thread set
    category_locked = true, topics_locked = true, type_needs_check = false,
    type_checked_at = now(), type_checked_by = auth.uid(), needs_review = false
  where id = p_thread;
end $$;

/** Set every not-yet-checked conversation of one client to one type (keeps each one's topics). */
create or replace function set_client_type(p_company uuid, p_type text) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  for r in select id, topics from email_thread
            where company_id = p_company and category in ('development','bulk','mixed') and type_checked_at is null loop
    perform set_thread_type(r.id, p_type, r.topics);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function set_thread_type(uuid, text, text[]), confirm_thread_type(uuid), set_client_type(uuid, text) from public, anon;
grant execute on function set_thread_type(uuid, text, text[]), confirm_thread_type(uuid), set_client_type(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Sheet rows: add topics and the check state (new columns go at the end).
-- ---------------------------------------------------------------------
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
  d.created_at,
  coalesce(t.topics, '{}'::text[])  as topics,
  t.type_confidence,
  coalesce(t.type_needs_check, false) as type_needs_check,
  t.type_checked_at,
  t.type_reason
from dev_item d
left join company c       on c.id  = d.company_id
left join email_thread t  on t.id  = d.primary_thread_id
left join mailbox mb      on mb.id = t.mailbox_id
left join msg             on msg.thread_id = t.id

union all

select
  'bulk:' || b.id::text, 'bulk', 'bulk', b.id, b.company_id, c.name, c.city, c.region, c.approval::text,
  null::text, b.brand, coalesce(b.description, b.product_code), null::text, null::text, null::text, b.owner_remark,
  b.status::text, b.locked_fields, b.summary, null::date, b.product_code, null::text, null::text,
  null::date, null::text, null::date, b.next_action, b.po_number, b.qty_mtrs,
  t.id, t.subject, t.reply_state::text, t.waiting_on, t.reply_due_at, t.gmail_thread_id, mb.email,
  coalesce(msg.n, 0),
  (select count(*) from item_thread it where it.bulk_order_id = b.id)::int,
  (t.id is null or t.extracted_through is not null),
  coalesce(t.last_message_at, b.last_activity_at, b.created_at),
  b.source, b.created_at,
  coalesce(t.topics, '{}'::text[]), t.type_confidence, coalesce(t.type_needs_check, false), t.type_checked_at, t.type_reason
from bulk_order b
left join company c       on c.id  = b.company_id
left join email_thread t  on t.id  = b.primary_thread_id
left join mailbox mb      on mb.id = t.mailbox_id
left join msg             on msg.thread_id = t.id

union all

select
  'thread:' || t.id::text, 'thread', t.category::text, null::uuid, t.company_id, c.name, c.city, c.region, c.approval::text,
  coalesce(fi.from_name, split_part(fi.from_email, '@', 1)), null::text, t.subject, null::text, null::text, null::text, null::text,
  null::text, '{}'::text[], coalesce(t.summary, fi.triage->>'reason'), t.first_message_at::date, null::text, null::text, null::text,
  null::date, null::text, null::date, t.next_action, null::text, null::numeric,
  t.id, t.subject, t.reply_state::text, t.waiting_on, t.reply_due_at, t.gmail_thread_id, mb.email,
  coalesce(msg.n, 0), 1, t.extracted_through is not null, t.last_message_at, 'email', t.created_at,
  t.topics, t.type_confidence, t.type_needs_check, t.type_checked_at, t.type_reason
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
