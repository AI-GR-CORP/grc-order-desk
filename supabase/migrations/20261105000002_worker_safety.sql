-- =====================================================================
-- Worker safety
--
-- * A worker that is killed or loses its connection in the middle of a transaction can leave
--   that database session open and holding row locks; later statements then wait until
--   "statement timeout". Sessions of the worker's role that sit idle inside a transaction for
--   60 seconds are now rolled back automatically.
-- * GRC-or-customer in SQL (the same rule as the app: a GRC domain or subdomain, or a listed
--   address), so "which emails are GRC's" can be recomputed in one statement.
-- =====================================================================

do $$
begin
  execute format('alter role %I set idle_in_transaction_session_timeout = %L', current_user, '60s');
exception when others then
  raise notice 'could not set idle_in_transaction_session_timeout: %', sqlerrm;
end $$;

-- One-time cleanup: sessions already stuck from earlier force-stops (idle inside a transaction for
-- over 5 minutes; a healthy worker never does that) are closed now, releasing their locks.
do $$
begin
  perform pg_terminate_backend(pid) from pg_stat_activity
  where usename = current_user and pid <> pg_backend_pid()
    and state = 'idle in transaction' and now() - state_change > interval '5 minutes';
exception when others then
  raise notice 'could not close stuck sessions: %', sqlerrm;
end $$;

create or replace function is_grc_address(addr text, list text[]) returns boolean
language sql immutable as $$
  select exists (
    select 1 from unnest(list) raw
    where case
      when position('@' in lower(trim(raw))) > 0 then lower(trim(addr)) = lower(trim(raw))
      else split_part(lower(trim(addr)), '@', 2) = lower(trim(raw))
        or split_part(lower(trim(addr)), '@', 2) like '%.' || lower(trim(raw))
    end
  )
$$;

/** Recomputes each email's direction for one mailbox from GRC's list; returns the conversations that changed. */
create or replace function refresh_message_directions(p_mailbox uuid) returns table (thread_id uuid)
language sql security definer set search_path = public as $$
  with list as (
    select coalesce(array(select jsonb_array_elements_text(value) from app_setting where key = 'internal_domains'), '{}') as l
  ), calc as (
    select m.id,
           case
             when not is_grc_address(m.from_email, list.l) then 'inbound'
             when exists (select 1 from unnest(m.to_emails || m.cc_emails) r where not is_grc_address(r, list.l)) then 'outbound'
             else 'internal'
           end::msg_direction as d
    from email_message m join email_thread t on t.id = m.thread_id, list
    where t.mailbox_id = p_mailbox
  ), upd as (
    update email_message m set direction = c.d
    from calc c
    where m.id = c.id and m.direction <> c.d
    returning m.thread_id
  )
  select distinct upd.thread_id from upd
$$;
revoke execute on function refresh_message_directions(uuid) from public, anon, authenticated;
