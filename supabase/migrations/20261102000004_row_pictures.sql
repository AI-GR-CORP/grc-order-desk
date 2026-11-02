-- =====================================================================
-- Pictures per row
--
-- Each picture belongs to exactly one dashboard row: a development item, a bulk order, or a
-- conversation that has no rows yet. Sources:
--   sheet  : from GRC's own spreadsheet, at the exact cell it sat in (sheet_ref + sheet_cell)
--   email  : an image attached to an email, linked to the product it shows
--   upload : added by a person in the dashboard (pasted screenshot, WhatsApp photo, …)
-- Removing a picture hides it (so the AI never puts it back).
-- =====================================================================

create table row_picture (
  id            uuid primary key default gen_random_uuid(),
  dev_item_id   uuid references dev_item(id) on delete cascade,
  bulk_order_id uuid references bulk_order(id) on delete cascade,
  thread_id     uuid references email_thread(id) on delete cascade,
  source        text not null check (source in ('sheet','email','upload')),
  thumb_path    text,          -- 'thumbnails' bucket, ≤480px WebP (email pictures use the attachment's thumbnail)
  full_path     text,          -- ≤1600px WebP, opened on click
  attachment_id uuid references attachment(id) on delete cascade,
  sheet_ref     text,          -- "NEW INQUIRY!14"
  sheet_cell    text,          -- "E14"
  sha256        text,
  width         int,
  height        int,
  position      int not null default 0,
  hidden        boolean not null default false,
  added_by      uuid,
  created_at    timestamptz not null default now(),
  constraint row_picture_one_row check (num_nonnulls(dev_item_id, bulk_order_id, thread_id) = 1)
);

create unique index row_picture_dev_sha     on row_picture (dev_item_id, sha256)       where dev_item_id   is not null and sha256 is not null;
create unique index row_picture_bulk_sha    on row_picture (bulk_order_id, sha256)     where bulk_order_id is not null and sha256 is not null;
create unique index row_picture_thread_sha  on row_picture (thread_id, sha256)         where thread_id     is not null and sha256 is not null;
create unique index row_picture_dev_att     on row_picture (dev_item_id, attachment_id)   where dev_item_id   is not null and attachment_id is not null;
create unique index row_picture_bulk_att    on row_picture (bulk_order_id, attachment_id) where bulk_order_id is not null and attachment_id is not null;
create index row_picture_dev_idx    on row_picture (dev_item_id)   where dev_item_id   is not null;
create index row_picture_bulk_idx   on row_picture (bulk_order_id) where bulk_order_id is not null;
create index row_picture_thread_idx on row_picture (thread_id)     where thread_id     is not null;

alter table row_picture enable row level security;
create policy read   on row_picture for select to authenticated using (is_app_user());
create policy add    on row_picture for insert to authenticated with check (is_app_user() and source = 'upload');
create policy edit   on row_picture for update to authenticated using (is_app_user()) with check (is_app_user());
grant select, insert on row_picture to authenticated;
grant update (hidden, position) on row_picture to authenticated;
revoke all on row_picture from anon;

-- Email pictures for every order conversation (no AI cost; just downloads attachments).
alter table job drop constraint if exists job_kind_check;
alter table job add constraint job_kind_check
  check (kind in ('backfill','extract_backfill','extract_company','classify_backfill','picture_backfill','sync','reprocess_thread'));

-- When a conversation switches type, converted rows keep their pictures.
create or replace function retype_thread_items(p_thread uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare
  d dev_item%rowtype;
  b bulk_order%rowtype;
  v_new uuid;
begin
  if p_type = 'bulk' then
    for d in select * from dev_item where primary_thread_id = p_thread loop
      if d.source = 'ai' and cardinality(d.locked_fields) = 0
         and not exists (select 1 from row_picture p where p.dev_item_id = d.id and p.source <> 'email') then
        delete from dev_item where id = d.id;
      else
        insert into bulk_order (company_id, primary_thread_id, brand, product_code, description, next_action, owner_remark, summary, source, locked_fields)
        values (d.company_id, d.primary_thread_id, d.brand, d.product_code, coalesce(d.inquiry, d.product_code), d.next_action, d.owner_remark, d.summary, 'manual',
                array(select case when f = 'inquiry' then 'description' else f end from unnest(d.locked_fields) f
                      where f in ('brand','product_code','inquiry','next_action','owner_remark')))
        returning id into v_new;
        insert into item_thread (thread_id, bulk_order_id) values (p_thread, v_new) on conflict do nothing;
        update row_picture set dev_item_id = null, bulk_order_id = v_new where dev_item_id = d.id;
        delete from dev_item where id = d.id;
      end if;
    end loop;
  elsif p_type = 'development' then
    for b in select * from bulk_order where primary_thread_id = p_thread loop
      if b.source = 'ai' and cardinality(b.locked_fields) = 0
         and not exists (select 1 from row_picture p where p.bulk_order_id = b.id and p.source <> 'email') then
        delete from bulk_order where id = b.id;
      else
        insert into dev_item (company_id, primary_thread_id, brand, product_code, inquiry, next_action, owner_remark, summary, source, locked_fields)
        values (b.company_id, b.primary_thread_id, b.brand, b.product_code, coalesce(b.description, b.product_code), b.next_action, b.owner_remark, b.summary, 'manual',
                array(select case when f = 'description' then 'inquiry' else f end from unnest(b.locked_fields) f
                      where f in ('brand','product_code','description','next_action','owner_remark')))
        returning id into v_new;
        insert into item_thread (thread_id, dev_item_id) values (p_thread, v_new) on conflict do nothing;
        update row_picture set bulk_order_id = null, dev_item_id = v_new where bulk_order_id = b.id;
        delete from bulk_order where id = b.id;
      end if;
    end loop;
  end if;
end $$;
revoke execute on function retype_thread_items(uuid, text) from public, anon, authenticated;
