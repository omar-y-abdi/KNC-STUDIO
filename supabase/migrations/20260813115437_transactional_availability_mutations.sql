-- Availability mutations and public booking creation share one per-barber transaction lock. This
-- closes the race where a customer commits after the admin UI snapshot but before a schedule block.

create or replace function public.admin_save_barber_week(
  p_barber_id text,
  p_week jsonb,
  p_allow_existing_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_distinct integer;
  v_conflicts jsonb;
begin
  if not coalesce(
    public.is_owner()
    or p_barber_id = public.current_barber_id(),
    false
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_week is null
     or pg_catalog.jsonb_typeof(p_week) <> 'array'
     or pg_catalog.jsonb_array_length(p_week) <> 7 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  begin
    select pg_catalog.count(*), pg_catalog.count(distinct d.weekday)
      into v_count, v_distinct
    from pg_catalog.jsonb_to_recordset(p_week)
      as d(weekday integer, working boolean, start_min integer, end_min integer)
    where d.weekday between 0 and 6
      and d.working is not null
      and d.start_min between 0 and 1439
      and d.end_min between 1 and 1440
      and d.end_min > d.start_min;
  exception when others then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  if v_count <> 7 or v_distinct <> 7 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('availability:' || p_barber_id, 0)
  );

  select coalesce(pg_catalog.jsonb_agg(conflict.id order by conflict.start_at), '[]'::jsonb)
    into v_conflicts
  from (
    select b.id, b.start_at
    from public.bookings b
    cross join lateral (
      select b.start_at at time zone 'Europe/Stockholm' as local_start
    ) local_time
    where b.barber_id = p_barber_id
      and b.status = 'confirmed'
      and b.end_at > pg_catalog.now()
      and not exists (
        select 1
        from pg_catalog.jsonb_to_recordset(p_week)
          as d(weekday integer, working boolean, start_min integer, end_min integer)
        where d.weekday = pg_catalog.date_part('dow', local_time.local_start)::integer
          and d.working = true
          and (
            pg_catalog.date_part('hour', local_time.local_start)::integer * 60
            + pg_catalog.date_part('minute', local_time.local_start)::integer
          ) >= d.start_min
          and (
            pg_catalog.date_part('hour', local_time.local_start)::integer * 60
            + pg_catalog.date_part('minute', local_time.local_start)::integer
            + b.duration_min
          ) <= d.end_min
      )
  ) conflict;

  if pg_catalog.jsonb_array_length(v_conflicts) > 0
     and not coalesce(p_allow_existing_bookings, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'booking_conflict',
      'booking_ids', v_conflicts
    );
  end if;

  insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
  select p_barber_id, d.weekday, d.working, d.start_min, d.end_min
  from pg_catalog.jsonb_to_recordset(p_week)
    as d(weekday integer, working boolean, start_min integer, end_min integer)
  on conflict (barber_id, weekday) do update
    set working = excluded.working,
        start_min = excluded.start_min,
        end_min = excluded.end_min;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_add_time_off(
  p_barber_id text,
  p_start_date date,
  p_end_date date,
  p_reason text,
  p_allow_existing_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflicts jsonb;
  v_row public.barber_time_off;
begin
  if not coalesce(
    public.is_owner()
    or p_barber_id = public.current_barber_id(),
    false
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_start_date is null
     or p_end_date is null
     or p_end_date < p_start_date
     or pg_catalog.char_length(coalesce(p_reason, '')) > 120 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('availability:' || p_barber_id, 0)
  );

  select coalesce(pg_catalog.jsonb_agg(b.id order by b.start_at), '[]'::jsonb)
    into v_conflicts
  from public.bookings b
  where b.barber_id = p_barber_id
    and b.status = 'confirmed'
    and b.end_at > pg_catalog.now()
    and (b.start_at at time zone 'Europe/Stockholm')::date between p_start_date and p_end_date;

  if pg_catalog.jsonb_array_length(v_conflicts) > 0
     and not coalesce(p_allow_existing_bookings, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'booking_conflict',
      'booking_ids', v_conflicts
    );
  end if;

  insert into public.barber_time_off (barber_id, start_date, end_date, reason)
  values (p_barber_id, p_start_date, p_end_date, coalesce(p_reason, ''))
  returning * into v_row;

  return pg_catalog.jsonb_build_object('ok', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

create or replace function public.admin_add_slot_block(
  p_barber_id text,
  p_block_date date,
  p_start_min integer,
  p_end_min integer,
  p_allow_existing_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflicts jsonb;
  v_row public.barber_slot_blocks;
begin
  if not coalesce(
    public.is_owner()
    or p_barber_id = public.current_barber_id(),
    false
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_block_date is null
     or p_start_min is null
     or p_end_min is null
     or p_start_min not between 0 and 1439
     or p_end_min not between 1 and 1440
     or p_end_min <= p_start_min then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('availability:' || p_barber_id, 0)
  );

  select coalesce(pg_catalog.jsonb_agg(conflict.id order by conflict.start_at), '[]'::jsonb)
    into v_conflicts
  from (
    select b.id, b.start_at
    from public.bookings b
    cross join lateral (
      select
        b.start_at at time zone 'Europe/Stockholm' as local_start,
        b.end_at at time zone 'Europe/Stockholm' as local_end
    ) local_time
    where b.barber_id = p_barber_id
      and b.status = 'confirmed'
      and b.end_at > pg_catalog.now()
      and local_time.local_start::date = p_block_date
      and (
        pg_catalog.date_part('hour', local_time.local_start)::integer * 60
        + pg_catalog.date_part('minute', local_time.local_start)::integer
      ) < p_end_min
      and (
        pg_catalog.date_part('hour', local_time.local_end)::integer * 60
        + pg_catalog.date_part('minute', local_time.local_end)::integer
      ) > p_start_min
  ) conflict;

  if pg_catalog.jsonb_array_length(v_conflicts) > 0
     and not coalesce(p_allow_existing_bookings, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'booking_conflict',
      'booking_ids', v_conflicts
    );
  end if;

  begin
    insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
    values (p_barber_id, p_block_date, p_start_min, p_end_min)
    returning * into v_row;
  exception when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate');
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

revoke insert, update, delete on table public.barber_schedules from authenticated;
revoke insert, update on table public.barber_time_off from authenticated;
revoke insert, update on table public.barber_slot_blocks from authenticated;

revoke execute on function public.admin_save_barber_week(text, jsonb, boolean) from public, anon;
revoke execute on function public.admin_add_time_off(text, date, date, text, boolean) from public, anon;
revoke execute on function public.admin_add_slot_block(text, date, integer, integer, boolean)
  from public, anon;
grant execute on function public.admin_save_barber_week(text, jsonb, boolean) to authenticated;
grant execute on function public.admin_add_time_off(text, date, date, text, boolean) to authenticated;
grant execute on function public.admin_add_slot_block(text, date, integer, integer, boolean)
  to authenticated;

-- Public booking rate limiting delegates to create_booking, whose core writer owns the shared
-- availability lock. Keeping one lock boundary covers both legacy expand traffic and the gateway.
create or replace function public.create_booking_with_limits(
  p_barber_id text,
  p_service_id text,
  p_start_at timestamptz,
  p_phone text,
  p_email text,
  p_lang text,
  p_customer_name text,
  p_ip_hash text,
  p_ip_window_secs integer,
  p_phone_window_secs integer,
  p_ip_limit integer,
  p_phone_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
begin
  if pg_catalog.char_length(p_ip_hash) <> 64
     or p_ip_window_secs not between 60 and 172800
     or p_phone_window_secs not between 60 and 172800
     or p_ip_limit not between 1 and 100
     or p_phone_limit not between 1 and 100 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('booking-rate:ip:' || p_ip_hash));
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

-- Manual reservations obey the same availability facts as the schedule UI and serialize against
-- concurrent schedule mutations. Staff may still choose arbitrary customer-facing service text, but
-- cannot silently reserve a closed, blocked, past, or time-off slot.
create or replace function public.admin_create_booking(
  p_barber_id     text,
  p_start_at      timestamptz,
  p_duration_min  int,
  p_service_name  text,
  p_price         int,
  p_customer_name text,
  p_phone         text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end_at   timestamptz;
  v_method   text;
  v_phone    text;
  v_service_name text;
  v_customer_name text;
  v_row      public.bookings;
  v_local_ts timestamp;
  v_weekday  integer;
  v_slot_min integer;
begin
  if not coalesce(
    public.is_owner()
    or p_barber_id = public.current_barber_id(),
    false
  ) then
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
     or p_price not between 0 and 100000
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
      'id',            v_row.id,
      'barber_id',     v_row.barber_id,
      'service_name',  v_row.service_name,
      'price',         v_row.price,
      'duration_min',  v_row.duration_min,
      'start_at',      v_row.start_at,
      'end_at',        v_row.end_at,
      'customer_name', v_row.customer_name,
      'method',        v_row.method,
      'phone',         v_row.phone
    )
  );
end;
$$;

revoke execute on function public.admin_create_booking(
  text, timestamptz, int, text, int, text, text
) from public, anon;
grant execute on function public.admin_create_booking(
  text, timestamptz, int, text, int, text, text
) to authenticated;
