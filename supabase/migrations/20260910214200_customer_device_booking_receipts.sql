-- A booking receipt proves creation of specific booking IDs, never ownership of an email/phone.
-- Separate credentials preserve the full-history boundary and existing permanent email links.
create table public.customer_booking_receipts (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '30 days')
);
create index customer_booking_receipts_expiry_idx on public.customer_booking_receipts (expires_at);

create table public.customer_booking_receipt_bookings (
  receipt_hash text not null references public.customer_booking_receipts(token_hash) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  -- Captured from a validated full session, not from the submitted booking contact.
  parent_email text,
  primary key (receipt_hash, booking_id),
  constraint customer_booking_receipt_parent_email_check check (
    parent_email is null or (
      parent_email = pg_catalog.lower(pg_catalog.btrim(parent_email))
      and pg_catalog.char_length(parent_email) between 3 and 254
    )
  )
);
create index customer_booking_receipt_booking_idx on public.customer_booking_receipt_bookings(booking_id);

alter table public.customer_booking_receipts enable row level security;
alter table public.customer_booking_receipt_bookings enable row level security;
revoke all on public.customer_booking_receipts, public.customer_booking_receipt_bookings
  from public, anon, authenticated, service_role;

-- Called only with the successful create_booking result by the trusted Edge gateway.
-- The same live collection is locked and appended, so parallel submissions cannot lose IDs.
create or replace function public.append_customer_booking_receipt(
  p_booking_id uuid, p_existing_hash text, p_new_hash text, p_session_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
  v_parent_email text;
  v_existing boolean := false;
  v_expires_at timestamptz;
begin
  if p_new_hash is null or p_new_hash !~ '^[0-9a-f]{64}$'
     or p_booking_id is null
     or not exists (select 1 from public.bookings where id = p_booking_id) then
    return null;
  end if;
  select r.token_hash, r.expires_at into v_hash, v_expires_at
  from public.customer_booking_receipts r
  where r.token_hash = p_existing_hash and r.expires_at > pg_catalog.now()
  for update;
  v_existing := found;
  if not v_existing then
    v_hash := p_new_hash;
    insert into public.customer_booking_receipts(token_hash) values (v_hash) returning expires_at into v_expires_at;
  end if;
  select s.email into v_parent_email from public.customer_booking_access_scope(p_session_hash) s;
  insert into public.customer_booking_receipt_bookings(receipt_hash, booking_id, parent_email)
  values(v_hash, p_booking_id, v_parent_email)
  on conflict (receipt_hash, booking_id) do nothing;
  return pg_catalog.jsonb_build_object('existing', v_existing,
    'max_age', greatest(0, floor(extract(epoch from (v_expires_at - pg_catalog.clock_timestamp())))::integer));
end;
$$;

-- Private shared predicate: an anonymous grant must not augment another verified customer's view.
create function public.customer_device_booking_ids(p_receipt_hash text, p_parent_email text)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select b.booking_id
  from public.customer_booking_receipt_bookings b
  join public.customer_booking_receipts r on r.token_hash = b.receipt_hash
  where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()
    and (p_parent_email is null or b.parent_email = p_parent_email);
$$;

create or replace function public.list_customer_bookings_for_browser(p_session_hash text, p_receipt_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_phone text;
  v_name text;
  v_receipt boolean;
begin
  select s.email, s.phone into v_email, v_phone
  from public.customer_booking_access_scope(p_session_hash) s;
  select exists(select 1 from public.customer_booking_receipts r
    where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()) into v_receipt;
  if v_email is null and not v_receipt then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  if v_email is not null then
    select b.customer_name into v_name from public.bookings b
    where pg_catalog.lower(b.email) = v_email order by b.created_at desc, b.id desc limit 1;
  end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', true, 'authority', case when v_email is null then 'device' else 'verified' end,
    'email', v_email, 'phone', v_phone, 'name', v_name, 'receipt_active', v_receipt,
    'bookings', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'barber_id', b.barber_id, 'barber_name', barber.name,
      'service_name', b.service_name, 'price', b.price, 'duration_min', b.duration_min,
      'start_at', b.start_at
    ) order by b.start_at desc) from public.bookings b
      join public.barbers barber on barber.id = b.barber_id
      where b.status = 'confirmed' and (
        pg_catalog.lower(b.email) = v_email
        or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email))
      )), '[]'::jsonb)
  ));
end;
$$;

create function public.cancel_customer_booking_for_browser(
  p_booking_id uuid, p_session_hash text, p_receipt_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_cutoff_hours integer;
begin
  select s.email into v_email from public.customer_booking_access_scope(p_session_hash) s;
  if v_email is null and not exists(select 1 from public.customer_booking_receipts r
    where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  select case when s.value ~ '^[0-9]{1,3}$' then least(s.value::integer, 168) else 24 end
    into v_cutoff_hours from public.site_settings s where s.key = 'cancellation_policy_hours';
  update public.bookings b set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id and b.status = 'confirmed'
    and b.start_at > pg_catalog.now() + pg_catalog.make_interval(hours => coalesce(v_cutoff_hours, 24))
    and (pg_catalog.lower(b.email) = v_email
      or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email)));
  return case when found then pg_catalog.jsonb_build_object('ok', true)
    else pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found') end;
end;
$$;

-- Existing scheduled cleanup also expires receipt grants; deleting bookings removes their grants.
create or replace function public.forget_customer_booking_receipt(p_receipt_hash text)
returns void language sql security definer set search_path = ''
as $$
  delete from public.customer_booking_receipts where token_hash = p_receipt_hash;
$$;

create or replace function public.cleanup_customer_booking_access()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer := 0; v_deleted integer := 0;
begin
  delete from public.customer_booking_access_challenges
  where expires_at < pg_catalog.now() - interval '1 day' or used_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_count = row_count;
  delete from public.customer_booking_access_sessions where expires_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  delete from public.customer_booking_receipts where expires_at <= pg_catalog.now();
  get diagnostics v_deleted = row_count;
  return v_count + v_deleted;
end;
$$;

revoke execute on function public.customer_device_booking_ids(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.append_customer_booking_receipt(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.list_customer_bookings_for_browser(text, text) from public, anon, authenticated;
revoke execute on function public.cancel_customer_booking_for_browser(uuid, text, text) from public, anon, authenticated;
grant execute on function public.append_customer_booking_receipt(uuid, text, text, text) to service_role;
grant execute on function public.list_customer_bookings_for_browser(text, text) to service_role;
grant execute on function public.cancel_customer_booking_for_browser(uuid, text, text) to service_role;
revoke execute on function public.forget_customer_booking_receipt(text) from public, anon, authenticated;
grant execute on function public.forget_customer_booking_receipt(text) to service_role;
