-- Public bookings are delivered by email. Phone remains required only for customer self-service
-- lookup and review eligibility; it no longer defines the booking delivery method.

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
) from public;
revoke execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) from anon, authenticated;
grant execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) to service_role;

update public.bookings
set method = 'email'
where email is not null
  and method <> 'email';
