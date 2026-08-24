-- Service availability is date-aware and weekly breaks are first-class availability facts.
-- Existing services intentionally retain their current every-day behaviour. Existing barber schedules
-- are not rewritten: only barbers with no saved week start off through the editor/DB defaults.

alter table public.services
  add column available_weekdays smallint[] not null
    default array[0, 1, 2, 3, 4, 5, 6]::smallint[];

alter table public.services
  add constraint services_available_weekdays_valid
  check (
    pg_catalog.cardinality(available_weekdays) between 1 and 7
    and available_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and pg_catalog.array_position(available_weekdays, null) is null
  );

-- A recurring break is local wall-clock time on one weekday. The exclusion constraint makes the
-- stored schedule unambiguous: two overlapping weekly breaks are one period, never two rows.
create table public.barber_recurring_breaks (
  id uuid primary key default gen_random_uuid(),
  barber_id text not null references public.barbers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_min smallint not null check (start_min between 540 and 1065 and start_min % 15 = 0),
  end_min smallint not null check (end_min between 555 and 1080 and end_min % 15 = 0),
  created_at timestamptz not null default pg_catalog.now(),
  constraint barber_recurring_breaks_time_order check (end_min > start_min),
  exclude using gist (
    barber_id with =,
    weekday with =,
    int4range(start_min, end_min, '[)') with &&
  )
);

create index barber_recurring_breaks_barber_weekday_start_idx
  on public.barber_recurring_breaks (barber_id, weekday, start_min);

alter table public.barber_recurring_breaks enable row level security;
revoke all on table public.barber_recurring_breaks from public, anon, authenticated;
grant select on table public.barber_recurring_breaks to authenticated;

create policy recurring_breaks_select_owner_or_own
  on public.barber_recurring_breaks
  for select to authenticated
  using (
    public.is_owner()
    or barber_id = public.current_barber_id()
  );

-- Keep the generic public read API intact for admin previews, while making recurring breaks part of
-- the blocked interval union. The service-aware wrapper below is the client booking API.
create or replace function public.available_slots(
  p_barber_id text,
  p_date date,
  p_duration_min int
)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open int;
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
                 bk.end_at at time zone 'Europe/Stockholm' as e_loc
        ) loc
        where bk.barber_id = p_barber_id
          and bk.status = 'confirmed'
          and loc.s_loc::date = p_date
        union all
        select bl.start_min::int, bl.end_min::int
        from public.barber_slot_blocks bl
        where bl.barber_id = p_barber_id
          and bl.block_date = p_date
        union all
        select rb.start_min::int, rb.end_min::int
        from public.barber_recurring_breaks rb
        where rb.barber_id = p_barber_id
          and rb.weekday = pg_catalog.date_part('dow', p_date)::int
      ) blocked
      where gs.t < blocked.be and gs.t + p_duration_min > blocked.bs
    )
  order by gs.t;
end;
$$;

grant execute on function public.available_slots(text, date, int) to anon, authenticated;

-- The public booking client queries availability by service identity, not browser-supplied duration.
-- This keeps service weekday configuration in the authoritative database read path as well as writes.
create or replace function public.available_slots_for_service(
  p_barber_id text,
  p_date date,
  p_service_id text
)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_duration_min integer;
begin
  select s.duration_min
    into v_duration_min
  from public.services s
  join public.barbers b on b.id = s.barber_id and b.active = true
  where s.id::text = p_service_id
    and s.barber_id = p_barber_id
    and s.active = true
    and pg_catalog.date_part('dow', p_date)::smallint = any (s.available_weekdays);

  if not found then
    return;
  end if;

  return query
  select slot
  from public.available_slots(p_barber_id, p_date, v_duration_min) as slot;
end;
$$;

revoke execute on function public.available_slots_for_service(text, date, text) from public;
grant execute on function public.available_slots_for_service(text, date, text) to anon, authenticated;

-- Public write authority: service weekday and recurring-break checks use the same local, half-open
-- interval model as available_slots(). The existing advisory lock serializes this with availability edits.
create or replace function public.create_booking(
  p_barber_id text,
  p_service_id text,
  p_start_at timestamptz,
  p_phone text,
  p_email text,
  p_lang text,
  p_customer_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_end_at timestamptz;
  v_row public.bookings;
  v_local_ts timestamp;
  v_weekday int;
  v_slot_min int;
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
  v_weekday := pg_catalog.date_part('dow', v_local_ts)::int;
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

  if not v_weekday::smallint = any (v_service.available_weekdays) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
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
      and v_slot_min + v_service.duration_min <= s.end_min
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  if exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and v_local_ts::date between t.start_date and t.end_date
  ) or exists (
    select 1
    from public.barber_slot_blocks bl
    where bl.barber_id = p_barber_id
      and bl.block_date = v_local_ts::date
      and bl.start_min < v_slot_min + v_service.duration_min
      and bl.end_min > v_slot_min
  ) or exists (
    select 1
    from public.barber_recurring_breaks rb
    where rb.barber_id = p_barber_id
      and rb.weekday = v_weekday
      and rb.start_min < v_slot_min + v_service.duration_min
      and rb.end_min > v_slot_min
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
      'id', v_row.id,
      'barber_id', v_row.barber_id,
      'service_id', v_row.service_id,
      'service_name', v_row.service_name,
      'price', v_row.price,
      'duration_min', v_row.duration_min,
      'start_at', v_row.start_at,
      'end_at', v_row.end_at,
      'method', v_row.method,
      'lang', v_row.lang
    )
  );
end;
$$;

-- Manual staff reservations cannot silently cross a recurring locked period either.
create or replace function public.admin_create_booking(
  p_barber_id text,
  p_start_at timestamptz,
  p_duration_min int,
  p_service_name text,
  p_price int,
  p_customer_name text,
  p_phone text
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

-- Recurring break mutations serialize with booking creation and report the same concrete customer
-- conflicts as weekly schedule/time-off edits before an operator deliberately overrides them.
create or replace function public.admin_add_recurring_break(
  p_barber_id text,
  p_weekday integer,
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
  v_row public.barber_recurring_breaks;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_weekday is null
     or p_start_min is null
     or p_end_min is null
     or p_weekday not between 0 and 6
     or p_start_min not between 540 and 1065
     or p_end_min not between 555 and 1080
     or p_start_min % 15 <> 0
     or p_end_min % 15 <> 0
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
      select b.start_at at time zone 'Europe/Stockholm' as local_start,
             b.end_at at time zone 'Europe/Stockholm' as local_end
    ) local_time
    where b.barber_id = p_barber_id
      and b.status = 'confirmed'
      and b.end_at > pg_catalog.now()
      and pg_catalog.date_part('dow', local_time.local_start)::integer = p_weekday
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
    insert into public.barber_recurring_breaks (barber_id, weekday, start_min, end_min)
    values (p_barber_id, p_weekday, p_start_min, p_end_min)
    returning * into v_row;
  exception
    when exclusion_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate');
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

create or replace function public.admin_delete_recurring_break(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barber_id text;
begin
  select rb.barber_id into v_barber_id
  from public.barber_recurring_breaks rb
  where rb.id = p_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not coalesce(public.is_owner() or v_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.barber_recurring_breaks where id = p_id;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_add_recurring_break(text, integer, integer, integer, boolean)
  from public, anon;
revoke execute on function public.admin_delete_recurring_break(uuid) from public, anon;
grant execute on function public.admin_add_recurring_break(text, integer, integer, integer, boolean)
  to authenticated;
grant execute on function public.admin_delete_recurring_break(uuid) to authenticated;

-- Every schedule editor option is now a 15-minute wall-clock value within the public 09:00–18:00 day.
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
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
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
      and d.start_min between 540 and 1065
      and d.end_min between 555 and 1080
      and d.start_min % 15 = 0
      and d.end_min % 15 = 0
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
