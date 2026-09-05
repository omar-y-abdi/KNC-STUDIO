-- Service prices are SEK values, not integer counters. Keep the database exact and reject more than
-- two fractional digits instead of letting a numeric cast silently round an owner-entered value.
alter table public.services
  drop constraint if exists services_price_range;
alter table public.services
  alter column price type numeric
  using price::numeric;
alter table public.services
  add constraint services_price_range check (
    price >= 0
    and price <= 100000
    and price = pg_catalog.trunc(price, 2)
  );

alter table public.bookings
  drop constraint if exists bookings_price_check;
alter table public.bookings
  alter column price type numeric
  using price::numeric;
alter table public.bookings
  add constraint bookings_price_check check (
    price >= 0
    and price <= 100000
    and price = pg_catalog.trunc(price, 2)
  );

-- The manual admin reservation path must accept the same exact price representation as services.
drop function public.admin_create_booking(
  text, timestamptz, integer, text, integer, text, text
);

create function public.admin_create_booking(
  p_barber_id     text,
  p_start_at      timestamptz,
  p_duration_min  int,
  p_service_name  text,
  p_price         numeric,
  p_customer_name text,
  p_phone         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end_at timestamptz;
  v_method text;
  v_phone text;
  v_service_name text;
  v_customer_name text;
  v_row public.bookings;
  v_local_ts timestamp;
  v_weekday integer;
  v_slot_min integer;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_service_name := pg_catalog.btrim(coalesce(p_service_name, ''));
  v_customer_name := pg_catalog.btrim(coalesce(p_customer_name, ''));
  v_phone := nullif(pg_catalog.btrim(coalesce(p_phone, '')), '');

  if p_start_at is null
     or p_start_at <= pg_catalog.now()
     or p_duration_min is null
     or p_duration_min not between 15 and 480
     or p_start_at <> pg_catalog.date_trunc('minute', p_start_at)
     or pg_catalog.char_length(v_service_name) not between 1 and 80
     or p_price is null
     or p_price < 0
     or p_price > 100000
     or p_price <> pg_catalog.trunc(p_price, 2)
     or pg_catalog.char_length(v_customer_name) not between 1 and 80
     or (v_phone is not null and v_phone !~ '^07[0-9]{8}$') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_method := case when v_phone is null then 'walkin' else 'phone' end;
  v_end_at := p_start_at + pg_catalog.make_interval(mins => p_duration_min);
  v_local_ts := p_start_at at time zone 'Europe/Stockholm';
  v_weekday := pg_catalog.date_part('dow', v_local_ts)::integer;
  v_slot_min := pg_catalog.date_part('hour', v_local_ts)::integer * 60
              + pg_catalog.date_part('minute', v_local_ts)::integer;

  if v_slot_min % 15 <> 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('availability:' || p_barber_id, 0)
  );

  if not exists (
    select 1
    from public.barber_schedules s
    where s.barber_id = p_barber_id
      and s.working = true
      and s.weekday = v_weekday
      and v_slot_min >= s.start_min
      and v_slot_min + p_duration_min <= s.end_min
  ) or exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and v_local_ts::date between t.start_date and t.end_date
  ) or exists (
    select 1
    from public.barber_slot_blocks bl
    where bl.barber_id = p_barber_id
      and bl.block_date = v_local_ts::date
      and bl.start_min < v_slot_min + p_duration_min
      and bl.end_min > v_slot_min
  ) or exists (
    select 1
    from public.barber_recurring_breaks rb
    where rb.barber_id = p_barber_id
      and rb.weekday = v_weekday
      and rb.start_min < v_slot_min + p_duration_min
      and rb.end_min > v_slot_min
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  begin
    insert into public.bookings (
      barber_id, service_id, service_name, price, duration_min,
      start_at, end_at, customer_name, method, phone, email, lang
    ) values (
      p_barber_id, 'manual', v_service_name, p_price, p_duration_min,
      p_start_at, v_end_at, v_customer_name, v_method, v_phone, null, 'sv'
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation or foreign_key_violation or not_null_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'barber_id', v_row.barber_id,
      'service_name', v_row.service_name,
      'price', v_row.price,
      'duration_min', v_row.duration_min,
      'start_at', v_row.start_at,
      'end_at', v_row.end_at,
      'customer_name', v_row.customer_name,
      'method', v_row.method,
      'phone', v_row.phone
    )
  );
end;
$$;

revoke execute on function public.admin_create_booking(
  text, timestamptz, integer, text, numeric, text, text
) from public;
grant execute on function public.admin_create_booking(
  text, timestamptz, integer, text, numeric, text, text
) to authenticated;
