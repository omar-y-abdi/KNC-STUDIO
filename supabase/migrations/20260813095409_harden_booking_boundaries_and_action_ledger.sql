-- Keep the public write path on the same quarter-hour grid as available_slots, reject historical
-- customer cancellations, and make the rate-limit ledger's age cleanup index-backed.

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
  if p_start_at is null or p_start_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  if p_phone is null or p_phone = '' or p_email is null or p_email = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  if p_lang not in ('sv', 'en') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_local_ts := p_start_at at time zone 'Europe/Stockholm';
  v_weekday  := pg_catalog.date_part('dow', v_local_ts)::int;
  v_slot_min := pg_catalog.date_part('hour', v_local_ts)::int * 60
              + pg_catalog.date_part('minute', v_local_ts)::int;

  if p_start_at <> pg_catalog.date_trunc('minute', p_start_at)
     or v_slot_min % 15 <> 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  select s.* into v_service
  from public.services s
  join public.barbers b on b.id = s.barber_id and b.active = true
  where s.id::text = p_service_id
    and s.barber_id = p_barber_id
    and s.active = true;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

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

create or replace function public.available_slots(
  p_barber_id    text,
  p_date         date,
  p_duration_min int
)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open  int;
  v_close int;
begin
  if p_duration_min is null or p_duration_min <= 0 then
    return;
  end if;

  if not exists (
    select 1 from public.barbers b where b.id = p_barber_id and b.active = true
  ) then
    return;
  end if;

  select s.start_min, s.end_min
    into v_open, v_close
  from public.barber_schedules s
  where s.barber_id = p_barber_id
    and s.working = true
    and s.weekday = pg_catalog.date_part('dow', p_date)::int
  limit 1;

  if not found then
    return;
  end if;

  if exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and p_date between t.start_date and t.end_date
  ) then
    return;
  end if;

  if v_close <= v_open then
    return;
  end if;

  return query
  select pg_catalog.to_char(pg_catalog.make_time(gs.t / 60, gs.t % 60, 0), 'HH24:MI')
  from pg_catalog.generate_series(v_open, v_close - p_duration_min, 15) as gs(t)
  where ((p_date + pg_catalog.make_time(gs.t / 60, gs.t % 60, 0))
           at time zone 'Europe/Stockholm') > pg_catalog.now()
    and not exists (
      select 1
      from (
        select
          pg_catalog.date_part('hour', loc.s_loc)::int * 60
            + pg_catalog.date_part('minute', loc.s_loc)::int as bs,
          pg_catalog.date_part('hour', loc.e_loc)::int * 60
            + pg_catalog.date_part('minute', loc.e_loc)::int as be
        from public.bookings bk
        cross join lateral (
          select bk.start_at at time zone 'Europe/Stockholm' as s_loc,
                 bk.end_at   at time zone 'Europe/Stockholm' as e_loc
        ) loc
        where bk.barber_id = p_barber_id
          and bk.status = 'confirmed'
          and loc.s_loc::date = p_date
        union all
        select bl.start_min::int as bs, bl.end_min::int as be
        from public.barber_slot_blocks bl
        where bl.barber_id = p_barber_id
          and bl.block_date = p_date
      ) b
      where gs.t < b.be and gs.t + p_duration_min > b.bs
    )
  order by gs.t;

  return;
end;
$$;

grant execute on function public.available_slots(text, date, int) to anon, authenticated;

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_contact    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row          public.bookings;
  v_cutoff_hours integer;
begin
  select case
           when s.value ~ '^[0-9]{1,3}$' then least(s.value::integer, 168)
           else 24
         end
    into v_cutoff_hours
  from public.site_settings s
  where s.key = 'cancellation_policy_hours';

  v_cutoff_hours := coalesce(v_cutoff_hours, 24);

  update public.bookings b
  set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id
    and b.status = 'confirmed'
    and b.start_at > pg_catalog.now() + pg_catalog.make_interval(hours => v_cutoff_hours)
    and b.phone = p_contact
  returning * into v_row;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'start_at',     v_row.start_at,
      'method',       v_row.method,
      'contact',      p_contact
    )
  );
end;
$$;

revoke execute on function public.cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, text) to service_role;

create index if not exists public_action_attempts_created_at_idx
on public.public_action_attempts (created_at);

create index if not exists booking_attempts_created_at_idx
on public.booking_attempts (created_at);

revoke select, insert, delete on table public.booking_attempts from service_role;
revoke usage on sequence public.booking_attempts_id_seq from service_role;

create or replace function public.create_booking_with_limits(
  p_barber_id         text,
  p_service_id        text,
  p_start_at          timestamptz,
  p_phone             text,
  p_email             text,
  p_lang              text,
  p_customer_name     text,
  p_ip_hash           text,
  p_ip_window_secs    integer,
  p_phone_window_secs integer,
  p_ip_limit          integer,
  p_phone_limit       integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now pg_catalog.timestamptz := pg_catalog.now();
begin
  if char_length(p_ip_hash) <> 64
     or p_ip_window_secs not between 60 and 172800
     or p_phone_window_secs not between 60 and 172800
     or p_ip_limit not between 1 and 100
     or p_phone_limit not between 1 and 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('booking-rate:ip:' || p_ip_hash)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('booking-rate:phone:' || coalesce(p_phone, ''))
  );

  if (
    select pg_catalog.count(*)
    from public.booking_attempts a
    where a.ip_hash = p_ip_hash
      and a.created_at >= v_now - pg_catalog.make_interval(secs => p_ip_window_secs)
  ) >= p_ip_limit then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if (
    select pg_catalog.count(*)
    from public.bookings b
    where b.phone = p_phone
      and b.created_at >= v_now - pg_catalog.make_interval(secs => p_phone_window_secs)
  ) >= p_phone_limit then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.booking_attempts (ip_hash) values (p_ip_hash);

  return public.create_booking(
    p_barber_id,
    p_service_id,
    p_start_at,
    p_phone,
    p_email,
    p_lang,
    p_customer_name
  );
end;
$$;

revoke execute on function public.create_booking_with_limits(
  text, text, timestamptz, text, text, text, text, text, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.create_booking_with_limits(
  text, text, timestamptz, text, text, text, text, text, integer, integer, integer, integer
) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-attempt-cleanup') then
    perform cron.unschedule('booking-attempt-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'booking-attempt-cleanup',
  '23 * * * *',
  $$delete from public.booking_attempts
    where created_at < pg_catalog.now() - interval '2 days'$$
);

create or replace function public.calendar_backfill_source(p_barber_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'refresh_token', t.refresh_token,
    'calendar_id',   t.calendar_id,
    'bookings', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',              b.id,
        'service_name',    b.service_name,
        'customer_name',   b.customer_name,
        'phone',           b.phone,
        'start_at',        b.start_at,
        'end_at',          b.end_at,
        'google_event_id', m.google_event_id
      ) order by b.start_at)
      from public.bookings b
      left join public.calendar_event_map m on m.booking_id = b.id
      where b.barber_id = p_barber_id
        and b.status = 'confirmed'
        and b.end_at > pg_catalog.now()
    ), '[]'::jsonb)
  )
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id;
$$;

revoke execute on function public.calendar_backfill_source(text) from public, anon, authenticated;
grant execute on function public.calendar_backfill_source(text) to service_role;
