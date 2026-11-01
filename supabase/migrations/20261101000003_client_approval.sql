-- =====================================================================
-- Client approval
-- Owners approve each client before the AI reads its conversations in depth.
-- Until then a client's threads are only sorted (cheap) and listed on the
-- "New clients" page; nothing is extracted and no reply alerts fire.
-- =====================================================================

alter table company
  add column approval    text not null default 'pending' check (approval in ('pending','approved','rejected')),
  add column approval_at timestamptz,
  add column approval_by uuid;
create index company_approval_idx on company (approval) where merged_into is null;

-- Companies that already have rows imported from GRC's old sheet are known customers.
update company set approval = 'approved', approval_at = now()
where id in (
  select company_id from dev_item   where source = 'sheet_import' and company_id is not null
  union
  select company_id from bulk_order where source = 'sheet_import' and company_id is not null
);

-- New job: read every conversation of one client right after it is approved.
alter table job drop constraint job_kind_check;
alter table job add constraint job_kind_check
  check (kind in ('backfill','extract_backfill','extract_company','sync','reprocess_thread'));

create or replace function enqueue_job(
  p_kind text, p_mailbox uuid, p_payload jsonb default '{}'::jsonb, p_dedupe text default null, p_priority int default 0
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  if p_kind not in ('reprocess_thread','extract_backfill','extract_company','backfill') then raise exception 'unknown job kind'; end if;
  if p_kind <> 'reprocess_thread' and not is_app_admin() then raise exception 'owners only'; end if;
  insert into job (kind, mailbox_id, payload, dedupe_key, priority)
  values (p_kind, p_mailbox, coalesce(p_payload, '{}'::jsonb), p_dedupe, p_priority)
  on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

-- Owners create clients from unmatched conversations; staff can file contacts.
create policy add on company for insert to authenticated with check (is_app_admin());
create policy add on contact for insert to authenticated with check (is_app_user());

-- ---------------------------------------------------------------------
-- Dashboard views now respect approval
-- ---------------------------------------------------------------------
create or replace view v_needs_reply with (security_invoker = true) as
select t.id,
       t.subject,
       t.category,
       t.company_id,
       c.name  as company,
       tm.name as handled_by,
       t.reply_state,
       t.awaiting_reply_since,
       t.reply_due_at,
       t.summary,
       t.next_action,
       t.gmail_thread_id,
       m.email as mailbox_email
from email_thread t
join mailbox m           on m.id  = t.mailbox_id
join company c           on c.id  = t.company_id and c.approval = 'approved'
left join team_member tm on tm.id = t.handled_by
where t.reply_state in ('awaiting','possibly_replied')
  and t.awaiting_reply_since is not null
  and t.category in ('development','bulk','mixed')
  and (t.snoozed_until is null or t.snoozed_until < now());

create or replace view v_dev_items with (security_invoker = true) as
select d.*,
       c.name   as company_name,
       c.region as company_region,
       c.city   as company_city,
       tm.name  as handled_by_name,
       t.subject      as thread_subject,
       t.reply_state  as thread_reply_state,
       t.waiting_on   as thread_waiting_on,
       (select count(*) from item_thread it where it.dev_item_id = d.id)::int as thread_count
from dev_item d
left join company c      on c.id  = d.company_id
left join team_member tm on tm.id = d.handled_by
left join email_thread t on t.id  = d.primary_thread_id
where c.id is null or c.approval <> 'rejected';

create or replace view v_bulk_orders with (security_invoker = true) as
select b.*,
       c.name   as company_name,
       c.region as company_region,
       tm.name  as handled_by_name,
       coalesce((
         select jsonb_object_agg(s.stage_key, jsonb_build_object('value', s.value, 'done_on', s.done_on, 'locked', s.locked))
         from bulk_order_stage s where s.bulk_order_id = b.id
       ), '{}'::jsonb) as stages
from bulk_order b
left join company c      on c.id  = b.company_id
left join team_member tm on tm.id = b.handled_by
where c.id is null or c.approval <> 'rejected';

create or replace view v_company_overview with (security_invoker = true) as
select c.id, c.name, c.city, c.country, c.region, c.domains, c.needs_review,
       (select count(*) from dev_item d where d.company_id = c.id and d.stage not in ('closed','converted_to_bulk','approved'))::int as open_dev,
       (select count(*) from bulk_order b where b.company_id = c.id and b.status not in ('completed','cancelled'))::int        as open_bulk,
       (select count(*) from email_thread t where t.company_id = c.id and t.reply_state = 'awaiting'
          and t.category in ('development','bulk','mixed'))::int                                                              as awaiting_reply,
       (select count(*) from email_thread t where t.company_id = c.id)::int                                                  as thread_count,
       (select count(*) from contact k where k.company_id = c.id)::int                                                       as contact_count,
       (select max(t.last_message_at) from email_thread t where t.company_id = c.id)                                         as last_activity_at,
       c.approval
from company c
where c.merged_into is null;

-- One row per client that has development/bulk conversations: the approval queue.
create view v_client_queue with (security_invoker = true) as
select c.id, c.name, c.city, c.country, c.region, c.domains, c.approval, c.approval_at,
       count(t.id)::int                                              as tracked_threads,
       count(t.id) filter (where t.category = 'development')::int    as dev_threads,
       count(t.id) filter (where t.category = 'bulk')::int           as bulk_threads,
       count(t.id) filter (where t.category = 'mixed')::int          as mixed_threads,
       count(t.id) filter (where t.reply_state = 'awaiting')::int    as awaiting_reply,
       count(t.id) filter (where t.extracted_through is not null)::int as read_threads,
       coalesce(sum(mc.n), 0)::int                                   as email_count,
       min(t.first_message_at)                                       as first_at,
       max(t.last_message_at)                                        as last_at,
       (select count(*) from contact k where k.company_id = c.id)::int as contact_count
from company c
join email_thread t on t.company_id = c.id and t.category in ('development','bulk','mixed')
cross join lateral (select count(*)::int as n from email_message m where m.thread_id = t.id) mc
where c.merged_into is null
group by c.id;

-- Everything needed to judge a conversation without opening Gmail.
create view v_thread_brief with (security_invoker = true) as
select t.id, t.company_id, t.mailbox_id, mb.email as mailbox_email, t.gmail_thread_id,
       t.subject, t.category, t.reply_state, t.summary, t.extracted_through,
       t.first_message_at, t.last_message_at,
       cnt.n as email_count,
       fi.from_name  as first_from_name,
       fi.from_email as first_from_email,
       left(coalesce(fi.body_clean, fi.snippet), 420) as first_snippet,
       fi.triage->>'reason'       as first_reason,
       fi.triage->>'company_name' as company_guess,
       lm.from_name  as last_from_name,
       lm.from_email as last_from_email,
       lm.direction  as last_direction,
       left(coalesce(lm.body_clean, lm.snippet), 300) as last_snippet
from email_thread t
join mailbox mb on mb.id = t.mailbox_id
cross join lateral (select count(*)::int as n from email_message m where m.thread_id = t.id) cnt
left join lateral (
  select from_name, from_email, body_clean, snippet, triage from email_message
  where thread_id = t.id and direction = 'inbound' order by sent_at limit 1
) fi on true
left join lateral (
  select from_name, from_email, direction, body_clean, snippet from email_message
  where thread_id = t.id order by sent_at desc limit 1
) lm on true
where t.category in ('development','bulk','mixed');

grant select on v_client_queue, v_thread_brief to authenticated;
revoke all on v_client_queue, v_thread_brief from anon;
