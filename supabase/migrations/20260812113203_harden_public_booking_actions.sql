-- Restore write-path agreement with available_slots after the server-authoritative service
-- migration replaced create_booking without its barber_slot_blocks check.
create or replace function public.create_booking(
  p_barber_id     text,
  p_service_id    text,
  p_start_at      timestamptz,
  p_phone         text,
  p_email         text,
  p_lang          text,
  p_customer_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service   public.services;
  v_end_at    timestamptz;
  v_row       public.bookings;
  v_local_ts  timestamp;
  v_weekday   int;
  v_slot_min  int;
begin
  if p_start_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  if p_phone is null or p_phone = '' or p_email is null or p_email = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  if p_lang not in ('sv', 'en') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.* into v_service
  from public.services s
  where s.id::text = p_service_id
    and s.barber_id = p_barber_id
    and s.active = true;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_local_ts := p_start_at at time zone 'Europe/Stockholm';
  v_weekday  := pg_catalog.date_part('dow', v_local_ts)::int;
  v_slot_min := pg_catalog.date_part('hour', v_local_ts)::int * 60
              + pg_catalog.date_part('minute', v_local_ts)::int;

  if not exists (
    select 1
    from public.barber_schedules s
    where s.barber_id = p_barber_id
      and s.working = true
      and s.weekday = v_weekday
      and v_slot_min >= s.start_min
      and v_slot_min + v_service.duration_min <= s.end_min
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  if exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and v_local_ts::date between t.start_date and t.end_date
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  if exists (
    select 1
    from public.barber_slot_blocks bl
    where bl.barber_id = p_barber_id
      and bl.block_date = v_local_ts::date
      and bl.start_min < v_slot_min + v_service.duration_min
      and bl.end_min > v_slot_min
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  v_end_at := p_start_at + pg_catalog.make_interval(mins => v_service.duration_min);

  begin
    insert into public.bookings (
      barber_id, service_id, service_name, price, duration_min,
      start_at, end_at, customer_name, method, phone, email, lang
    ) values (
      p_barber_id, v_service.id::text, v_service.name, v_service.price, v_service.duration_min,
      p_start_at, v_end_at, p_customer_name, 'email', p_phone, pg_catalog.lower(p_email), p_lang
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation or foreign_key_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_id',   v_row.service_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'duration_min', v_row.duration_min,
      'start_at',     v_row.start_at,
      'end_at',       v_row.end_at,
      'method',       v_row.method,
      'lang',         v_row.lang
    )
  );
end;
$$;

revoke execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) to service_role;

-- Public customer self-service is routed through one Edge Function. Raw phone numbers remain the
-- booking key, but anonymous browsers can no longer call privileged RPCs directly.
create table public.public_action_attempts (
  id         bigint generated always as identity primary key,
  action     text not null check (action in ('lookup', 'list', 'cancel', 'review')),
  ip_hash    text not null check (char_length(ip_hash) = 64),
  phone_hash text not null check (char_length(phone_hash) = 64),
  created_at timestamptz not null default pg_catalog.now()
);

create index public_action_attempts_ip_idx
on public.public_action_attempts (action, ip_hash, created_at);

create index public_action_attempts_phone_idx
on public.public_action_attempts (action, phone_hash, created_at);

alter table public.public_action_attempts enable row level security;
revoke all on table public.public_action_attempts from public, anon, authenticated, service_role;
revoke all on sequence public.public_action_attempts_id_seq
from public, anon, authenticated, service_role;

create or replace function public.consume_public_action_attempt(
  p_action       text,
  p_ip_hash      text,
  p_phone_hash   text,
  p_window_secs  integer,
  p_ip_limit     integer,
  p_phone_limit  integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if p_action not in ('lookup', 'list', 'cancel', 'review')
     or char_length(p_ip_hash) <> 64
     or char_length(p_phone_hash) <> 64
     or p_window_secs < 60
     or p_window_secs > 172800
     or p_ip_limit < 1
     or p_ip_limit > 100
     or p_phone_limit < 1
     or p_phone_limit > 100 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public-action:ip:' || p_action || ':' || p_ip_hash)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public-action:phone:' || p_action || ':' || p_phone_hash)
  );

  v_since := pg_catalog.now() - pg_catalog.make_interval(secs => p_window_secs);

  if (
    select pg_catalog.count(*)
    from public.public_action_attempts a
    where a.action = p_action
      and a.ip_hash = p_ip_hash
      and a.created_at >= v_since
  ) >= p_ip_limit then
    return false;
  end if;

  if (
    select pg_catalog.count(*)
    from public.public_action_attempts a
    where a.action = p_action
      and a.phone_hash = p_phone_hash
      and a.created_at >= v_since
  ) >= p_phone_limit then
    return false;
  end if;

  insert into public.public_action_attempts (action, ip_hash, phone_hash)
  values (p_action, p_ip_hash, p_phone_hash);

  delete from public.public_action_attempts
  where created_at < pg_catalog.now() - interval '2 days';

  return true;
end;
$$;

revoke execute on function public.consume_public_action_attempt(
  text, text, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.consume_public_action_attempt(
  text, text, text, integer, integer, integer
) to service_role;

create unique index if not exists profiles_one_account_per_barber_idx
on public.profiles (barber_id)
where barber_id is not null;

revoke execute on function public.lookup_booking(text) from public, anon, authenticated;
revoke execute on function public.list_bookings_by_phone(text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_review(text, integer, text) from public, anon, authenticated;

grant execute on function public.lookup_booking(text) to service_role;
grant execute on function public.list_bookings_by_phone(text) to service_role;
grant execute on function public.cancel_booking(uuid, text) to service_role;
grant execute on function public.create_review(text, integer, text) to service_role;
