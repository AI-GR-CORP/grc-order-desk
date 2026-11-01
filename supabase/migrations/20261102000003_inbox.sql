-- =====================================================================
-- Inbox: every customer email in one place, so GRC doesn't need Gmail for customer mail.
--
-- Each conversation with at least one email from outside GRC falls in one bucket:
--   customer  : an order conversation, a known client (approved or waiting), or the AI said the
--               sender is a customer
--   filtered  : everything else from outside (suppliers, newsletters, unknown senders...).
--               Shown in a "Filtered out" safety-net tab so nothing disappears silently.
--   dismissed : a person confirmed it isn't customer mail (or the client was ignored)
-- =====================================================================

create table thread_read (
  user_id   uuid not null,
  thread_id uuid not null references email_thread(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (user_id, thread_id)
);
alter table thread_read enable row level security;
create policy own on thread_read for all to authenticated
  using (user_id = auth.uid() and is_app_user())
  with check (user_id = auth.uid() and is_app_user());
grant select, insert, update, delete on thread_read to authenticated;
revoke all on thread_read from anon;

create index email_message_inbound_idx on email_message (thread_id, sent_at desc) where direction = 'inbound';

create or replace view v_inbox with (security_invoker = true) as
select
  t.id                                   as thread_id,
  t.subject,
  t.category::text                       as category,
  t.topics,
  t.type_needs_check,
  t.type_checked_at,
  t.company_id,
  c.name                                 as company_name,
  c.approval::text                       as company_approval,
  t.reply_state::text                    as reply_state,
  t.reply_due_at,
  t.gmail_thread_id,
  mb.email                               as mailbox_email,
  t.first_message_at,
  li.sent_at                             as last_inbound_at,
  coalesce(nullif(li.from_name, ''), li.from_email) as last_from,
  li.from_email                          as last_from_email,
  left(regexp_replace(coalesce(li.body_clean, li.snippet, ''), '\s+', ' ', 'g'), 220) as preview,
  li.triage->>'category'                 as last_triage_category,
  li.triage->>'reason'                   as last_triage_reason,
  (fm.direction = 'inbound')             as started_by_customer,
  exists (select 1 from email_message o
          where o.thread_id = t.id and o.direction = 'outbound' and o.sent_at < li.sent_at) as is_reply,
  (select count(*)::int from email_message m where m.thread_id = t.id) as email_count,
  (select count(*)::int from attachment a join email_message m on m.id = a.message_id
    where m.thread_id = t.id and not (a.inline and coalesce(a.size_bytes, 0) < 15000)) as attachment_count,
  (r.read_at is null or r.read_at < li.sent_at) as unread,
  case
    when c.approval = 'rejected'
      or (t.category in ('other','ignored') and t.type_checked_at is not null) then 'dismissed'
    when t.category in ('development','bulk','mixed','payment')
      or c.approval in ('approved','pending')
      or (t.category <> 'ignored' and exists (
            select 1 from email_message m2
            where m2.thread_id = t.id and m2.direction = 'inbound' and (m2.triage->>'is_customer') = 'true')) then 'customer'
    else 'filtered'
  end                                    as bucket,
  (t.category = 'ignored' or li.triage->>'category' in ('marketing','courier')) as is_noise
from email_thread t
join mailbox mb on mb.id = t.mailbox_id
left join company c on c.id = t.company_id
join lateral (
  select m.sent_at, m.from_name, m.from_email, m.body_clean, m.snippet, m.triage
  from email_message m
  where m.thread_id = t.id and m.direction = 'inbound'
  order by m.sent_at desc limit 1
) li on true
left join lateral (
  select m.direction from email_message m
  where m.thread_id = t.id and m.direction <> 'internal'
  order by m.sent_at limit 1
) fm on true
left join thread_read r on r.thread_id = t.id and r.user_id = auth.uid();

grant select on v_inbox to authenticated;
revoke all on v_inbox from anon;

-- Start everyone with only the last 3 days unread (not the whole imported history).
insert into thread_read (user_id, thread_id, read_at)
select u.user_id, t.id, now()
from app_user u
cross join email_thread t
where t.last_message_at < now() - interval '3 days'
on conflict do nothing;
