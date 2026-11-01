-- =====================================================================
-- Access control, dashboard views, auth hook, realtime, storage
-- =====================================================================

alter table app_user
  add constraint app_user_auth_fk foreign key (user_id) references auth.users(id) on delete cascade;

-- ---------------------------------------------------------------------
-- Who may use the dashboard
-- ---------------------------------------------------------------------
create or replace function is_app_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user where user_id = auth.uid());
$$;

create or replace function is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_user where user_id = auth.uid() and role in ('owner','admin'));
$$;

-- New sign-ins from GRC's domain (or listed owner emails) get access automatically.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email  text := lower(coalesce(new.email, ''));
  v_domain text := split_part(v_email, '@', 2);
  v_role   text;
begin
  if coalesce((select value from app_setting where key = 'owner_emails'), '[]'::jsonb) ? v_email then
    v_role := 'owner';
  elsif coalesce((select value from app_setting where key = 'login_domains'), '[]'::jsonb) ? v_domain then
    v_role := 'staff';
  else
    return new;   -- signs in, but sees the "ask for access" page until an owner grants it
  end if;
  insert into app_user (user_id, email, role, team_member_id)
  values (new.id, v_email, v_role, (select id from team_member where email = v_email))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_auth_user();

-- Owners can see people who signed in without access, and let them in.
create or replace function list_pending_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at
  from auth.users u
  where is_app_admin()
    and not exists (select 1 from app_user a where a.user_id = u.id)
  order by u.created_at desc;
$$;

create or replace function grant_access(p_user uuid, p_role text default 'staff') returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_app_admin() then raise exception 'not allowed'; end if;
  if p_role not in ('owner','staff','admin') then raise exception 'bad role'; end if;
  insert into app_user (user_id, email, role)
  select u.id, lower(u.email), p_role from auth.users u where u.id = p_user
  on conflict (user_id) do update set role = excluded.role;
end $$;

-- Merge duplicate companies (review screen). Atomic.
create or replace function merge_company(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  if p_from = p_into then return; end if;
  update contact      set company_id = p_into where company_id = p_from;
  update email_thread set company_id = p_into where company_id = p_from;
  update dev_item     set company_id = p_into where company_id = p_from;
  update bulk_order   set company_id = p_into where company_id = p_from;
  update company c set domains = (select array(select distinct unnest(c.domains || f.domains)) from company f where f.id = p_from),
                       needs_review = false
  where c.id = p_into;
  update company set merged_into = p_into, needs_review = false where id = p_from;
end $$;

revoke execute on function list_pending_users() from public, anon;
revoke execute on function grant_access(uuid, text) from public, anon;
revoke execute on function merge_company(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- Row level security. The worker uses the service role, which bypasses RLS.
-- ---------------------------------------------------------------------
alter table app_setting       enable row level security;
alter table team_member       enable row level security;
alter table company           enable row level security;
alter table contact           enable row level security;
alter table mailbox           enable row level security;
alter table email_thread      enable row level security;
alter table email_message     enable row level security;
alter table attachment        enable row level security;
alter table dev_item          enable row level security;
alter table bulk_stage_def    enable row level security;
alter table bulk_order        enable row level security;
alter table bulk_order_stage  enable row level security;
alter table item_thread       enable row level security;
alter table knowledge_profile enable row level security;
alter table correction        enable row level security;
alter table ai_run            enable row level security;
alter table job               enable row level security;   -- no policies: worker / server only
alter table app_user          enable row level security;
alter table sheet_baseline    enable row level security;   -- worker only

create policy read on app_setting      for select to authenticated using (is_app_user());
create policy read on team_member      for select to authenticated using (is_app_user());
create policy read on company          for select to authenticated using (is_app_user());
create policy read on contact          for select to authenticated using (is_app_user());
create policy read on mailbox          for select to authenticated using (is_app_user());
create policy read on email_thread     for select to authenticated using (is_app_user());
create policy read on email_message    for select to authenticated using (is_app_user());
create policy read on attachment       for select to authenticated using (is_app_user());
create policy read on dev_item         for select to authenticated using (is_app_user());
create policy read on bulk_stage_def   for select to authenticated using (is_app_user());
create policy read on bulk_order       for select to authenticated using (is_app_user());
create policy read on bulk_order_stage for select to authenticated using (is_app_user());
create policy read on item_thread      for select to authenticated using (is_app_user());
create policy read on correction       for select to authenticated using (is_app_user());
create policy read on knowledge_profile for select to authenticated using (is_app_user());
create policy read on app_user         for select to authenticated using (user_id = auth.uid() or is_app_admin());
create policy read on ai_run           for select to authenticated using (is_app_admin());

create policy edit on dev_item         for update to authenticated using (is_app_user()) with check (is_app_user());
create policy add  on dev_item         for insert to authenticated with check (is_app_user());
create policy edit on bulk_order       for update to authenticated using (is_app_user()) with check (is_app_user());
create policy add  on bulk_order       for insert to authenticated with check (is_app_user());
create policy edit on bulk_order_stage for update to authenticated using (is_app_user()) with check (is_app_user());
create policy add  on bulk_order_stage for insert to authenticated with check (is_app_user());
create policy edit on email_thread     for update to authenticated using (is_app_user()) with check (is_app_user());
create policy edit on company          for update to authenticated using (is_app_user()) with check (is_app_user());
create policy edit on contact          for update to authenticated using (is_app_user()) with check (is_app_user());
create policy add  on item_thread      for insert to authenticated with check (is_app_user());
create policy add  on correction       for insert to authenticated with check (is_app_user() and corrected_by = auth.uid());

create policy admin on app_setting       for update to authenticated using (is_app_admin()) with check (is_app_admin());
create policy admin on team_member       for all    to authenticated using (is_app_admin()) with check (is_app_admin());
create policy admin on knowledge_profile for all    to authenticated using (is_app_admin()) with check (is_app_admin());
create policy admin on app_user          for all    to authenticated using (is_app_admin()) with check (is_app_admin());

-- The refresh token column is never readable or writable from the browser.
revoke all on mailbox from anon, authenticated;
grant select (id, email, status, backfill_stage, backfill_progress, backfill_target, last_synced_at, last_error, created_at)
  on mailbox to authenticated;
grant update (status) on mailbox to authenticated;
create policy pause on mailbox for update to authenticated using (is_app_admin()) with check (is_app_admin());

revoke all on job from anon, authenticated;

-- ---------------------------------------------------------------------
-- Views for the dashboard (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------
create view v_needs_reply with (security_invoker = true) as
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
left join company c      on c.id  = t.company_id
left join team_member tm on tm.id = t.handled_by
where t.reply_state in ('awaiting','possibly_replied')
  and t.awaiting_reply_since is not null
  and t.category in ('development','bulk','mixed')
  and (t.snoozed_until is null or t.snoozed_until < now());

create view v_dev_items with (security_invoker = true) as
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
left join email_thread t on t.id  = d.primary_thread_id;

create view v_bulk_orders with (security_invoker = true) as
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
left join team_member tm on tm.id = b.handled_by;

create view v_non_moving with (security_invoker = true) as
select d.*
from v_dev_items d
where d.stage not in ('closed','converted_to_bulk','approved','on_hold')
  and coalesce(d.last_activity_at, d.created_at)
      < now() - make_interval(days => coalesce((select (value #>> '{}')::int from app_setting where key = 'non_moving_days'), 21));

create view v_company_overview with (security_invoker = true) as
select c.id, c.name, c.city, c.country, c.region, c.domains, c.needs_review,
       (select count(*) from dev_item d where d.company_id = c.id and d.stage not in ('closed','converted_to_bulk','approved'))::int as open_dev,
       (select count(*) from bulk_order b where b.company_id = c.id and b.status not in ('completed','cancelled'))::int        as open_bulk,
       (select count(*) from email_thread t where t.company_id = c.id and t.reply_state = 'awaiting'
          and t.category in ('development','bulk','mixed'))::int                                                              as awaiting_reply,
       (select count(*) from email_thread t where t.company_id = c.id)::int                                                  as thread_count,
       (select count(*) from contact k where k.company_id = c.id)::int                                                       as contact_count,
       (select max(t.last_message_at) from email_thread t where t.company_id = c.id)                                         as last_activity_at
from company c
where c.merged_into is null;

create view v_ai_usage_month with (security_invoker = true) as
select purpose, model, count(*)::int as calls,
       coalesce(sum(input_tokens),0)::bigint as input_tokens,
       coalesce(sum(output_tokens),0)::bigint as output_tokens,
       coalesce(sum(cost_usd),0)::numeric(12,4) as cost_usd,
       count(*) filter (where not ok)::int as failures
from ai_run
where created_at >= date_trunc('month', now())
group by purpose, model;

-- ---------------------------------------------------------------------
-- Realtime (pop-ups) and storage (picture thumbnails)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table email_thread;

insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', false)
on conflict (id) do nothing;

create policy thumbnails_read on storage.objects
  for select to authenticated
  using (bucket_id = 'thumbnails' and public.is_app_user());

-- ---------------------------------------------------------------------
-- Dashboard → worker: queue a job (re-run AI, start extraction, retry import)
-- ---------------------------------------------------------------------
create or replace function enqueue_job(
  p_kind text, p_mailbox uuid, p_payload jsonb default '{}'::jsonb, p_dedupe text default null, p_priority int default 0
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not is_app_user() then raise exception 'not allowed'; end if;
  if p_kind not in ('reprocess_thread','extract_backfill','backfill') then raise exception 'unknown job kind'; end if;
  if p_kind <> 'reprocess_thread' and not is_app_admin() then raise exception 'owners only'; end if;
  insert into job (kind, mailbox_id, payload, dedupe_key, priority)
  values (p_kind, p_mailbox, coalesce(p_payload, '{}'::jsonb), p_dedupe, p_priority)
  on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
  returning id into v_id;
  return v_id is not null;
end $$;
revoke execute on function enqueue_job(text, uuid, jsonb, text, int) from public, anon;
