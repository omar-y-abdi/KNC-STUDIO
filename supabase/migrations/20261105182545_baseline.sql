-- Baseline schema.
--
-- One file that builds the database the 106 original migrations (20260623152736 … 20261105182545)
-- built, generated with `supabase migration squash` and completed by hand where the dump is
-- silent: privileges that depend on the platform's defaults, scheduled jobs, storage buckets and
-- default rows. It keeps the version of the last original migration, so a database that already
-- ran them treats it as applied. Add new migrations after it; do not edit it.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

COMMENT ON SCHEMA "public" IS 'standard public schema';

-- Created in "public" and then moved, as the original migrations did: the extension's functions
-- keep the privileges they have in production.
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";
ALTER EXTENSION "btree_gist" SET SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE OR REPLACE FUNCTION "public"."admin_add_recurring_break"("p_barber_id" "text", "p_weekday" integer, "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."admin_add_recurring_break"("p_barber_id" "text", "p_weekday" integer, "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_add_slot_block"("p_barber_id" "text", "p_block_date" "date", "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."admin_add_slot_block"("p_barber_id" "text", "p_block_date" "date", "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_add_time_off"("p_barber_id" "text", "p_start_date" "date", "p_end_date" "date", "p_reason" "text", "p_allow_existing_bookings" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."admin_add_time_off"("p_barber_id" "text", "p_start_date" "date", "p_end_date" "date", "p_reason" "text", "p_allow_existing_bookings" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_cancel_booking"("p_booking_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking public.bookings;
  v_row     public.bookings;
begin
  -- Load the target booking (regardless of status) to authorize against its barber_id.
  select * into v_booking from public.bookings b where b.id = p_booking_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Authorize: owner may cancel any; a barber may cancel only their own.
  if not (
    public.is_owner()
    or (public.current_barber_id() is not null
        and v_booking.barber_id = public.current_barber_id())
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Cancel only if currently confirmed (idempotent: a second call finds it cancelled -> not_found).
  update public.bookings b
  set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id
    and b.status = 'confirmed'
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
      'start_at',     v_row.start_at,
      'status',       v_row.status,
      'cancelled_at', v_row.cancelled_at
    )
  );
end;
$$;

ALTER FUNCTION "public"."admin_cancel_booking"("p_booking_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_create_booking"("p_barber_id" "text", "p_start_at" timestamp with time zone, "p_duration_min" integer, "p_service_name" "text", "p_price" numeric, "p_customer_name" "text", "p_phone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;

ALTER FUNCTION "public"."admin_create_booking"("p_barber_id" "text", "p_start_at" timestamp with time zone, "p_duration_min" integer, "p_service_name" "text", "p_price" numeric, "p_customer_name" "text", "p_phone" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_create_service"("p_barber_id" "text", "p_name" "text", "p_price" numeric, "p_duration_min" integer, "p_active" boolean, "p_available_weekdays" smallint[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_name text;
  v_next_order integer;
  v_row public.services;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if pg_catalog.char_length(v_name) not between 1 and 80
     or p_price is null
     or p_price < 0
     or p_price > 100000
     or p_price <> pg_catalog.trunc(p_price, 2)
     or p_duration_min is null
     or p_duration_min not between 5 and 600
     or p_active is null
     or p_available_weekdays is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('service-order:' || p_barber_id, 0)
  );

  select coalesce(max(s.sort_order) + 1, 0)
    into v_next_order
    from public.services s
   where s.barber_id = p_barber_id;

  begin
    insert into public.services (
      barber_id, name, price, duration_min, active, sort_order, available_weekdays
    ) values (
      p_barber_id, v_name, p_price, p_duration_min, p_active, v_next_order, p_available_weekdays
    )
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate');
    when check_violation or foreign_key_violation or not_null_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

ALTER FUNCTION "public"."admin_create_service"("p_barber_id" "text", "p_name" "text", "p_price" numeric, "p_duration_min" integer, "p_active" boolean, "p_available_weekdays" smallint[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_delete_barber"("p_barber_id" "text", "p_purge_bookings" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count bigint;
  v_upcoming bigint;
  v_past bigint;
  v_deleted bigint := 0;
  v_calendar_count bigint;
  v_user_id uuid;
  v_auth_action_id uuid;
  v_map record;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_barber_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('availability:' || p_barber_id, 0)
  );

  perform 1 from public.barbers b where b.id = p_barber_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform 1
  from public.bookings b
  where b.barber_id = p_barber_id
  order by b.id
  for update;

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where b.status = 'confirmed' and b.end_at > pg_catalog.now()
         )
    into v_count, v_upcoming
  from public.bookings b
  where b.barber_id = p_barber_id;
  v_past := v_count - v_upcoming;

  if v_upcoming > 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'has_upcoming',
      'count', v_count,
      'past', v_past,
      'upcoming', v_upcoming
    );
  end if;

  if v_count > 0 and not coalesce(p_purge_bookings, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'has_bookings',
      'count', v_count,
      'past', v_past,
      'upcoming', v_upcoming
    );
  end if;

  if coalesce(p_purge_bookings, false) and exists (
    select 1
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    where b.barber_id = p_barber_id
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  select pg_catalog.count(*) into v_calendar_count
  from public.calendar_event_map m
  where m.barber_id = p_barber_id;

  if v_calendar_count > 0 then
    for v_map in
      select m.booking_id
      from public.calendar_event_map m
      where m.barber_id = p_barber_id
    loop
      perform public.queue_calendar_event_deletion(v_map.booking_id);
    end loop;

    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'external_cleanup_pending',
      'calendar_events', v_calendar_count
    );
  end if;

  if exists (
    select 1 from public.barber_calendar_tokens t where t.barber_id = p_barber_id
  ) then
    perform public.prepare_calendar_disconnect(p_barber_id);
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'external_cleanup_pending',
      'calendar_events', 0
    );
  end if;

  if coalesce(p_purge_bookings, false) then
    delete from public.bookings b
    where b.barber_id = p_barber_id
      and not (b.status = 'confirmed' and b.end_at > pg_catalog.now());
    get diagnostics v_deleted = row_count;
  end if;

  select p.id into v_user_id
  from public.profiles p
  where p.role = 'barber' and p.barber_id = p_barber_id;

  if v_user_id is not null then
    v_auth_action_id := public.queue_external_action(
      'auth_user_delete',
      v_user_id::text,
      pg_catalog.jsonb_build_object('user_id', v_user_id)
    );
  end if;

  delete from public.profiles p where p.barber_id = p_barber_id;
  delete from public.barbers b where b.id = p_barber_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'deleted_bookings', v_deleted,
    'auth_action_id', v_auth_action_id
  );
end;
$$;

ALTER FUNCTION "public"."admin_delete_barber"("p_barber_id" "text", "p_purge_bookings" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_delete_bookings"("p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_is_owner boolean := public.is_owner();
  v_barber_id text := public.current_barber_id();
  v_count bigint;
begin
  if pg_catalog.array_length(p_ids, 1) is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  if not v_is_owner and v_barber_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not v_is_owner and exists (
    select 1
    from pg_catalog.unnest(p_ids) as req(id)
    where not exists (
      select 1 from public.bookings b
      where b.id = req.id and b.barber_id = v_barber_id
    )
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform 1
  from public.bookings b
  where b.id = any(p_ids)
  order by b.id
  for update;

  if exists (
    select 1
    from public.bookings b
    where b.id = any(p_ids)
      and b.status = 'confirmed'
      and b.end_at > pg_catalog.now()
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'has_upcoming');
  end if;

  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    where j.booking_id = any(p_ids)
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  delete from public.bookings
  where id = any(p_ids)
    and not (status = 'confirmed' and end_at > pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

ALTER FUNCTION "public"."admin_delete_bookings"("p_ids" "uuid"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_delete_recurring_break"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."admin_delete_recurring_break"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_delete_service"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_barber_id text;
  v_count integer;
begin
  select s.barber_id into v_barber_id
  from public.services s
  where s.id = p_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not coalesce(public.is_owner() or v_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('service-order:' || v_barber_id, 0)
  );

  delete from public.services where id = p_id;

  select count(*) into v_count
  from public.services s
  where s.barber_id = v_barber_id;

  -- Move every remaining row to a disjoint range first. This keeps the immediate unique constraint
  -- valid while compaction shifts positions toward zero.
  update public.services s
     set sort_order = s.sort_order + v_count + 1
   where s.barber_id = v_barber_id;

  with ranked as (
    select
      id,
      row_number() over (order by sort_order, id)::integer - 1 as new_order
    from public.services
    where barber_id = v_barber_id
  )
  update public.services s
     set sort_order = ranked.new_order
    from ranked
   where s.id = ranked.id;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

ALTER FUNCTION "public"."admin_delete_service"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_discard_failed_booking_email_delivery"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.account_enabled
      and not p.must_change_password
  ) then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  update public.booking_email_delivery_jobs j
  set status = 'skipped',
      completed_at = pg_catalog.now()
  where j.id = p_id
    and j.status = 'failed';

  return pg_catalog.jsonb_build_object('ok', found);
end;
$$;

ALTER FUNCTION "public"."admin_discard_failed_booking_email_delivery"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_get_email_send_log_entry"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.account_enabled
      and not p.must_change_password
  ) then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'id', l.id,
      'created_at', l.created_at,
      'last_attempt_at', l.last_attempt_at,
      'kind', l.kind,
      'recipient', l.recipient,
      'subject', l.subject,
      'status', l.status,
      'error_code', l.error_code,
      'booking_id', l.booking_id,
      'attempt_count', l.attempt_count,
      'html', l.html,
      'text_body', l.text_body
    )
    from public.email_send_log l
    where l.id = p_id
  );
end;
$$;

ALTER FUNCTION "public"."admin_get_email_send_log_entry"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_list_email_send_log"("p_before" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 50, "p_before_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.account_enabled
      and not p.must_change_password
  ) then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  if p_before is null and p_before_id is null then
    return (
      select pg_catalog.jsonb_build_object(
        'entries', coalesce(
          pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', page.id,
            'created_at', page.created_at,
            'last_attempt_at', page.last_attempt_at,
            'kind', page.kind,
            'recipient', page.recipient,
            'subject', page.subject,
            'status', page.status,
            'error_code', page.error_code,
            'booking_id', page.booking_id,
            'attempt_count', page.attempt_count
          ) order by page.position) filter (where page.position <= v_limit),
          '[]'::jsonb
        ),
        'has_more', pg_catalog.count(*) > v_limit
      )
      from (
        select l.id, l.created_at, l.last_attempt_at, l.kind, l.recipient, l.subject, l.status,
               l.error_code, l.booking_id, l.attempt_count,
               pg_catalog.row_number() over (order by l.created_at desc, l.id desc) as position
        from public.email_send_log l
        order by l.created_at desc, l.id desc
        limit v_limit + 1
      ) page
    );
  end if;

  if p_before is null or p_before_id is null then
    raise exception using errcode = '22023',
      message = 'a log cursor needs both p_before and p_before_id';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'entries', coalesce(
        pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', page.id,
          'created_at', page.created_at,
          'last_attempt_at', page.last_attempt_at,
          'kind', page.kind,
          'recipient', page.recipient,
          'subject', page.subject,
          'status', page.status,
          'error_code', page.error_code,
          'booking_id', page.booking_id,
          'attempt_count', page.attempt_count
        ) order by page.position) filter (where page.position <= v_limit),
        '[]'::jsonb
      ),
      'has_more', pg_catalog.count(*) > v_limit
    )
    from (
      select l.id, l.created_at, l.last_attempt_at, l.kind, l.recipient, l.subject, l.status,
             l.error_code, l.booking_id, l.attempt_count,
             pg_catalog.row_number() over (order by l.created_at desc, l.id desc) as position
      from public.email_send_log l
      where (l.created_at, l.id) < (p_before, p_before_id)
      order by l.created_at desc, l.id desc
      limit v_limit + 1
    ) page
  );
end;
$$;

ALTER FUNCTION "public"."admin_list_email_send_log"("p_before" timestamp with time zone, "p_limit" integer, "p_before_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_list_failed_booking_email_deliveries"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.account_enabled
      and not p.must_change_password
  ) then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', j.id,
      'booking_id', j.booking_id,
      'event', j.event,
      'attempt_count', j.attempt_count,
      'last_error_code', j.last_error_code,
      'failed_at', j.failed_at,
      'sent_kinds', j.sent_kinds,
      'customer_name', b.customer_name,
      'customer_email', b.email,
      'customer_phone', b.phone,
      'booking_start_at', b.start_at,
      'barber_name', coalesce(ba.name, b.barber_id),
      'barber_email', (
        select u.email
        from public.profiles p
        join auth.users u on u.id = p.id
        where p.role = 'barber'
          and p.barber_id = b.barber_id
        order by p.created_at asc
        limit 1
      )
    ) order by j.failed_at desc, j.created_at desc)
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    left join public.barbers ba on ba.id = b.barber_id
    where j.status = 'failed'
  ), '[]'::jsonb);
end;
$$;

ALTER FUNCTION "public"."admin_list_failed_booking_email_deliveries"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_purge_history"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count bigint;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform 1
  from public.bookings b
  where b.status = 'cancelled'
     or (b.status = 'confirmed' and b.end_at <= pg_catalog.now())
  order by b.id
  for update;

  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    where (b.status = 'cancelled'
        or (b.status = 'confirmed' and b.end_at <= pg_catalog.now()))
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  delete from public.bookings b
  where b.status = 'cancelled'
     or (b.status = 'confirmed' and b.end_at <= pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

ALTER FUNCTION "public"."admin_purge_history"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_reorder_service"("p_barber_id" "text", "p_service_id" "uuid", "p_direction" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_ids uuid[];
  v_position integer;
  v_target integer;
  v_count integer;
  v_swap uuid;
  v_services jsonb;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_direction not in (-1, 1) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('service-order:' || p_barber_id, 0)
  );

  select pg_catalog.array_agg(locked.id order by locked.sort_order, locked.id)
    into v_ids
    from (
      select s.id, s.sort_order
      from public.services s
      where s.barber_id = p_barber_id
      order by s.sort_order, s.id
      for update
    ) locked;

  v_count := coalesce(pg_catalog.array_length(v_ids, 1), 0);
  v_position := pg_catalog.array_position(v_ids, p_service_id);
  if v_position is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_target := v_position + p_direction;
  if v_target < 1 or v_target > v_count then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_swap := v_ids[v_position];
  v_ids[v_position] := v_ids[v_target];
  v_ids[v_target] := v_swap;

  -- The unique constraint must hold throughout the transaction, so use a disjoint temporary range
  -- before assigning the swapped zero-based positions.
  update public.services s
     set sort_order = s.sort_order + v_count + 1
   where s.barber_id = p_barber_id;

  for v_index in 1..v_count loop
    update public.services s
       set sort_order = v_index - 1
     where s.id = v_ids[v_index];
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.sort_order, s.id),
    '[]'::jsonb
  )
    into v_services
    from public.services s
   where s.barber_id = p_barber_id;

  return pg_catalog.jsonb_build_object('ok', true, 'services', v_services);
end;
$$;

ALTER FUNCTION "public"."admin_reorder_service"("p_barber_id" "text", "p_service_id" "uuid", "p_direction" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_retry_failed_booking_email_delivery"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.account_enabled
      and not p.must_change_password
  ) then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  update public.booking_email_delivery_jobs j
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = pg_catalog.now(),
      last_attempt_at = null,
      last_error_code = null,
      failed_at = null
  where j.id = p_id
    and j.status = 'failed';

  return pg_catalog.jsonb_build_object('ok', found);
end;
$$;

ALTER FUNCTION "public"."admin_retry_failed_booking_email_delivery"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_save_barber_week"("p_barber_id" "text", "p_week" "jsonb", "p_allow_existing_bookings" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."admin_save_barber_week"("p_barber_id" "text", "p_week" "jsonb", "p_allow_existing_bookings" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_set_barber_account_enabled"("p_barber_id" "text", "p_enabled" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_version bigint;
  v_action_id uuid;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_enabled is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  update public.profiles p
  set account_enabled = p_enabled,
      auth_sync_version = p.auth_sync_version + 1
  where p.role = 'barber'
    and p.barber_id = p_barber_id
  returning p.id, p.auth_sync_version into v_user_id, v_version;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;

  v_action_id := public.queue_external_action(
    'auth_user_access_sync',
    v_user_id::text,
    pg_catalog.jsonb_build_object(
      'user_id', v_user_id,
      'account_enabled', p_enabled,
      'version', v_version
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'account_enabled', p_enabled,
    'auth_sync_version', v_version,
    'action_id', v_action_id
  );
end;
$$;

ALTER FUNCTION "public"."admin_set_barber_account_enabled"("p_barber_id" "text", "p_enabled" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."append_customer_booking_receipt"("p_booking_id" "uuid", "p_existing_hash" "text", "p_new_hash" "text", "p_session_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;

ALTER FUNCTION "public"."append_customer_booking_receipt"("p_booking_id" "uuid", "p_existing_hash" "text", "p_new_hash" "text", "p_session_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."assign_booking_customer_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.ensure_customer_email_profile(new.email);
  return new;
end;
$$;

ALTER FUNCTION "public"."assign_booking_customer_profile"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."available_slots"("p_barber_id" "text", "p_date" "date", "p_duration_min" integer) RETURNS SETOF "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."available_slots"("p_barber_id" "text", "p_date" "date", "p_duration_min" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."available_slots_for_service"("p_barber_id" "text", "p_date" "date", "p_service_id" "text") RETURNS SETOF "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."available_slots_for_service"("p_barber_id" "text", "p_date" "date", "p_service_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."block_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,80}$' then
    return false;
  end if;

  update public.external_action_jobs j
  set status = 'blocked',
      payload = case
        when j.action_type = 'customer_access_email_send'
          then j.payload - 'access_code' - 'token_ciphertext'
        else j.payload
      end,
      dispatch_token = null,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  return found;
end;
$_$;

ALTER FUNCTION "public"."block_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_confirmation_details"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'id',             b.id,
    'email',          b.email,
    'phone',          b.phone,
    'customer_name',  b.customer_name,
    'start_at',       b.start_at,
    'service_name',   b.service_name,
    'price',          b.price,
    'duration_min',   b.duration_min,
    'barber_name',    coalesce(ba.name, b.barber_id),
    'barber_email',   (
      select u.email
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.role = 'barber'
        and p.barber_id = b.barber_id
      order by p.created_at asc
      limit 1
    ),
    'lang',           b.lang,
    'status',         b.status
  )
  from public.bookings b
  left join public.barbers ba on ba.id = b.barber_id
  where b.id = p_id;
$$;

ALTER FUNCTION "public"."booking_confirmation_details"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_email_delivery_for_dispatch"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'id', j.id,
    'booking_id', j.booking_id,
    'event', j.event,
    'sent_kinds', j.sent_kinds
  )
  from public.booking_email_delivery_jobs j
  where j.id = p_id
    and j.status = 'dispatching';
$$;

ALTER FUNCTION "public"."booking_email_delivery_for_dispatch"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_authorization_owner_for_job"("p_action_type" "text", "p_payload" "jsonb") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
  select case
    when p_action_type = 'calendar_event_delete'
      and pg_catalog.jsonb_typeof(p_payload->'barber_id') = 'string'
      and pg_catalog.btrim(p_payload->>'barber_id') <> ''
    then p_payload->>'barber_id'
    when p_action_type = 'calendar_event_delete'
      and p_payload->>'booking_id' ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (
      select m.barber_id
      from public.calendar_event_map m
      where m.booking_id = (p_payload->>'booking_id')::uuid
    )
    when p_action_type = 'calendar_event_sync'
      and p_payload->>'booking_id' ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (
      select case
        when m.barber_id is not null
          and (
            m.barber_id is distinct from b.barber_id
            or target.barber_id is null
            or target.disconnect_requested_at is not null
            or m.calendar_id is distinct from target.calendar_id
          )
        then m.barber_id
        else b.barber_id
      end
      from public.bookings b
      left join public.calendar_event_map m on m.booking_id = b.id
      left join public.barber_calendar_tokens target on target.barber_id = b.barber_id
      where b.id = (p_payload->>'booking_id')::uuid
    )
  end;
$_$;

ALTER FUNCTION "public"."calendar_authorization_owner_for_job"("p_action_type" "text", "p_payload" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_backfill_source"("p_barber_id" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'refresh_token', t.refresh_token,
    'calendar_id', t.calendar_id,
    'bookings', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'service_name', b.service_name,
        'customer_name', b.customer_name,
        'phone', b.phone,
        'email', b.email,
        'start_at', b.start_at,
        'end_at', b.end_at,
        'google_event_id', case
          when m.barber_id = b.barber_id and m.calendar_id = t.calendar_id
          then m.google_event_id
        end,
        'mapped_barber_id', m.barber_id,
        'mapped_refresh_token', mapped.refresh_token,
        'mapped_calendar_id', m.calendar_id,
        'mapped_google_event_id', m.google_event_id
      ) order by b.start_at)
      from public.bookings b
      left join public.calendar_event_map m on m.booking_id = b.id
      left join public.barber_calendar_tokens mapped on mapped.barber_id = m.barber_id
      where b.barber_id = p_barber_id
        and b.status = 'confirmed'
        and b.end_at > pg_catalog.now()
    ), '[]'::jsonb)
  )
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id
    and t.disconnect_requested_at is null;
$$;

ALTER FUNCTION "public"."calendar_backfill_source"("p_barber_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_connection_status"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'connected', t.barber_id is not null and t.disconnect_requested_at is null,
    'disconnect_pending', t.disconnect_requested_at is not null,
    'repair_required', coalesce(exists (
      select 1
      from public.external_action_jobs j
      where j.action_type in ('calendar_event_delete', 'calendar_event_sync')
        and j.status = 'blocked'
        and j.last_error_code = 'calendar_authorization_required'
        and public.calendar_authorization_owner_for_job(j.action_type, j.payload) = me.bid
    ), false),
    'google_email', t.google_email,
    'last_sync_at', t.last_sync_at,
    'last_sync_error', t.last_sync_error
  )
  from (select public.current_barber_id() as bid) me
  left join public.barber_calendar_tokens t on t.barber_id = me.bid;
$$;

ALTER FUNCTION "public"."calendar_connection_status"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_delete_token"("p_barber_id" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_token text;
begin
  if exists (
    select 1 from public.calendar_event_map m where m.barber_id = p_barber_id
  ) or exists (
    select 1
    from public.external_action_jobs j
    where j.action_type = 'calendar_event_delete'
      and j.status in ('pending', 'dispatching', 'blocked')
      and j.payload->>'barber_id' = p_barber_id
  ) then
    raise exception using errcode = '55000', message = 'calendar_cleanup_pending';
  end if;

  select refresh_token into v_token
  from public.barber_calendar_tokens
  where barber_id = p_barber_id;
  delete from public.barber_calendar_tokens where barber_id = p_barber_id;
  return v_token;
end;
$$;

ALTER FUNCTION "public"."calendar_delete_token"("p_barber_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_job public.external_action_jobs;
  v_booking public.bookings;
  v_map public.calendar_event_map;
  v_map_found boolean := false;
  v_target public.barber_calendar_tokens;
  v_target_found boolean := false;
  v_mapped_refresh_token text;
  v_booking_id uuid;
  v_barber_id text;
  v_calendar_id text;
  v_google_event_id text;
  v_refresh_token text;
  v_disconnect_requested_at timestamptz;
  v_event_count bigint;
  v_delete_job_count bigint;
begin
  select j.* into v_job
  from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  if not found or v_job.action_type not in (
    'calendar_event_sync', 'calendar_event_delete', 'calendar_disconnect'
  ) then
    return null;
  end if;

  if v_job.action_type = 'calendar_event_sync' then
    select b.* into v_booking
    from public.bookings b
    where b.id = (v_job.payload->>'booking_id')::uuid;

    if not found or v_booking.status <> 'confirmed' then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id, 'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type, 'superseded', true
      );
    end if;

    select t.* into v_target
    from public.barber_calendar_tokens t
    where t.barber_id = v_booking.barber_id;
    v_target_found := found;

    select m.* into v_map
    from public.calendar_event_map m
    where m.booking_id = v_booking.id;
    v_map_found := found;

    if v_map_found then
      select t.refresh_token into v_mapped_refresh_token
      from public.barber_calendar_tokens t
      where t.barber_id = v_map.barber_id;
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'booking_id', v_booking.id,
      'barber_id', v_booking.barber_id,
      'service_name', v_booking.service_name,
      'customer_name', v_booking.customer_name,
      'phone', v_booking.phone,
      'email', v_booking.email,
      'start_at', v_booking.start_at,
      'end_at', v_booking.end_at,
      'refresh_token', case when v_target_found and v_target.disconnect_requested_at is null
        then v_target.refresh_token end,
      'calendar_id', case when v_target_found and v_target.disconnect_requested_at is null
        then v_target.calendar_id end,
      'google_event_id', case when v_map_found and v_target_found
        and v_target.disconnect_requested_at is null
        and v_map.barber_id = v_booking.barber_id
        and v_map.calendar_id = v_target.calendar_id
        then v_map.google_event_id end,
      'mapped_barber_id', case when v_map_found then v_map.barber_id end,
      'mapped_refresh_token', case when v_map_found then v_mapped_refresh_token end,
      'mapped_calendar_id', case when v_map_found then v_map.calendar_id end,
      'mapped_google_event_id', case when v_map_found then v_map.google_event_id end
    );
  end if;

  if v_job.action_type = 'calendar_event_delete' then
    v_booking_id := (v_job.payload->>'booking_id')::uuid;
    if pg_catalog.jsonb_path_exists(v_job.payload, '$.barber_id ? (@.type() == "string")')
       and pg_catalog.jsonb_path_exists(v_job.payload, '$.calendar_id ? (@.type() == "string")')
       and pg_catalog.jsonb_path_exists(v_job.payload, '$.google_event_id ? (@.type() == "string")')
       and pg_catalog.char_length(v_job.payload->>'barber_id') > 0
       and pg_catalog.char_length(v_job.payload->>'calendar_id') > 0
       and pg_catalog.char_length(v_job.payload->>'google_event_id') > 0 then
      v_barber_id := v_job.payload->>'barber_id';
      v_calendar_id := v_job.payload->>'calendar_id';
      v_google_event_id := v_job.payload->>'google_event_id';
    else
      select m.barber_id, m.calendar_id, m.google_event_id
        into v_barber_id, v_calendar_id, v_google_event_id
      from public.calendar_event_map m
      where m.booking_id = v_booking_id;
      if not found then
        return pg_catalog.jsonb_build_object(
          'id', v_job.id, 'dispatch_token', v_job.dispatch_token,
          'action_type', v_job.action_type, 'superseded', true
        );
      end if;
    end if;

    select t.refresh_token into v_refresh_token
    from public.barber_calendar_tokens t
    where t.barber_id = v_barber_id;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'booking_id', v_booking_id,
      'barber_id', v_barber_id,
      'google_event_id', v_google_event_id,
      'refresh_token', v_refresh_token,
      'calendar_id', v_calendar_id
    );
  end if;

  select t.refresh_token, t.disconnect_requested_at
    into v_refresh_token, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = v_job.payload->>'barber_id';

  if not found then
    return pg_catalog.jsonb_build_object(
      'id', v_job.id, 'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type, 'superseded', true
    );
  end if;

  select pg_catalog.count(*) into v_event_count
  from public.calendar_event_map m
  where m.barber_id = v_job.payload->>'barber_id';

  select pg_catalog.count(*) into v_delete_job_count
  from public.external_action_jobs j
  where j.action_type = 'calendar_event_delete'
    and j.status in ('pending', 'dispatching', 'blocked')
    and (
      j.payload->>'barber_id' = v_job.payload->>'barber_id'
      or exists (
        select 1
        from public.calendar_event_map m
        where m.booking_id = (j.payload->>'booking_id')::uuid
          and m.barber_id = v_job.payload->>'barber_id'
      )
    );

  return pg_catalog.jsonb_build_object(
    'id', v_job.id,
    'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'barber_id', v_job.payload->>'barber_id',
      'refresh_token', v_refresh_token,
      'ready', v_event_count = 0
        and v_delete_job_count = 0
      and v_disconnect_requested_at is not null
      and v_disconnect_requested_at <= pg_catalog.now() - interval '5 minutes'
  );
end;
$_$;

ALTER FUNCTION "public"."calendar_external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_forget_event_if_matches"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.calendar_event_map m
  where m.booking_id = p_booking_id
    and m.barber_id = p_barber_id
    and m.calendar_id = p_calendar_id
    and m.google_event_id = p_google_event_id;
  return found;
end;
$$;

ALTER FUNCTION "public"."calendar_forget_event_if_matches"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_queue_event_deletion_for_identity"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_booking_id is null
     or p_barber_id is null
     or pg_catalog.char_length(p_barber_id) not between 1 and 32
     or p_calendar_id is null
     or pg_catalog.char_length(p_calendar_id) not between 1 and 200
     or p_google_event_id is null
     or pg_catalog.char_length(p_google_event_id) not between 1 and 1024 then
    raise exception using errcode = '22023', message = 'invalid calendar event identity';
  end if;

  return public.queue_external_action(
    'calendar_event_delete',
    p_booking_id::text || ':identity:' || pg_catalog.md5(
      p_barber_id || pg_catalog.chr(31) || p_calendar_id || pg_catalog.chr(31) || p_google_event_id
    ),
    pg_catalog.jsonb_build_object(
      'booking_id', p_booking_id,
      'barber_id', p_barber_id,
      'calendar_id', p_calendar_id,
      'google_event_id', p_google_event_id
    )
  );
end;
$$;

ALTER FUNCTION "public"."calendar_queue_event_deletion_for_identity"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_record_error"("p_barber_id" "text", "p_error" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.barber_calendar_tokens
    set last_sync_at = pg_catalog.now(), last_sync_error = p_error
    where barber_id = p_barber_id;
$$;

ALTER FUNCTION "public"."calendar_record_error"("p_barber_id" "text", "p_error" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_record_event_if_current"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_status text;
  v_booking_barber_id text;
  v_target_calendar_id text;
  v_disconnect_requested_at timestamptz;
  v_map public.calendar_event_map;
  v_map_found boolean;
begin
  if p_booking_id is null
     or p_barber_id is null
     or p_calendar_id is null
     or p_google_event_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('calendar-booking:' || p_booking_id::text, 0)
  );

  select b.status, b.barber_id
    into v_status, v_booking_barber_id
  from public.bookings b
  where b.id = p_booking_id;

  select t.calendar_id, t.disconnect_requested_at
    into v_target_calendar_id, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id;

  select m.* into v_map
  from public.calendar_event_map m
  where m.booking_id = p_booking_id
  for update;
  v_map_found := found;

  if v_status is distinct from 'confirmed'
     or v_booking_barber_id is distinct from p_barber_id
     or v_target_calendar_id is distinct from p_calendar_id
     or v_disconnect_requested_at is not null then
    return false;
  end if;

  if v_map_found and (
    v_map.barber_id is distinct from p_barber_id
    or v_map.calendar_id is distinct from p_calendar_id
    or v_map.google_event_id is distinct from p_google_event_id
  ) then
    return false;
  end if;

  if not v_map_found then
    insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
    values (p_booking_id, p_barber_id, p_calendar_id, p_google_event_id);
  end if;

  update public.barber_calendar_tokens
  set last_sync_at = pg_catalog.now(), last_sync_error = null
  where barber_id = p_barber_id;
  return true;
end;
$$;

ALTER FUNCTION "public"."calendar_record_event_if_current"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_store_token"("p_barber_id" "text", "p_refresh_token" "text", "p_google_email" "text", "p_calendar_id" "text" DEFAULT 'primary'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_existing_email text;
  v_disconnect_requested_at timestamptz;
  v_token_found boolean;
  v_identity_bound boolean;
  v_repair_required boolean;
  v_map record;
begin
  if p_google_email is null or pg_catalog.btrim(p_google_email) = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'calendar_account_identity_required');
  end if;

  select t.google_email, t.disconnect_requested_at
    into v_existing_email, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id
  for update;
  v_token_found := found;

  select exists (
    select 1
    from public.calendar_event_map m
    where m.barber_id = p_barber_id
  ) or exists (
    select 1
    from public.external_action_jobs j
    where j.action_type = 'calendar_event_delete'
      and j.status in ('pending', 'dispatching', 'blocked')
      and public.calendar_authorization_owner_for_job(j.action_type, j.payload) = p_barber_id
  ) into v_identity_bound;

  select coalesce(exists (
    select 1
    from public.external_action_jobs j
    where j.action_type in ('calendar_event_delete', 'calendar_event_sync')
      and j.status = 'blocked'
      and j.last_error_code = 'calendar_authorization_required'
      and public.calendar_authorization_owner_for_job(j.action_type, j.payload) = p_barber_id
  ), false) into v_repair_required;

  if v_token_found and v_disconnect_requested_at is not null then
    if v_existing_email is null
       or p_google_email is null
       or pg_catalog.lower(v_existing_email) <> pg_catalog.lower(p_google_email) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'account_mismatch');
    end if;

    update public.barber_calendar_tokens t
    set refresh_token = p_refresh_token,
        calendar_id = coalesce(p_calendar_id, 'primary'),
        updated_at = pg_catalog.now(),
        last_sync_error = null
    where t.barber_id = p_barber_id;

    for v_map in
      select m.booking_id
      from public.calendar_event_map m
      where m.barber_id = p_barber_id
    loop
      perform public.queue_calendar_event_deletion(v_map.booking_id);
    end loop;

    update public.external_action_jobs j
    set status = 'pending',
        next_attempt_at = pg_catalog.now(),
        dispatch_token = null,
        last_error_code = null
    where j.action_type in ('calendar_event_delete', 'calendar_event_sync')
      and j.status = 'blocked'
      and j.last_error_code = 'calendar_authorization_required'
      and public.calendar_authorization_owner_for_job(j.action_type, j.payload) = p_barber_id;

    return pg_catalog.jsonb_build_object('ok', true, 'cleanup_pending', true);
  end if;

  if v_token_found
     and v_disconnect_requested_at is null
     and (v_identity_bound or v_repair_required)
     and (v_existing_email is null
       or p_google_email is null
       or pg_catalog.lower(v_existing_email) <> pg_catalog.lower(p_google_email)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'account_mismatch');
  end if;

  if v_token_found and v_disconnect_requested_at is null and v_repair_required then
    update public.barber_calendar_tokens t
    set refresh_token = p_refresh_token,
        calendar_id = coalesce(p_calendar_id, 'primary'),
        updated_at = pg_catalog.now(),
        last_sync_error = null
    where t.barber_id = p_barber_id;

    update public.external_action_jobs j
    set status = 'pending',
        next_attempt_at = pg_catalog.now(),
        dispatch_token = null,
        last_error_code = null
    where j.action_type in ('calendar_event_delete', 'calendar_event_sync')
      and j.status = 'blocked'
      and j.last_error_code = 'calendar_authorization_required'
      and public.calendar_authorization_owner_for_job(j.action_type, j.payload) = p_barber_id;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'cleanup_pending', false,
      'repair_pending', true
    );
  end if;

  insert into public.barber_calendar_tokens
    (barber_id, refresh_token, google_email, calendar_id, connected_at, updated_at,
     disconnect_requested_at)
  values
    (p_barber_id, p_refresh_token, p_google_email, coalesce(p_calendar_id, 'primary'),
     pg_catalog.now(), pg_catalog.now(), null)
  on conflict (barber_id) do update
    set refresh_token = excluded.refresh_token,
        google_email = excluded.google_email,
        calendar_id = excluded.calendar_id,
        updated_at = pg_catalog.now(),
        last_sync_error = null,
        disconnect_requested_at = null;

  return pg_catalog.jsonb_build_object('ok', true, 'cleanup_pending', false);
end;
$$;

ALTER FUNCTION "public"."calendar_store_token"("p_barber_id" "text", "p_refresh_token" "text", "p_google_email" "text", "p_calendar_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."calendar_sync_source"("p_booking_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'barber_id', b.barber_id,
    'service_name', b.service_name,
    'customer_name', b.customer_name,
    'phone', b.phone,
    'email', b.email,
    'start_at', b.start_at,
    'end_at', b.end_at,
    'status', b.status,
    'refresh_token', case when target.disconnect_requested_at is null then target.refresh_token end,
    'calendar_id', case when target.disconnect_requested_at is null then target.calendar_id end,
    'google_event_id', case
      when target.disconnect_requested_at is null
       and m.barber_id = b.barber_id
       and m.calendar_id = target.calendar_id
      then m.google_event_id
    end,
    'mapped_barber_id', m.barber_id,
    'mapped_refresh_token', mapped.refresh_token,
    'mapped_calendar_id', m.calendar_id,
    'mapped_google_event_id', m.google_event_id
  )
  from public.bookings b
  left join public.barber_calendar_tokens target on target.barber_id = b.barber_id
  left join public.calendar_event_map m on m.booking_id = b.id
  left join public.barber_calendar_tokens mapped on mapped.barber_id = m.barber_id
  where b.id = p_booking_id;
$$;

ALTER FUNCTION "public"."calendar_sync_source"("p_booking_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cancel_customer_booking_for_browser"("p_booking_id" "uuid", "p_session_hash" "text", "p_receipt_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
    and (pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
      or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email)));
  return case when found then pg_catalog.jsonb_build_object('ok', true)
    else pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found') end;
end;
$_$;

ALTER FUNCTION "public"."cancel_customer_booking_for_browser"("p_booking_id" "uuid", "p_session_hash" "text", "p_receipt_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cancel_customer_booking_with_access"("p_booking_id" "uuid", "p_session_hash" "text") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.cancel_customer_booking_for_browser(p_booking_id,p_session_hash,null);
$$;

ALTER FUNCTION "public"."cancel_customer_booking_with_access"("p_booking_id" "uuid", "p_session_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."canonical_service_weekdays"("p_weekdays" smallint[]) RETURNS smallint[]
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog'
    AS $$
  select coalesce(array_agg(weekday order by weekday), array[]::smallint[])
  from (
    select distinct weekday
    from unnest(p_weekdays) as weekday
  ) as unique_weekdays;
$$;

ALTER FUNCTION "public"."canonical_service_weekdays"("p_weekdays" smallint[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_external_action"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_dispatch_token uuid := pg_catalog.gen_random_uuid();
begin
  update public.external_action_jobs j
  set status = 'dispatching',
      attempt_count = j.attempt_count + 1,
      last_attempt_at = pg_catalog.now(),
      dispatch_token = v_dispatch_token,
      last_error_code = null
  where j.id = p_id
    and (
      j.status = 'pending'
      or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    );

  if not found then
    return null;
  end if;

  return public.external_action_for_dispatch(p_id, v_dispatch_token);
end;
$$;

ALTER FUNCTION "public"."claim_external_action"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cleanup_customer_access_email_actions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count integer;
begin
  delete from public.external_action_jobs j
  where j.action_type = 'customer_access_email_send'
    and (
      j.status = 'blocked'
      or not exists (
        select 1
        from public.customer_booking_access_challenges c
        where c.id = (j.payload->>'challenge_id')::uuid
          and c.used_at is null
          and c.expires_at > pg_catalog.now()
      )
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

ALTER FUNCTION "public"."cleanup_customer_access_email_actions"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cleanup_customer_booking_access"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  v_count := v_count + v_deleted;
  delete from public.customer_email_links where expires_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_count + v_deleted;
end;
$$;

ALTER FUNCTION "public"."cleanup_customer_booking_access"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_booking_email_delivery"("p_id" "uuid", "p_status" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_status not in ('delivered', 'skipped', 'superseded') then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set status = p_status,
      completed_at = pg_catalog.now(),
      last_error_code = null
  where j.id = p_id
    and j.status = 'dispatching';

  return found;
end;
$$;

ALTER FUNCTION "public"."complete_booking_email_delivery"("p_id" "uuid", "p_status" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_external_action"("p_id" "uuid", "p_dispatch_token" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;
  return found;
end;
$$;

ALTER FUNCTION "public"."complete_external_action"("p_id" "uuid", "p_dispatch_token" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."confirm_customer_email_link"("p_session_hash" "text", "p_code_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_link public.customer_email_links;
  v_source text;
  v_source_version bigint;
  v_target_version bigint;
  v_source_generation bigint;
  v_target_generation bigint;
begin
  select s.email into v_source from public.customer_booking_access_sessions s
    where s.token_hash=p_session_hash and s.expires_at > pg_catalog.now();
  if v_source is null then return jsonb_build_object('ok',false,'error','access_denied'); end if;
  -- Read the immutable identities first. Profile locks always precede the request row lock.
  select l.* into v_link from public.customer_email_links l
    where l.source_hash=p_code_hash or l.target_hash=p_code_hash;
  if not found then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if v_link.source_email <> v_source then
    return jsonb_build_object('ok',false,'error','access_denied');
  end if;
  perform 1 from public.customer_profiles where id in(v_link.source_profile,v_link.target_profile) order by id for update;
  select l.* into v_link from public.customer_email_links l where l.id=v_link.id for update;
  if v_link.used_at is not null or v_link.expires_at <= pg_catalog.now() then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  perform public.lock_customer_access_emails(array[v_link.source_email,v_link.target_email]);
  -- SHARE conflicts with access-token rotation. A revoked source session cannot win after rotation.
  perform 1 from public.customer_booking_access_tokens where email in(v_link.source_email,v_link.target_email)
    order by email for share;
  if not exists(select 1 from public.customer_booking_access_sessions where token_hash=p_session_hash
    and email=v_source and expires_at > pg_catalog.now()) then
    return jsonb_build_object('ok',false,'error','access_denied');
  end if;
  select version into v_source_version from public.customer_profiles where id=v_link.source_profile;
  select version into v_target_version from public.customer_profiles where id=v_link.target_profile;
  select generation into v_source_generation from public.customer_booking_access_tokens where email=v_link.source_email;
  select coalesce((select generation from public.customer_booking_access_tokens where email=v_link.target_email),0) into v_target_generation;
  if v_source_version is distinct from v_link.source_version or v_target_version is distinct from v_link.target_version
    or v_source_generation is distinct from v_link.source_generation or v_target_generation is distinct from v_link.target_generation
    or not exists(select 1 from public.customer_profile_emails where email=v_source and profile_id=v_link.source_profile)
    or not exists(select 1 from public.customer_profile_emails where email=v_link.target_email and profile_id=v_link.target_profile) then
    return jsonb_build_object('ok',false,'error','stale');
  end if;
  update public.customer_email_links set
    source_verified_at=case when source_hash=p_code_hash then coalesce(source_verified_at,pg_catalog.now()) else source_verified_at end,
    target_verified_at=case when target_hash=p_code_hash then coalesce(target_verified_at,pg_catalog.now()) else target_verified_at end
    where id=v_link.id returning * into v_link;
  if v_link.source_verified_at is null or v_link.target_verified_at is null then
    return jsonb_build_object('ok',true,'status','waiting');
  end if;
  update public.customer_profile_emails set profile_id=v_link.source_profile where profile_id=v_link.target_profile;
  update public.customer_profiles set version=version+1 where id=v_link.source_profile;
  delete from public.customer_profiles where id=v_link.target_profile;
  update public.customer_email_links set used_at=pg_catalog.now()
    where used_at is null and (source_profile in(v_link.source_profile,v_link.target_profile)
      or target_profile in(v_link.source_profile,v_link.target_profile));
  return jsonb_build_object('ok',true,'status','linked');
end;
$$;

ALTER FUNCTION "public"."confirm_customer_email_link"("p_session_hash" "text", "p_code_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."consume_auth_email_send"("p_kind" "text", "p_scope_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_last timestamptz;
begin
  if p_kind not in ('recovery', 'email_change') or char_length(p_scope_hash) <> 64 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_kind || ':' || p_scope_hash));

  select r.last_sent_at into v_last
  from public.auth_email_rate_limits r
  where r.kind = p_kind and r.scope_hash = p_scope_hash;

  if v_last is not null and v_last > pg_catalog.now() - interval '1 minute' then
    return false;
  end if;

  insert into public.auth_email_rate_limits (kind, scope_hash, last_sent_at)
  values (p_kind, p_scope_hash, pg_catalog.now())
  on conflict (kind, scope_hash) do update set last_sent_at = excluded.last_sent_at;

  return true;
end;
$$;

ALTER FUNCTION "public"."consume_auth_email_send"("p_kind" "text", "p_scope_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."consume_customer_access_email_challenge"("p_challenge_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.customer_booking_access_challenges c
  where c.id = p_challenge_id
    and c.used_at is null;
  return found;
end;
$$;

ALTER FUNCTION "public"."consume_customer_access_email_challenge"("p_challenge_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."consume_public_action_attempt"("p_action" "text", "p_ip_hash" "text", "p_phone_hash" "text", "p_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_since timestamptz;
begin
  if p_action not in ('lookup', 'list', 'cancel', 'review', 'request_access')
     or char_length(p_ip_hash) <> 64
     or char_length(p_phone_hash) <> 64
     or p_window_secs not between 60 and 172800
     or p_ip_limit not between 1 and 100
     or p_phone_limit not between 1 and 100 then
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
    where a.action = p_action and a.ip_hash = p_ip_hash and a.created_at >= v_since
  ) >= p_ip_limit or (
    select pg_catalog.count(*)
    from public.public_action_attempts a
    where a.action = p_action and a.phone_hash = p_phone_hash and a.created_at >= v_since
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

ALTER FUNCTION "public"."consume_public_action_attempt"("p_action" "text", "p_ip_hash" "text", "p_phone_hash" "text", "p_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."consume_staff_invitation"("p_token_hash" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  delete from public.staff_invitations i
  where i.token_hash = p_token_hash
    and exists (
      select 1 from public.profiles p
      join auth.users u on u.id = p.id
      where p.id = i.user_id and p.role = 'barber' and p.account_enabled
        and p.barber_id is not null and u.email_confirmed_at is null
        and (u.banned_until is null or u.banned_until <= now())
    )
  returning i.user_id;
$$;

ALTER FUNCTION "public"."consume_staff_invitation"("p_token_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_booking"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."create_booking"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_booking_with_limits"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text", "p_ip_hash" "text", "p_ip_window_secs" integer, "p_phone_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."create_booking_with_limits"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text", "p_ip_hash" "text", "p_ip_window_secs" integer, "p_phone_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_review_for_browser"("p_session_hash" "text", "p_receipt_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_scope_email text;
  v_booking_id uuid;
  v_customer text;
  v_first text;
  v_second text;
  v_display text;
  v_row public.reviews;
begin
  if p_phone is null
     or p_phone !~ '^07[0-9]{8}$'
     or p_rating is null or p_rating < 1 or p_rating > 5
     or p_text is null
     or pg_catalog.char_length(p_text) < 1
     or pg_catalog.char_length(p_text) > 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.email into v_scope_email
  from public.customer_booking_access_scope(p_session_hash) s;

  -- Use the same verified-profile/receipt scope as list and cancellation. A receipt
  -- never proves ownership of an email or phone, including on a shared browser.
  select b.id, b.customer_name
    into v_booking_id, v_customer
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = p_phone
    and (pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_scope_email))
      or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_scope_email)))
    and b.end_at < pg_catalog.now()
    and not exists (
      select 1 from public.reviews r where r.booking_id = b.id
    )
  order by b.end_at desc, b.id desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  v_customer := pg_catalog.btrim(v_customer);
  v_first := pg_catalog.split_part(v_customer, ' ', 1);
  v_second := pg_catalog.split_part(v_customer, ' ', 2);
  v_display := v_first
    || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;
  v_display := pg_catalog.left(v_display, 80);
  if v_display = '' then
    v_display := 'Kund';
  end if;

  begin
    insert into public.reviews (name, rating, text, booking_id, published)
    values (v_display, p_rating::smallint, p_text, v_booking_id, true)
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'review', pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'rating', v_row.rating,
      'text', v_row.text
    )
  );
end;
$_$;

ALTER FUNCTION "public"."create_review_for_browser"("p_session_hash" "text", "p_receipt_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_review_with_access"("p_session_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_scope_email text;
  v_booking_id uuid;
  v_customer text;
  v_first text;
  v_second text;
  v_display text;
  v_row public.reviews;
begin
  if p_session_hash is null
     or p_session_hash !~ '^[0-9a-f]{64}$'
     or p_phone is null
     or p_phone !~ '^07[0-9]{8}$'
     or p_rating is null or p_rating < 1 or p_rating > 5
     or p_text is null
     or pg_catalog.char_length(p_text) < 1
     or pg_catalog.char_length(p_text) > 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.email into v_scope_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  select b.id, b.customer_name
    into v_booking_id, v_customer
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = p_phone
    and pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_scope_email))
    and b.end_at < pg_catalog.now()
    and not exists (
      select 1 from public.reviews r where r.booking_id = b.id
    )
  order by b.end_at desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  v_customer := pg_catalog.btrim(v_customer);
  v_first := pg_catalog.split_part(v_customer, ' ', 1);
  v_second := pg_catalog.split_part(v_customer, ' ', 2);
  v_display := v_first
    || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;
  v_display := pg_catalog.left(v_display, 80);
  if v_display = '' then
    v_display := 'Kund';
  end if;

  begin
    insert into public.reviews (name, rating, text, booking_id, published)
    values (v_display, p_rating::smallint, p_text, v_booking_id, true)
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'review', pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'rating', v_row.rating,
      'text', v_row.text
    )
  );
end;
$_$;

ALTER FUNCTION "public"."create_review_with_access"("p_session_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."current_barber_id"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.barber_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.role = 'barber'
    and p.account_enabled = true;
$$;

ALTER FUNCTION "public"."current_barber_id"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."current_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.account_enabled = true;
$$;

ALTER FUNCTION "public"."current_role"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."customer_booking_access_scope"("p_session_hash" "text") RETURNS TABLE("phone" "text", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
  select scope.phone, scope.email
  from (
    select t.phone, t.email, 0 as priority
    from public.customer_booking_access_tokens t
    where t.token_hash = p_session_hash
      and p_session_hash ~ '^[0-9a-f]{64}$'
    union all
    select s.phone, s.email, 1 as priority
    from public.customer_booking_access_sessions s
    where s.token_hash = p_session_hash
      and s.expires_at > pg_catalog.now()
      and p_session_hash ~ '^[0-9a-f]{64}$'
  ) scope
  order by scope.priority
  limit 1;
$_$;

ALTER FUNCTION "public"."customer_booking_access_scope"("p_session_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."customer_device_booking_ids"("p_receipt_hash" "text", "p_parent_email" "text") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select b.booking_id
  from public.customer_booking_receipt_bookings b
  join public.customer_booking_receipts r on r.token_hash = b.receipt_hash
  where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()
    and (p_parent_email is null or b.parent_email = p_parent_email);
$$;

ALTER FUNCTION "public"."customer_device_booking_ids"("p_receipt_hash" "text", "p_parent_email" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."customer_profile_emails_for_email"("p_email" "text") RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select e.email from public.customer_profile_emails e
  join public.customer_profile_emails owner on owner.profile_id = e.profile_id
  where owner.email = p_email
  union select p_email where p_email is not null;
$$;

ALTER FUNCTION "public"."customer_profile_emails_for_email"("p_email" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."email_template_for_delivery"("p_template" "text", "p_lang" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 select (to_jsonb(t)-'updated_at') || case when d.design is null then '{}'::jsonb else jsonb_build_object('design',d.design) end
 from public.email_templates t left join public.cms_email_designs d using(template,lang)
 where t.template=p_template and t.lang=p_lang;
$$;

ALTER FUNCTION "public"."email_template_for_delivery"("p_template" "text", "p_lang" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."ensure_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_row public.customer_booking_access_tokens;
begin
  if v_email is null or p_phone is null or p_token_hash is null or p_token_ciphertext is null
     or p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$' then
    return null;
  end if;

  if not exists (
    select 1
    from public.bookings b
    where b.phone = p_phone
      and pg_catalog.lower(b.email) = v_email
      and b.status = 'confirmed'
  ) then
    return null;
  end if;

  perform public.lock_customer_access_emails(array[v_email]);

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, p_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        updated_at = pg_catalog.now()
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'token_ciphertext', v_row.token_ciphertext,
    'generation', v_row.generation
  );
end;
$_$;

ALTER FUNCTION "public"."ensure_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."ensure_customer_email_profile"("p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_profile uuid;
  v_created uuid;
begin
  if v_email is null or pg_catalog.char_length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null; end if;
  select e.profile_id into v_profile from public.customer_profile_emails e where e.email = v_email;
  if found then return v_profile; end if;
  insert into public.customer_profiles default values returning id into v_created;
  insert into public.customer_profile_emails(email, profile_id) values(v_email, v_created)
    on conflict(email) do update set email = excluded.email returning profile_id into v_profile;
  if v_profile <> v_created then delete from public.customer_profiles where id = v_created; end if;
  return v_profile;
end;
$_$;

ALTER FUNCTION "public"."ensure_customer_email_profile"("p_email" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."establish_customer_booking_session"("p_access_token" "text", "p_session_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_phone text;
  v_email text;
begin
  if p_access_token is null or p_session_hash is null or p_access_token !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  -- p_access_token is the lookup hash, never the raw email credential. Only permanent links
  -- mint a new session; existing sessions keep their original server-side expiry.
  -- SHARE conflicts with token rotation/replacement until this session insertion commits.
  select t.phone, t.email into v_phone, v_email
  from public.customer_booking_access_tokens t
  where t.token_hash = p_access_token
  for share;
  if not found then return false; end if;
  insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');
  return true;
end;
$_$;

ALTER FUNCTION "public"."establish_customer_booking_session"("p_access_token" "text", "p_session_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."exchange_customer_booking_access"("p_challenge_hash" "text", "p_session_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_phone text;
  v_email text;
begin
  if p_challenge_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  update public.customer_booking_access_challenges c
  set used_at = pg_catalog.now()
  where c.token_hash = p_challenge_hash
    and c.used_at is null
    and c.expires_at > pg_catalog.now()
  returning c.phone, c.email into v_phone, v_email;
  if not found then return false; end if;
  insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');
  return true;
end;
$_$;

ALTER FUNCTION "public"."exchange_customer_booking_access"("p_challenge_hash" "text", "p_session_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_job public.external_action_jobs;
  v_challenge public.customer_booking_access_challenges;
  v_token_ciphertext text;
  v_profile public.profiles;
  v_link public.customer_email_links;
  v_calendar jsonb;
begin
  select j.* into v_job
  from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  if not found then
    return null;
  end if;

  -- The current Calendar implementation is the only source of Calendar dispatch context.
  v_calendar := public.calendar_external_action_for_dispatch(p_id,p_dispatch_token);
  if v_calendar is not null then return v_calendar; end if;

  if v_job.action_type = 'customer_email_link_send' then
    select l.* into v_link from public.customer_email_links l
      join public.customer_profiles a on a.id=l.source_profile and a.version=l.source_version
      join public.customer_profiles b on b.id=l.target_profile and b.version=l.target_version
      join public.customer_booking_access_tokens t on t.email=l.source_email and t.generation=l.source_generation
      where l.id=(v_job.payload->>'link_id')::uuid and l.used_at is null and l.expires_at > pg_catalog.now()
        and coalesce((select generation from public.customer_booking_access_tokens where email=l.target_email),0)=l.target_generation
        and ((v_job.payload->>'side'='source' and l.source_verified_at is null)
          or (v_job.payload->>'side'='target' and l.target_verified_at is null));
    if not found then return jsonb_build_object('id',v_job.id,'dispatch_token',v_job.dispatch_token,
      'action_type',v_job.action_type,'superseded',true); end if;
    return jsonb_build_object('id',v_job.id,'dispatch_token',v_job.dispatch_token,'action_type',v_job.action_type,
      'link_id',v_link.id,'side',v_job.payload->>'side',
      'email',case when v_job.payload->>'side'='source' then v_link.source_email else v_link.target_email end,
      'source_email',v_link.source_email,'target_email',v_link.target_email,'lang',v_job.payload->>'lang',
      'token_ciphertext',case when v_job.payload->>'side'='source' then v_link.source_ciphertext else v_link.target_ciphertext end);
  end if;

  if v_job.action_type = 'storage_object_delete' then
    if (v_job.payload->>'bucket' = 'gallery' and exists (
      select 1 from public.gallery_images g where g.storage_path = v_job.payload->>'path'
    )) or (v_job.payload->>'bucket' = 'barber-photos' and exists (
      select 1 from public.barber_photos p where p.storage_path = v_job.payload->>'path'
    )) then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'bucket', v_job.payload->>'bucket',
      'path', v_job.payload->>'path'
    );
  end if;

  if v_job.action_type = 'customer_access_email_send' then
    select c.* into v_challenge
    from public.customer_booking_access_challenges c
    join public.customer_booking_access_tokens t
      on t.email = c.email
     and t.token_hash = c.token_hash
    where c.id = (v_job.payload->>'challenge_id')::uuid
      and c.used_at is null
      and c.expires_at > pg_catalog.now();

    if not found then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    if not exists (
      select 1
      from public.bookings b
      where b.phone = v_challenge.phone
        and pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_challenge.email))
        and b.status = 'confirmed'
    ) then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    select t.token_ciphertext into v_token_ciphertext
    from public.customer_booking_access_tokens t
    where t.email = v_challenge.email
      and t.token_hash = v_challenge.token_hash;

    if not found or v_token_ciphertext is null then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'challenge_id', v_challenge.id,
      'email', v_challenge.email,
      'lang', v_job.payload->>'lang',
      'token_ciphertext', v_token_ciphertext
    );
  end if;

  if v_job.action_type = 'auth_user_access_sync' then
    select p.* into v_profile
    from public.profiles p
    where p.id = (v_job.payload->>'user_id')::uuid;

    if not found
       or v_profile.auth_sync_version <> (v_job.payload->>'version')::bigint
       or v_profile.account_enabled <> (v_job.payload->>'account_enabled')::boolean then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'user_id', v_profile.id,
      'account_enabled', v_profile.account_enabled,
      'version', v_profile.auth_sync_version
    );
  end if;


  return pg_catalog.jsonb_build_object(
    'id', v_job.id,
    'dispatch_token', v_job.dispatch_token,
    'action_type', v_job.action_type,
    'user_id', v_job.payload->>'user_id'
  );
end;
$$;

ALTER FUNCTION "public"."external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."fail_booking_email_delivery"("p_id" "uuid", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_error_code not in (
    'not_configured',
    'message_build_failed',
    'send_failed',
    'send_failed_transient',
    'send_failed_permanent'
  ) then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set status = case
        when p_error_code in ('not_configured', 'message_build_failed', 'send_failed_permanent')
          then 'failed'
        when j.attempt_count >= 5 then 'failed'
        else 'pending'
      end,
      next_attempt_at = case
        when p_error_code in ('not_configured', 'message_build_failed', 'send_failed_permanent')
          or j.attempt_count >= 5 then j.next_attempt_at
        else pg_catalog.now() + pg_catalog.make_interval(
          secs => least(
            3600,
            (60 * pg_catalog.power(2, least(greatest(j.attempt_count - 1, 0), 6)))::integer
          )
        )
      end,
      failed_at = case
        when p_error_code in ('not_configured', 'message_build_failed', 'send_failed_permanent')
          or j.attempt_count >= 5 then pg_catalog.now()
        else null
      end,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching';

  return found;
end;
$$;

ALTER FUNCTION "public"."fail_booking_email_delivery"("p_id" "uuid", "p_error_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."fail_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
begin
  if p_error_code is null
     or p_error_code !~ '^[a-z0-9_]{1,80}$' then
    return false;
  end if;

  update public.external_action_jobs j
  set status = 'pending',
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
        secs => least(
          3600,
          (60 * pg_catalog.power(2, least(greatest(j.attempt_count - 1, 0), 6)))::integer
        )
      ),
      dispatch_token = null,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  return found;
end;
$_$;

ALTER FUNCTION "public"."fail_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."forget_customer_booking_receipt"("p_receipt_hash" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  delete from public.customer_booking_receipts where token_hash = p_receipt_hash;
$$;

ALTER FUNCTION "public"."forget_customer_booking_receipt"("p_receipt_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_assert_media_publishable"("p_document" "jsonb", "p_head" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_media record;
begin
  select media.path,asset.id,asset.name,asset.mime,asset.trashed_at
  into v_media
  from public.internal_cms_newly_placed_media(p_document,p_head) media
  left join public.cms_assets asset on asset.bucket=media.bucket and asset.path=media.path
  where asset.id is null or asset.archived
  order by media.bucket,media.path
  limit 1;

  if not found then
    return;
  end if;

  if v_media.id is null then
    raise sqlstate 'PT422' using message=format(
      'Filen %s finns inte i biblioteket. Välj den på nytt under Resurser.',
      v_media.path
    );
  end if;

  raise sqlstate 'PT422' using message=format(
    '%s %s %s och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
    case when v_media.mime like 'image/%' then 'Bilden' else 'Filen' end,
    v_media.name,
    case when v_media.trashed_at is null then 'är arkiverad' else 'ligger i papperskorgen' end
  );
end $$;

ALTER FUNCTION "public"."internal_cms_assert_media_publishable"("p_document" "jsonb", "p_head" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_assert_owner"("p_actor" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='owner' and account_enabled and not must_change_password) then
    raise exception 'CMS owner required' using errcode='42501';
  end if;
end $$;

ALTER FUNCTION "public"."internal_cms_assert_owner"("p_actor" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_asset_delete_abort"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_asset public.cms_assets%rowtype;
begin
  perform public.internal_cms_assert_owner(p_actor);
  update public.cms_assets set deleting_at=null,version=version+1
  where id=p_id and version=p_version and deleting_at is not null
  returning * into v_asset;
  if not found then raise sqlstate 'PT409' using message='Asset deletion claim changed'; end if;
  return to_jsonb(v_asset)-'created_at'-'deleting_at';
end $$;

ALTER FUNCTION "public"."internal_cms_asset_delete_abort"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_asset_delete_finalize"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_asset public.cms_assets%rowtype;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id for update;
  if not found then return true; end if;
  if v_asset.version<>p_version or v_asset.deleting_at is null then
    raise sqlstate 'PT409' using message='Asset deletion claim changed';
  end if;
  select count(*) into v_current
  from public.internal_cms_document_media_placements(public.internal_cms_document()) r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  select coalesce(sum(r.reference_count),0) into v_history
  from public.cms_revision_media r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  if v_current>0 or v_history>0 then
    raise exception 'Retained references protect this asset' using errcode='23514';
  end if;
  delete from public.cms_assets where id=p_id and version=p_version;
  return true;
end $$;

ALTER FUNCTION "public"."internal_cms_asset_delete_finalize"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_asset_transition"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_action" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_asset public.cms_assets%rowtype;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id for update;
  if not found then raise exception 'CMS asset not found' using errcode='P0002'; end if;
  if v_asset.version<>p_version or v_asset.deleting_at is not null then
    raise sqlstate 'PT409' using message='Asset lifecycle changed';
  end if;
  if p_action not in ('archive','restore','trash','delete') then
    raise exception 'Invalid asset lifecycle action' using errcode='22023';
  end if;

  select count(*) into v_current
  from public.internal_cms_document_media_placements(public.internal_cms_document()) r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  select coalesce(sum(r.reference_count),0) into v_history
  from public.cms_revision_media r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;

  if p_action='trash' and v_current>0 then
    raise exception 'Referenced assets cannot be moved to trash' using errcode='23514';
  end if;
  if p_action='delete' and (v_asset.trashed_at is null or v_current>0 or v_history>0) then
    raise exception 'Retained references protect this asset' using errcode='23514';
  end if;

  if p_action='archive' then
    update public.cms_assets set archived=true,trashed_at=null,version=version+1
    where id=p_id returning * into v_asset;
  elsif p_action='restore' then
    update public.cms_assets set archived=false,trashed_at=null,version=version+1
    where id=p_id returning * into v_asset;
  elsif p_action='trash' then
    update public.cms_assets set archived=true,trashed_at=coalesce(trashed_at,now()),version=version+1
    where id=p_id returning * into v_asset;
  else
    update public.cms_assets set deleting_at=now(),version=version+1
    where id=p_id returning * into v_asset;
  end if;

  return jsonb_build_object(
    'asset',to_jsonb(v_asset)-'created_at'-'deleting_at',
    'usage',jsonb_build_object('currentReferences',v_current,'historyReferences',v_history)
  );
end $$;

ALTER FUNCTION "public"."internal_cms_asset_transition"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_action" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_asset_update"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_name" "text", "p_alt" "text", "p_archived" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_asset public.cms_assets%rowtype;
begin
 perform public.internal_cms_assert_owner(p_actor);
 update public.cms_assets set name=p_name,alt=p_alt,archived=p_archived,version=version+1 where id=p_id and version=p_version returning * into v_asset;
 if not found then raise sqlstate 'PT409' using message='Asset metadata changed'; end if;
 return to_jsonb(v_asset)-'created_at';
end $$;

ALTER FUNCTION "public"."internal_cms_asset_update"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_name" "text", "p_alt" "text", "p_archived" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_asset_usage"("p_actor" "uuid", "p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_asset public.cms_assets%rowtype;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id;
  if not found then raise exception 'CMS asset not found' using errcode='P0002'; end if;
  select count(*) into v_current
  from public.internal_cms_document_media_placements(public.internal_cms_document()) r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  select coalesce(sum(r.reference_count),0) into v_history
  from public.cms_revision_media r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  return jsonb_build_object('currentReferences',v_current,'historyReferences',v_history);
end $$;

ALTER FUNCTION "public"."internal_cms_asset_usage"("p_actor" "uuid", "p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_check_media"("p_actor" "uuid", "p_document" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.internal_cms_assert_owner(p_actor);
  perform public.internal_cms_assert_media_publishable(p_document,public.internal_cms_document());
end $$;

ALTER FUNCTION "public"."internal_cms_check_media"("p_actor" "uuid", "p_document" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_document"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
select jsonb_build_object(
 'schema',1,
 'site',coalesce((select jsonb_object_agg(key,langs order by key) from (select key,jsonb_object_agg(lang,value order by lang) langs from public.site_content
   where key=any(array['kicker','hours','yourDetails','summary','fBarber','fWhen','fService','fTotal','name','namePh','phone','phonePh','policy','bookedTitle','confirmSent','addToCal'])
   group by key) s),'{}'::jsonb),
 'about',coalesce((select jsonb_object_agg(key,langs order by key) from (select key,jsonb_object_agg(lang,value order by lang) langs from public.about_content group by key) s),'{}'::jsonb),
 'settings',coalesce((select jsonb_object_agg(key,value order by key) from public.site_settings where key=any(array['homepage_scale','about_scale','homepage_logo_path','homepage_logo_scale','homepage_logo_style','business_name','business_legal_name','business_org_number','business_email','business_phone_display','business_phone_tel','business_street','business_postal_code','business_city','business_maps_href','seo_title_sv','seo_description_sv','seo_title_en','seo_description_en'])),'{}'::jsonb),
 'barbers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'ig',ig,'role_sv',role_sv,'role_en',role_en,'bio_sv',bio_sv,'bio_en',bio_en,'sort_order',sort_order) order by id) from public.barbers),'[]'::jsonb),
 'photos',coalesce((select jsonb_object_agg(barber_id,storage_path order by barber_id) from public.barber_photos),'{}'::jsonb),
 'gallery',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'storage_path',storage_path,'alt',alt,'sort_order',sort_order) order by id) from public.gallery_images),'[]'::jsonb),
 'emails',coalesce((select jsonb_agg((to_jsonb(t)-'updated_at') || jsonb_build_object('design',d.design) order by t.template,t.lang) from public.email_templates t left join public.cms_email_designs d using(template,lang)),'[]'::jsonb),
 'presentation',(select presentation from public.cms_site where id)
) $$;

ALTER FUNCTION "public"."internal_cms_document"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_document_media_placements"("p_document" "jsonb") RETURNS TABLE("placement" "text", "bucket" "text", "path" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
with
images as (
  select
    'presentation.images:' || entry.key as placement,
    entry.value #>> '{ref,bucket}' as bucket,
    entry.value #>> '{ref,path}' as path
  from jsonb_each(
    case
      when jsonb_typeof(p_document #> '{presentation,images}')='object'
        then p_document #> '{presentation,images}'
      else '{}'::jsonb
    end
  ) as entry(key,value)
),
fonts as (
  select
    'presentation.fonts:' || entry.key,
    entry.value #>> '{ref,bucket}',
    entry.value #>> '{ref,path}'
  from jsonb_each(
    case
      when jsonb_typeof(p_document #> '{presentation,fonts}')='object'
        then p_document #> '{presentation,fonts}'
      else '{}'::jsonb
    end
  ) as entry(key,value)
),
gallery as (
  select
    'gallery:' || (image.value->>'id'),
    'gallery',
    image.value->>'storage_path'
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_document->'gallery')='array' then p_document->'gallery'
      else '[]'::jsonb
    end
  ) as image(value)
),
photos as (
  select
    'photos:' || photo.key,
    'barber-photos',
    photo.value
  from jsonb_each_text(
    case
      when jsonb_typeof(p_document->'photos')='object' then p_document->'photos'
      else '{}'::jsonb
    end
  ) as photo(key,value)
),
homepage_logo as (
  select
    'settings:homepage_logo_path',
    'gallery',
    p_document #>> '{settings,homepage_logo_path}'
  where coalesce(p_document #>> '{settings,homepage_logo_path}','')<>''
),
email_logos as (
  select
    'emails:' || (email.value->>'template') || ':' || (email.value->>'lang') || ':logo',
    email.value #>> '{design,logo,bucket}',
    email.value #>> '{design,logo,path}'
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_document->'emails')='array' then p_document->'emails'
      else '[]'::jsonb
    end
  ) as email(value)
  where jsonb_typeof(email.value #> '{design,logo}')='object'
),
pages as (
  select page.value
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_document #> '{presentation,pages}')='array'
        then p_document #> '{presentation,pages}'
      else '[]'::jsonb
    end
  ) as page(value)
),
regions as (
  select region.key,region.value
  from jsonb_each(
    case
      when jsonb_typeof(p_document #> '{presentation,regions}')='object'
        then p_document #> '{presentation,regions}'
      else '{}'::jsonb
    end
  ) as region(key,value)
),
languages(lang) as (values ('sv'),('en')),
modes(mode) as (values ('light'),('dark')),
markup_source as (
  select
    'presentation.pages:' || (page.value->>'id') || ':' || languages.lang || ':html' as placement,
    page.value #>> array['content',languages.lang,'html'] as source
  from pages page
  cross join languages

  union all

  select
    'presentation.pages:' || (page.value->>'id') || ':' || languages.lang || ':css:' || modes.mode,
    page.value #>> array['content',languages.lang,'css',modes.mode]
  from pages page
  cross join languages
  cross join modes

  union all

  select
    'presentation.regions:' || region.key || ':' || languages.lang || ':html',
    region.value #>> array[languages.lang,'html']
  from regions region
  cross join languages

  union all

  select
    'presentation.regions:' || region.key || ':' || languages.lang || ':css:' || modes.mode,
    region.value #>> array[languages.lang,'css',modes.mode]
  from regions region
  cross join languages
  cross join modes
),
markup as (
  select
    source.placement || ':' || match.ordinality::text as placement,
    (match.parts)[1] as bucket,
    (match.parts)[2] as path
  from markup_source source
  cross join lateral regexp_matches(
    source.source,
    '/storage/v1/object/public/(gallery|barber-photos|cms-library)/([a-zA-Z0-9][a-zA-Z0-9_./-]{0,239})',
    'g'
  ) with ordinality as match(parts,ordinality)
),
refs as (
  select * from images
  union all select * from fonts
  union all select * from gallery
  union all select * from photos
  union all select * from homepage_logo
  union all select * from email_logos
  union all select * from markup
)
select distinct refs.placement,refs.bucket,refs.path
from refs
where refs.placement is not null
  and refs.bucket in ('gallery','barber-photos','cms-library')
  and refs.path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$'
  and refs.path not like '%..%'
  and refs.path not like '%//%';
$_$;

ALTER FUNCTION "public"."internal_cms_document_media_placements"("p_document" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_history"("p_actor" "uuid", "p_before" bigint DEFAULT '9223372036854775807'::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
 perform public.internal_cms_assert_owner(p_actor);
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from (select revision,created_at,summary from public.cms_revisions where revision<p_before order by revision desc limit 30) r),'[]'::jsonb);
end $$;

ALTER FUNCTION "public"."internal_cms_history"("p_actor" "uuid", "p_before" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_index_revision_media"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.cms_revision_media where revision=new.revision;
  insert into public.cms_revision_media(revision,bucket,path,reference_count)
  select new.revision,r.bucket,r.path,count(*)
  from public.internal_cms_document_media_placements(new.document) r
  group by r.bucket,r.path;
  return new;
end $$;

ALTER FUNCTION "public"."internal_cms_index_revision_media"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_media_retained"("p_bucket" "text", "p_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 select exists(select 1 from public.cms_revisions r where position(p_path in r.document::text)>0)
 or exists(select 1 from public.cms_assets a where a.bucket=p_bucket and a.path=p_path);
$$;

ALTER FUNCTION "public"."internal_cms_media_retained"("p_bucket" "text", "p_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_missing_media"("p_actor" "uuid", "p_references" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.internal_cms_assert_owner(p_actor);
  if jsonb_typeof(p_references) is distinct from 'array' or jsonb_array_length(p_references)>10000 then
    raise exception 'Invalid media references' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(r.ref) from jsonb_array_elements(p_references) as r(ref)
    where not exists(select 1 from public.cms_assets a where a.bucket=r.ref->>'bucket' and a.path=r.ref->>'path')
       or not exists(select 1 from storage.objects o where o.bucket_id=r.ref->>'bucket' and o.name=r.ref->>'path')
  ),'[]'::jsonb);
end $$;

ALTER FUNCTION "public"."internal_cms_missing_media"("p_actor" "uuid", "p_references" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_newly_placed_media"("p_document" "jsonb", "p_head" "jsonb") RETURNS TABLE("bucket" "text", "path" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
with incoming as materialized (
  select
    r.placement,
    r.bucket,
    r.path,
    r.placement like 'presentation.pages:%' or r.placement like 'presentation.regions:%' as markup
  from public.internal_cms_document_media_placements(p_document) r
),
head as materialized (
  select r.placement,r.bucket,r.path
  from public.internal_cms_document_media_placements(p_head) r
)
select distinct incoming.bucket,incoming.path
from incoming
where not exists (
  select 1
  from head
  where head.bucket=incoming.bucket
    and head.path=incoming.path
    and (incoming.markup or head.placement=incoming.placement)
);
$$;

ALTER FUNCTION "public"."internal_cms_newly_placed_media"("p_document" "jsonb", "p_head" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_publish"("p_actor" "uuid", "p_document" "jsonb", "p_base_revision" bigint, "p_base_fingerprint" "text", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare v_head bigint; v_before jsonb; v_after jsonb; v_previous public.cms_revisions%rowtype; row_data jsonb; pair record; cell record; v_current_ids text[]; v_new_ids text[];
begin
 perform public.internal_cms_assert_owner(p_actor);
 if p_request_id is null or p_base_revision is null or p_base_revision<0 or p_base_fingerprint is null or p_base_fingerprint !~ '^[0-9a-f]{32}$'
   or p_document is null or p_document->>'schema' is distinct from '1' or jsonb_typeof(p_document->'barbers') is distinct from 'array'
   or jsonb_typeof(p_document->'settings') is distinct from 'object'
   or jsonb_typeof(p_document->'presentation') is distinct from 'object' or octet_length(p_document::text)>3145728 then
   raise exception 'Invalid CMS publication' using errcode='22023';
 end if;
 if (p_document->'settings') ? 'cancellation_policy_hours'
   or exists(
     select 1
     from jsonb_array_elements(p_document->'barbers') as item(value)
     where item.value ? 'active'
   ) then
   raise exception 'Operational booking rules are not CMS content' using errcode='22023';
 end if;
 -- One consistent snapshot, including edits made by existing non-CMS management tools.
 lock table public.barbers,public.site_content,public.about_content,public.site_settings,public.barber_photos,public.gallery_images,public.email_templates,public.cms_email_designs,public.cms_assets in share row exclusive mode;
 select revision into v_head from public.cms_site where id for update;
 -- Authority may have changed while either the content tables or site row was locked.
 perform public.internal_cms_assert_owner(p_actor);
 -- An exact replay returns the committed revision even if its media was archived since.
 select * into v_previous from public.cms_revisions where request_id=p_request_id;
 if found then
   if v_previous.actor_id is distinct from p_actor or v_previous.request_fingerprint is distinct from md5(p_document::text) then
     raise exception 'Request identity was reused with different content' using errcode='22023';
   end if;
   return jsonb_build_object('revision',v_previous.revision,'fingerprint',v_previous.fingerprint,'requestId',p_request_id,'document',v_previous.document);
 end if;
 v_before := public.internal_cms_document();
 if v_head<>p_base_revision or md5(v_before::text)<>p_base_fingerprint then
   raise sqlstate 'PT409' using message='CMS content changed; review the newer revision before publishing';
 end if;
 perform public.internal_cms_assert_media_publishable(p_document,v_before);
 select array_agg(id order by id) into v_current_ids from public.barbers;
 select array_agg(value->>'id' order by value->>'id') into v_new_ids from jsonb_array_elements(p_document->'barbers');
 if v_current_ids is distinct from v_new_ids then raise sqlstate 'PT409' using message='Staff membership changed; reload before publishing'; end if;
 insert into public.cms_revisions(revision,actor_id,document,fingerprint,summary)
 values(v_head,p_actor,v_before,md5(v_before::text),'Initial CMS snapshot') on conflict(revision) do nothing;

 -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.site_content existing
 where not exists (
   select 1 from jsonb_each(p_document->'site') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'site') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.site_content(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.site_content.value is distinct from excluded.value;
   end loop;
 end loop;
 -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.about_content existing
 where not exists (
   select 1 from jsonb_each(p_document->'about') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'about') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.about_content(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.about_content.value is distinct from excluded.value;
   end loop;
 end loop;
 delete from public.site_settings where key in (select key from jsonb_each(v_before->'settings')) and not p_document->'settings' ? key;
 for pair in select * from jsonb_each_text(p_document->'settings') loop
   insert into public.site_settings(key,value) values(pair.key,pair.value) on conflict(key) do update set value=excluded.value,updated_at=now();
 end loop;
 for row_data in select value from jsonb_array_elements(p_document->'barbers') loop
   update public.barbers set name=row_data->>'name',ig=row_data->>'ig',role_sv=row_data->>'role_sv',role_en=row_data->>'role_en',bio_sv=row_data->>'bio_sv',bio_en=row_data->>'bio_en',sort_order=(row_data->>'sort_order')::integer where id=row_data->>'id';
 end loop;
 delete from public.barber_photos where not p_document->'photos' ? barber_id;
 for pair in select * from jsonb_each_text(p_document->'photos') loop
   insert into public.barber_photos(barber_id,storage_path) values(pair.key,pair.value) on conflict(barber_id) do update set storage_path=excluded.storage_path,updated_at=now();
 end loop;
 delete from public.gallery_images where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_document->'gallery'));
 for row_data in select value from jsonb_array_elements(p_document->'gallery') loop
   insert into public.gallery_images(id,kind,storage_path,alt,sort_order) values((row_data->>'id')::uuid,row_data->>'kind',row_data->>'storage_path',row_data->>'alt',(row_data->>'sort_order')::integer)
   on conflict(id) do update set kind=excluded.kind,storage_path=excluded.storage_path,alt=excluded.alt,sort_order=excluded.sort_order;
 end loop;
 delete from public.email_templates t where not exists(select 1 from jsonb_array_elements(p_document->'emails') e where e->>'template'=t.template and e->>'lang'=t.lang);
 for row_data in select value from jsonb_array_elements(p_document->'emails') loop
   insert into public.email_templates(template,lang,subject,preheader,title,intro,section_title,note,cta_label,contact_lead)
   values(row_data->>'template',row_data->>'lang',row_data->>'subject',row_data->>'preheader',row_data->>'title',row_data->>'intro',row_data->>'section_title',row_data->>'note',row_data->>'cta_label',row_data->>'contact_lead')
   on conflict(template,lang) do update set subject=excluded.subject,preheader=excluded.preheader,title=excluded.title,intro=excluded.intro,section_title=excluded.section_title,note=excluded.note,cta_label=excluded.cta_label,contact_lead=excluded.contact_lead,updated_at=now();
   if row_data->'design'='null'::jsonb then delete from public.cms_email_designs where template=row_data->>'template' and lang=row_data->>'lang';
   else insert into public.cms_email_designs(template,lang,design) values(row_data->>'template',row_data->>'lang',row_data->'design') on conflict(template,lang) do update set design=excluded.design; end if;
 end loop;
 update public.cms_site set revision=v_head+1,presentation=p_document->'presentation',updated_at=now() where id;
 v_after := public.internal_cms_document();
 insert into public.cms_revisions(revision,actor_id,request_id,request_fingerprint,document,fingerprint,summary)
 values(v_head+1,p_actor,p_request_id,md5(p_document::text),v_after,md5(v_after::text),'Published website and email content');
 return jsonb_build_object('revision',v_head+1,'fingerprint',md5(v_after::text),'requestId',p_request_id,'document',v_after);
end $_$;

ALTER FUNCTION "public"."internal_cms_publish"("p_actor" "uuid", "p_document" "jsonb", "p_base_revision" bigint, "p_base_fingerprint" "text", "p_request_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."internal_cms_publish"("p_actor" "uuid", "p_document" "jsonb", "p_base_revision" bigint, "p_base_fingerprint" "text", "p_request_id" "uuid") IS 'Publishes a validated CMS document while serializing asset lifecycle changes. Archived media may stay on structured keys the authoritative head already uses and in markup when the head references the asset anywhere; any other placement requires an active asset.';

CREATE OR REPLACE FUNCTION "public"."internal_cms_register_storage_object"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
begin
  if new.bucket_id in ('gallery','barber-photos','cms-library')
     and new.name ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$'
     and new.name not like '%..%' and new.name not like '%//%' then
    insert into public.cms_assets(bucket,path,name,mime,bytes)
    values(new.bucket_id,new.name,right(new.name,160),coalesce(new.metadata->>'mimetype','application/octet-stream'),
      case when new.metadata->>'size' ~ '^[0-9]{1,14}$' then (new.metadata->>'size')::bigint else 0 end)
    on conflict(bucket,path) do nothing;
  end if;
  return new;
end $_$;

ALTER FUNCTION "public"."internal_cms_register_storage_object"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_revision"("p_actor" "uuid", "p_revision" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
 perform public.internal_cms_assert_owner(p_actor);
 return (select jsonb_build_object('revision',revision,'created_at',created_at,'document',document) from public.cms_revisions where revision=p_revision);
end $$;

ALTER FUNCTION "public"."internal_cms_revision"("p_actor" "uuid", "p_revision" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_cms_state"("p_actor" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_document jsonb;
begin
 perform public.internal_cms_assert_owner(p_actor);
 v_document := public.internal_cms_document();
 return jsonb_build_object('revision',(select revision from public.cms_site where id),'fingerprint',md5(v_document::text),'document',v_document,
 'assets',coalesce((select jsonb_agg(to_jsonb(a)-'created_at' order by a.created_at desc,a.id) from public.cms_assets a),'[]'::jsonb));
end $$;

ALTER FUNCTION "public"."internal_cms_state"("p_actor" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_delete_barber_photo"("p_barber_id" "text", "p_expected_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_path text;
  v_job_id uuid;
begin
  delete from public.barber_photos p
  where p.barber_id = p_barber_id
    and p.storage_path = p_expected_path
  returning p.storage_path into v_path;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_job_id := public.queue_storage_deletion('barber-photos', v_path);
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bucket', 'barber-photos',
    'path', v_path,
    'deletion_id', v_job_id
  );
end;
$$;

ALTER FUNCTION "public"."internal_delete_barber_photo"("p_barber_id" "text", "p_expected_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_delete_gallery_image"("p_id" "uuid", "p_expected_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_path text;
  v_job_id uuid;
begin
  delete from public.gallery_images g
  where g.id = p_id
    and g.storage_path = p_expected_path
  returning g.storage_path into v_path;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_job_id := public.queue_storage_deletion('gallery', v_path);
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bucket', 'gallery',
    'path', v_path,
    'deletion_id', v_job_id
  );
end;
$$;

ALTER FUNCTION "public"."internal_delete_gallery_image"("p_id" "uuid", "p_expected_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_insert_gallery_image"("p_kind" "text", "p_storage_path" "text", "p_alt" "text", "p_sort_order" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row public.gallery_images;
begin
  if p_kind not in ('salon', 'cuts')
     or p_storage_path is null
     or pg_catalog.char_length(p_storage_path) not between 1 and 200
     or p_storage_path not like p_kind || '/%.webp'
     or p_alt is null
     or pg_catalog.char_length(p_alt) > 2000
     or p_sort_order is null then
    raise exception using errcode = '22023', message = 'invalid gallery image';
  end if;

  insert into public.gallery_images (kind, storage_path, alt, sort_order)
  values (p_kind, p_storage_path, p_alt, p_sort_order)
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'storage_path', v_row.storage_path,
    'alt', v_row.alt,
    'sort_order', v_row.sort_order
  );
end;
$$;

ALTER FUNCTION "public"."internal_insert_gallery_image"("p_kind" "text", "p_storage_path" "text", "p_alt" "text", "p_sort_order" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_purge_email_send_log"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count integer;
begin
  delete from public.email_send_log l
  where l.created_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

ALTER FUNCTION "public"."internal_purge_email_send_log"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_queue_auth_user_delete"("p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.queue_external_action(
    'auth_user_delete',
    p_user_id::text,
    pg_catalog.jsonb_build_object('user_id', p_user_id)
  );
$$;

ALTER FUNCTION "public"."internal_queue_auth_user_delete"("p_user_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.queue_storage_deletion(p_bucket, p_object_path);
$$;

ALTER FUNCTION "public"."internal_queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_record_email_send"("p_dedupe_key" "text", "p_kind" "text", "p_recipient" "text", "p_subject" "text", "p_html" "text", "p_text_body" "text", "p_status" "text", "p_error_code" "text", "p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_booking_id uuid;
begin
  select b.id into v_booking_id
  from public.bookings b
  where b.id = p_booking_id
  for key share;

  insert into public.email_send_log as l (
    dedupe_key, kind, recipient, subject, html, text_body, status, error_code, booking_id
  )
  values (
    p_dedupe_key, p_kind, p_recipient, p_subject, p_html, p_text_body, p_status, p_error_code,
    v_booking_id
  )
  on conflict (dedupe_key) do update
  set kind = excluded.kind,
      recipient = excluded.recipient,
      subject = excluded.subject,
      html = excluded.html,
      text_body = excluded.text_body,
      status = excluded.status,
      error_code = excluded.error_code,
      booking_id = excluded.booking_id,
      attempt_count = l.attempt_count + 1,
      last_attempt_at = pg_catalog.now()
  where l.status = 'failed';
end;
$$;

ALTER FUNCTION "public"."internal_record_email_send"("p_dedupe_key" "text", "p_kind" "text", "p_recipient" "text", "p_subject" "text", "p_html" "text", "p_text_body" "text", "p_status" "text", "p_error_code" "text", "p_booking_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_remove_homepage_logo"("p_expected_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_current_path text;
  v_job_id uuid;
begin
  if p_expected_path is null
     or p_expected_path !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('homepage-logo', 0)
  );

  select nullif(s.value, '') into v_current_path
  from public.site_settings s
  where s.key = 'homepage_logo_path'
  for update;

  if v_current_path is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_current_path <> p_expected_path then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  update public.site_settings set value = '' where key = 'homepage_logo_path';
  v_job_id := public.queue_storage_deletion('gallery', v_current_path);
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bucket', 'gallery',
    'path', v_current_path,
    'deletion_id', v_job_id
  );
end;
$_$;

ALTER FUNCTION "public"."internal_remove_homepage_logo"("p_expected_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_replace_barber_photo"("p_barber_id" "text", "p_expected_path" "text", "p_new_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_current_path text;
  v_job_id uuid;
begin
  if p_new_path is null
     or p_new_path not like p_barber_id || '/%'
     or pg_catalog.char_length(p_new_path) > 300 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('barber-photo:' || p_barber_id, 0)
  );

  select p.storage_path into v_current_path
  from public.barber_photos p
  where p.barber_id = p_barber_id
  for update;

  if v_current_path is distinct from p_expected_path then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  insert into public.barber_photos (barber_id, storage_path)
  values (p_barber_id, p_new_path)
  on conflict (barber_id) do update set storage_path = excluded.storage_path;

  if v_current_path is not null and v_current_path <> p_new_path then
    v_job_id := public.queue_storage_deletion('barber-photos', v_current_path);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'previous_path', v_current_path,
    'deletion_id', v_job_id
  );
end;
$$;

ALTER FUNCTION "public"."internal_replace_barber_photo"("p_barber_id" "text", "p_expected_path" "text", "p_new_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."internal_replace_homepage_logo"("p_expected_path" "text", "p_new_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_current_path text;
  v_job_id uuid;
begin
  if p_expected_path is null
     or p_new_path is null
     or (p_expected_path <> ''
       and p_expected_path !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
     or p_new_path !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
     or pg_catalog.char_length(p_new_path) > 300 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('homepage-logo', 0)
  );

  select nullif(s.value, '') into v_current_path
  from public.site_settings s
  where s.key = 'homepage_logo_path'
  for update;

  if coalesce(v_current_path, '') <> p_expected_path then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  insert into public.site_settings (key, value)
  values ('homepage_logo_path', p_new_path)
  on conflict (key) do update set value = excluded.value;

  if v_current_path is not null then
    v_job_id := public.queue_storage_deletion('gallery', v_current_path);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'previous_path', v_current_path,
    'deletion_id', v_job_id
  );
end;
$_$;

ALTER FUNCTION "public"."internal_replace_homepage_logo"("p_expected_path" "text", "p_new_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (
      select p.role = 'owner'
      from public.profiles p
      where p.id = (select auth.uid())
        and p.account_enabled = true
    ),
    false
  );
$$;

ALTER FUNCTION "public"."is_owner"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_customer_bookings_for_browser"("p_session_hash" "text", "p_receipt_hash" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_email text;
  v_phone text;
  v_booking_phone text;
  v_name text;
  v_receipt boolean;
  v_booking_contact jsonb;
begin
  select s.email, s.phone into v_email, v_phone
  from public.customer_booking_access_scope(p_session_hash) s;
  select exists(select 1 from public.customer_booking_receipts r
    where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()) into v_receipt;
  if v_email is null and not v_receipt then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  if v_email is not null then
    select b.customer_name, b.phone into v_name, v_booking_phone from public.bookings b
    where pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email)) order by b.created_at desc, b.id desc limit 1;
  else
    -- A form hint is scoped to an exact booking created with this receipt. It is never a
    -- verified profile, and must not expand through a shared phone or email address.
    select pg_catalog.jsonb_build_object('name', b.customer_name, 'phone', b.phone, 'email', b.email)
      into v_booking_contact
    from public.bookings b
    where b.id in (select public.customer_device_booking_ids(p_receipt_hash, null))
    order by b.created_at desc, b.id desc limit 1;
  end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', true, 'authority', case when v_email is null then 'device' else 'verified' end,
    'email', v_email, 'phone', coalesce(v_booking_phone, v_phone), 'name', v_name, 'receipt_active', v_receipt,
    'booking_contact', v_booking_contact,
    'emails', case when v_email is not null then (select jsonb_agg(e order by e)
      from public.customer_profile_emails_for_email(v_email) e) end,
    'phones', case when v_email is not null then (select jsonb_agg(distinct b.phone order by b.phone)
      from public.bookings b where lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
        and b.phone ~ '^07[0-9]{8}$') end,
    'bookings', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'barber_id', b.barber_id, 'barber_name', barber.name,
      'service_name', b.service_name, 'price', b.price, 'duration_min', b.duration_min,
      'start_at', b.start_at
    ) order by b.start_at desc) from public.bookings b
      join public.barbers barber on barber.id = b.barber_id
      where b.status = 'confirmed' and (
        pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
        or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email))
      )), '[]'::jsonb)
  ));
end;
$_$;

ALTER FUNCTION "public"."list_customer_bookings_for_browser"("p_session_hash" "text", "p_receipt_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_customer_bookings_with_access"("p_session_hash" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.list_customer_bookings_for_browser(p_session_hash,null);
$$;

ALTER FUNCTION "public"."list_customer_bookings_with_access"("p_session_hash" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lock_customer_access_emails"("p_emails" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_email text;
begin
  for v_email in select distinct e from unnest(p_emails) e where e is not null order by e
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('customer-email-access'), pg_catalog.hashtext(v_email));
  end loop;
end;
$$;

ALTER FUNCTION "public"."lock_customer_access_emails"("p_emails" "text"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."mark_booking_email_delivery_recipient"("p_id" "uuid", "p_kind" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_kind not in ('customer', 'barber') then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set sent_kinds = pg_catalog.array_append(j.sent_kinds, p_kind)
  where j.id = p_id
    and j.status = 'dispatching'
    and not (p_kind = any(j.sent_kinds));

  return found or exists (
    select 1
    from public.booking_email_delivery_jobs j
    where j.id = p_id
      and j.status in ('dispatching', 'delivered')
      and p_kind = any(j.sent_kinds)
  );
end;
$$;

ALTER FUNCTION "public"."mark_booking_email_delivery_recipient"("p_id" "uuid", "p_kind" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."mark_booking_reminder_delivered"("p_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.booking_reminders r
  set delivered_at = coalesce(r.delivered_at, pg_catalog.now())
  where r.booking_id = p_id;

  return found;
end;
$$;

ALTER FUNCTION "public"."mark_booking_reminder_delivered"("p_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."normalize_site_setting_value"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_value text := pg_catalog.btrim(new.value);
begin
  case new.key
    when 'homepage_scale', 'about_scale', 'homepage_logo_scale' then
      if v_value not in ('sm', 'md', 'lg', 'xl') then
        raise exception using errcode = '22023', message = 'invalid scale setting';
      end if;
    when 'homepage_logo_style' then
      if v_value not in ('classic', 'monochrome') then
        raise exception using errcode = '22023', message = 'invalid homepage logo style';
      end if;
    when 'homepage_logo_path' then
      if v_value <> ''
         and v_value !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' then
        raise exception using errcode = '22023', message = 'invalid homepage logo path';
      end if;
    when 'business_name', 'business_street', 'business_city' then
      if char_length(v_value) not between 1 and 160 then
        raise exception using errcode = '22023', message = 'invalid business text setting';
      end if;
    when 'business_legal_name' then
      if char_length(v_value) > 160 or v_value ~ '[[:cntrl:]]' then
        raise exception using errcode = '22023', message = 'invalid legal business name';
      end if;
    when 'business_org_number' then
      if v_value <> '' and v_value !~ '^[0-9]{6}-?[0-9]{4}$' then
        raise exception using errcode = '22023', message = 'invalid business registration number';
      end if;
      if v_value <> '' then
        v_value := pg_catalog.replace(v_value, '-', '');
        v_value := pg_catalog.left(v_value, 6) || '-' || pg_catalog.right(v_value, 4);
      end if;
    when 'business_email' then
      v_value := pg_catalog.lower(v_value);
      if v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception using errcode = '22023', message = 'invalid business email setting';
      end if;
    when 'business_phone_display' then
      if v_value <> '' and char_length(v_value) not between 1 and 80 then
        raise exception using errcode = '22023', message = 'invalid business phone display setting';
      end if;
    when 'business_phone_tel' then
      v_value := pg_catalog.regexp_replace(v_value, '[[:space:]().-]', '', 'g');
      if v_value <> '' and v_value !~ '^\+?[0-9]{3,20}$' then
        raise exception using errcode = '22023', message = 'invalid business phone setting';
      end if;
    when 'business_postal_code' then
      v_value := pg_catalog.regexp_replace(v_value, '[[:space:]]', '', 'g');
      if v_value !~ '^[0-9]{5}$' then
        raise exception using errcode = '22023', message = 'invalid business postal code setting';
      end if;
      v_value := pg_catalog.left(v_value, 3) || ' ' || pg_catalog.right(v_value, 2);
    when 'business_maps_href' then
      if v_value <> '' and v_value !~ '^https://[^[:space:]]+$' then
        raise exception using errcode = '22023', message = 'invalid business maps URL setting';
      end if;
    when 'cancellation_policy_hours' then
      if v_value !~ '^[0-9]{1,3}$' or v_value::integer not between 1 and 168 then
        raise exception using errcode = '22023', message = 'invalid cancellation policy setting';
      end if;
    when 'seo_title_sv', 'seo_title_en' then
      if char_length(v_value) not between 1 and 120 then
        raise exception using errcode = '22023', message = 'invalid SEO title setting';
      end if;
    when 'seo_description_sv', 'seo_description_en' then
      if char_length(v_value) not between 1 and 500 then
        raise exception using errcode = '22023', message = 'invalid SEO description setting';
      end if;
    else
      new.value := v_value;
      return new;
  end case;

  new.value := v_value;
  return new;
end;
$_$;

ALTER FUNCTION "public"."normalize_site_setting_value"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_calendar_disconnect"("p_barber_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_action_id uuid;
  v_event_count bigint;
  v_map record;
begin
  update public.barber_calendar_tokens t
  set disconnect_requested_at = coalesce(t.disconnect_requested_at, pg_catalog.now())
  where t.barber_id = p_barber_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'pending', false);
  end if;

  for v_map in
    select m.booking_id
    from public.calendar_event_map m
    where m.barber_id = p_barber_id
  loop
    perform public.queue_calendar_event_deletion(v_map.booking_id);
  end loop;

  select pg_catalog.count(*) into v_event_count
  from public.calendar_event_map m
  where m.barber_id = p_barber_id;

  v_action_id := public.queue_external_action(
    'calendar_disconnect',
    p_barber_id,
    pg_catalog.jsonb_build_object('barber_id', p_barber_id)
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'pending', true,
    'calendar_events', v_event_count,
    'action_id', v_action_id
  );
end;
$$;

ALTER FUNCTION "public"."prepare_calendar_disconnect"("p_barber_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prevent_barber_delete_with_calendar_cleanup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.calendar_event_map m
    where m.barber_id = old.id
  ) or exists (
    select 1
    from public.external_action_jobs j
    where j.action_type = 'calendar_event_delete'
      and j.status in ('pending', 'dispatching', 'blocked')
      and j.payload->>'barber_id' = old.id
  ) then
    raise exception using errcode = '55000', message = 'calendar_cleanup_pending';
  end if;
  return old;
end;
$$;

ALTER FUNCTION "public"."prevent_barber_delete_with_calendar_cleanup"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prevent_booking_delete_with_unresolved_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    where j.booking_id = old.id
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    raise exception using
      errcode = '55000',
      message = 'booking_email_delivery_unresolved';
  end if;

  return old;
end;
$$;

ALTER FUNCTION "public"."prevent_booking_delete_with_unresolved_email"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prune_cms_revisions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_pruned integer;
begin
  lock table public.barbers,public.site_content,public.about_content,public.site_settings,public.barber_photos,public.gallery_images,public.email_templates,public.cms_email_designs,public.cms_assets in share row exclusive mode;
  if exists (
    select 1
    from public.cms_site s
    join public.cms_revisions head on head.revision = s.revision
    where s.id and (
      -- Read actual rendered source values. JSON serialization escapes ordinary quotes/newlines;
      -- unrelated prose/settings can contain backslashes without hiding a rendered resource.
      exists (
        select 1
        from (
          select value from jsonb_path_query(head.document, '$.presentation.pages[*].content.*')
            as page_variant(value)
          union all
          select value from jsonb_path_query(head.document, '$.presentation.regions.*.*')
            as region_variant(value)
        ) as variant
        cross join lateral (values
          (variant.value->>'html'),
          (variant.value#>>'{css,light}'),
          (variant.value#>>'{css,dark}')
        ) as markup(source)
        where strpos(markup.source,chr(92))>0
          -- URL normalization consumes one/two dot segments, including mixed %2e spellings.
          -- A delimiter/end after the segment avoids treating /.class or /file.webp as a dot.
          or markup.source ~* '/(\.|%2e){1,2}(/|[^a-z0-9_%.-]|$)'
      )
      -- Keep the prior conservative percent/entity checks, including legacy markup fields and
      -- encoded storage bucket/path/query suffixes outside the supported page/region structure.
      or head.document::text ~ '/object/publi(?!c/)'
      or exists (
        select 1
        from regexp_matches(head.document::text,
          '/storage/v1/object/public/(([^"<>\\]|\\[^"])*)', 'g') as candidate(parts)
        where candidate.parts[1] ~ '%[0-9A-Fa-f]{2}|\\[^"]|&(?!quot;)'
      )
    )
  ) then
    raise warning 'CMS revisions not pruned: the head contains escaped or noncanonical resource markup';
    return 0;
  end if;
  with pruned as (
    delete from public.cms_revisions r
    where r.created_at < pg_catalog.now() - interval '30 days'
      and r.revision <> (select s.revision from public.cms_site s where s.id)
      and r.revision <> (select max(newest.revision) from public.cms_revisions newest)
    returning 1
  )
  select count(*)::integer into v_pruned from pruned;
  return v_pruned;
end;
$_$;

ALTER FUNCTION "public"."prune_cms_revisions"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_booking_catalog"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'barbers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'ig', b.ig,
        'role_sv', b.role_sv,
        'role_en', b.role_en,
        'bio_sv', b.bio_sv,
        'bio_en', b.bio_en,
        'active', b.active,
        'sort_order', b.sort_order,
        'photo_path', p.storage_path
      ) order by b.sort_order, b.name)
      from public.barbers b
      left join public.barber_photos p on p.barber_id = b.id
      where b.active
    ), '[]'::jsonb),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id,
        'barber_id', s.barber_id,
        'name', s.name,
        'price', s.price,
        'duration_min', s.duration_min,
        'active', s.active,
        'sort_order', s.sort_order,
        'available_weekdays', s.available_weekdays
      ) order by s.barber_id, s.sort_order, s.name)
      from public.services s
      join public.barbers b on b.id = s.barber_id and b.active
      where s.active
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."public_booking_catalog"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_business_discovery"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'settings', coalesce((
      select pg_catalog.jsonb_object_agg(s.key, s.value)
      from public.site_settings s
      where s.key = any (array[
        'homepage_scale', 'about_scale', 'homepage_logo_path', 'homepage_logo_scale',
        'homepage_logo_style',
        'business_legal_name', 'business_org_number',
        'business_name', 'business_email', 'business_phone_display', 'business_phone_tel',
        'business_street', 'business_postal_code', 'business_city', 'business_maps_href',
        'cancellation_policy_hours',
        'seo_title_sv', 'seo_description_sv', 'seo_title_en', 'seo_description_en'
      ]::text[])
    ), '{}'::jsonb),
    'barbers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'name', b.name
      ) order by b.sort_order, b.id)
      from public.barbers b
      where b.active = true
    ), '[]'::jsonb),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id,
        'barber_id', s.barber_id,
        'price', s.price
      ) order by s.barber_id, s.sort_order, s.id)
      from public.services s
      join public.barbers b on b.id = s.barber_id and b.active = true
      where s.active = true
    ), '[]'::jsonb),
    'schedules', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'barber_id', s.barber_id,
        'weekday', s.weekday,
        'start_min', s.start_min,
        'end_min', s.end_min
      ) order by s.weekday, s.start_min, s.barber_id)
      from public.barber_schedules s
      join public.barbers b on b.id = s.barber_id and b.active = true
      where s.working = true
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION "public"."public_business_discovery"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_cms_page"("p_path" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'revision', s.revision,
    'page', p,
    'themes', s.presentation -> 'themes',
    'fonts', s.presentation -> 'fonts'
  )
  from public.cms_site s, lateral jsonb_array_elements(s.presentation -> 'pages') p
  where s.id and p ->> 'path' = p_path
  limit 1;
$$;

ALTER FUNCTION "public"."public_cms_page"("p_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_cms_page_metadata"("p_path" "text", "p_lang" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'revision', s.revision,
    'title', p -> 'title' ->> p_lang,
    'description', p -> 'description' ->> p_lang
  )
  from public.cms_site s, lateral jsonb_array_elements(s.presentation -> 'pages') p
  where s.id and p ->> 'path' = p_path and p_lang in ('sv', 'en')
  limit 1;
$$;

ALTER FUNCTION "public"."public_cms_page_metadata"("p_path" "text", "p_lang" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_cms_presentation"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 select jsonb_build_object('revision',revision,'presentation',presentation) from public.cms_site where id;
$$;

ALTER FUNCTION "public"."public_cms_presentation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_booking_calendar_cleanup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    perform public.queue_calendar_event_deletion(old.id);
    return old;
  end if;

  if old.status = 'confirmed' and new.status <> 'confirmed' then
    perform public.queue_calendar_event_deletion(new.id);
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."queue_booking_calendar_cleanup"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_booking_calendar_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.barber_id is distinct from new.barber_id
     or old.service_name is distinct from new.service_name
     or old.customer_name is distinct from new.customer_name
     or old.phone is distinct from new.phone
     or old.email is distinct from new.email
     or old.start_at is distinct from new.start_at
     or old.end_at is distinct from new.end_at then
    perform public.queue_calendar_event_sync(new.id);
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."queue_booking_calendar_sync"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_booking_email_delivery"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'booking_confirmed';
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled' then
    v_event := 'booking_cancelled';
  else
    return new;
  end if;

  insert into public.booking_email_delivery_jobs (booking_id, event)
  values (new.id, v_event)
  on conflict (booking_id, event) do nothing;

  return new;
end;
$$;

ALTER FUNCTION "public"."queue_booking_email_delivery"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_booking_reminder_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.status = 'confirmed'
     and new.email is not null
     and new.start_at - new.created_at >= interval '24 hours' then
    insert into public.booking_reminders (booking_id, due_at)
    values (new.id, new.start_at - interval '24 hours')
    on conflict (booking_id) do nothing;
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."queue_booking_reminder_after_insert"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_calendar_event_deletion"("p_booking_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_map public.calendar_event_map;
begin
  select m.* into v_map
  from public.calendar_event_map m
  where m.booking_id = p_booking_id
  for update;

  if not found then
    return null;
  end if;

  return public.queue_external_action(
    'calendar_event_delete',
    p_booking_id::text,
    pg_catalog.jsonb_build_object(
      'booking_id', v_map.booking_id,
      'barber_id', v_map.barber_id,
      'calendar_id', v_map.calendar_id,
      'google_event_id', v_map.google_event_id
    )
  );
end;
$$;

ALTER FUNCTION "public"."queue_calendar_event_deletion"("p_booking_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_calendar_event_sync"("p_booking_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and b.status = 'confirmed'
      and (
        exists (
          select 1
          from public.barber_calendar_tokens t
          where t.barber_id = b.barber_id
            and t.disconnect_requested_at is null
        )
        or exists (
          select 1
          from public.calendar_event_map m
          where m.booking_id = b.id
        )
      )
  ) then
    return null;
  end if;

  return public.queue_external_action(
    'calendar_event_sync',
    p_booking_id::text,
    pg_catalog.jsonb_build_object('booking_id', p_booking_id)
  );
end;
$$;

ALTER FUNCTION "public"."queue_calendar_event_sync"("p_booking_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_due_booking_email_deliveries"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_url    text;
  v_secret text;
  v_job    record;
  v_queued integer := 0;
begin
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'booking_confirmation_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return 0;
  end if;

  for v_job in
    select j.id
    from public.booking_email_delivery_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= pg_catalog.now())
       or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit 50
  loop
    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object('delivery_id', v_job.id),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 30000
    );

    update public.booking_email_delivery_jobs j
    set status = 'dispatching',
        attempt_count = j.attempt_count + 1,
        last_attempt_at = pg_catalog.now(),
        last_error_code = null
    where j.id = v_job.id;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception
  when others then
    raise warning 'booking email delivery enqueue failed';
    return v_queued;
end;
$$;

ALTER FUNCTION "public"."queue_due_booking_email_deliveries"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_due_booking_reminders"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_url        text;
  v_secret     text;
  v_booking_id uuid;
  v_queued     integer := 0;
begin
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'booking_confirmation_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return 0;
  end if;

  for v_booking_id in
    select r.booking_id
    from public.booking_reminders r
    join public.bookings b on b.id = r.booking_id
    where r.delivered_at is null
      and r.due_at <= pg_catalog.now()
      and (r.last_attempt_at is null or r.last_attempt_at <= pg_catalog.now() - interval '5 minutes')
      and b.status = 'confirmed'
      and b.email is not null
      and b.start_at > pg_catalog.now() + interval '23 hours'
    order by r.due_at
    for update of r skip locked
    limit 50
  loop
    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object(
        'id', v_booking_id,
        'event', 'booking_reminder'
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 30000
    );

    update public.booking_reminders r
    set last_attempt_at = pg_catalog.now(),
        attempt_count = r.attempt_count + 1
    where r.booking_id = v_booking_id;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception
  when others then
    raise warning 'booking reminder enqueue failed: %', sqlerrm;
    return v_queued;
end;
$$;

ALTER FUNCTION "public"."queue_due_booking_reminders"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_due_external_actions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_url text;
  v_secret text;
  v_job record;
  v_dispatch_token uuid;
  v_queued integer := 0;
begin
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'external_cleanup_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return 0;
  end if;

  for v_job in
    select j.id
    from public.external_action_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= pg_catalog.now())
       or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit 25
  loop
    update public.external_action_jobs j
    set status = 'dispatching',
        attempt_count = j.attempt_count + 1,
        last_attempt_at = pg_catalog.now(),
        dispatch_token = pg_catalog.gen_random_uuid(),
        last_error_code = null
    where j.id = v_job.id
    returning j.dispatch_token into v_dispatch_token;

    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object(
        'action_id', v_job.id,
        'dispatch_token', v_dispatch_token
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 30000
    );

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception when others then
  raise warning 'external action enqueue failed';
  return v_queued;
end;
$$;

ALTER FUNCTION "public"."queue_due_external_actions"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_external_action"("p_action_type" "text", "p_dedupe_key" "text", "p_payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_id uuid;
begin
  if p_dedupe_key is null
     or pg_catalog.char_length(p_dedupe_key) not between 1 and 300
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid external action';
  end if;

  if p_action_type = 'storage_object_delete' then
    if p_payload->>'bucket' not in ('gallery', 'barber-photos')
       or p_payload->>'path' is null
       or pg_catalog.char_length(p_payload->>'path') not between 1 and 300 then
      raise exception using errcode = '22023', message = 'invalid storage deletion target';
    end if;
  elsif p_action_type in ('calendar_event_sync', 'calendar_event_delete') then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.booking_id ? (@.type() == "string")'
    ) then
      raise exception using errcode = '22023', message = 'invalid calendar action target';
    end if;
    perform (p_payload->>'booking_id')::uuid;
  elsif p_action_type = 'calendar_disconnect' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.barber_id ? (@.type() == "string")'
    )
       or pg_catalog.char_length(p_payload->>'barber_id') not between 1 and 32 then
      raise exception using errcode = '22023', message = 'invalid calendar disconnect target';
    end if;
  elsif p_action_type = 'customer_access_email_send' then
    if pg_catalog.jsonb_typeof(p_payload->'challenge_id') <> 'string'
       or p_payload->>'challenge_id' is null
       or pg_catalog.jsonb_typeof(p_payload->'lang') <> 'string'
       or p_payload->>'lang' not in ('sv', 'en')
       or (p_payload - 'challenge_id' - 'lang') <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'invalid customer access delivery';
    end if;
    perform (p_payload->>'challenge_id')::uuid;
  elsif p_action_type = 'auth_user_access_sync' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.user_id ? (@.type() == "string")'
    )
       or pg_catalog.jsonb_typeof(p_payload->'account_enabled') <> 'boolean'
       or pg_catalog.jsonb_typeof(p_payload->'version') <> 'number' then
      raise exception using errcode = '22023', message = 'invalid auth access target';
    end if;
    perform (p_payload->>'user_id')::uuid;
    perform (p_payload->>'version')::bigint;
  elsif p_action_type = 'auth_user_delete' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.user_id ? (@.type() == "string")'
    ) then
      raise exception using errcode = '22023', message = 'invalid auth deletion target';
    end if;
    perform (p_payload->>'user_id')::uuid;
  else
    raise exception using errcode = '22023', message = 'unsupported external action';
  end if;

  insert into public.external_action_jobs (action_type, dedupe_key, payload)
  values (p_action_type, p_dedupe_key, p_payload)
  on conflict (action_type, dedupe_key) do update
    set payload = excluded.payload,
        status = 'pending',
        next_attempt_at = pg_catalog.now(),
        dispatch_token = null,
        last_error_code = null
  returning id into v_id;

  return v_id;
end;
$_$;

ALTER FUNCTION "public"."queue_external_action"("p_action_type" "text", "p_dedupe_key" "text", "p_payload" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_orphaned_storage_objects"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_object record;
  v_queued integer := 0;
begin
  for v_object in
    select o.bucket_id, o.name
    from storage.objects o
    where o.bucket_id in ('gallery', 'barber-photos')
      and o.created_at < pg_catalog.now() - interval '30 minutes'
      and not exists (
        select 1 from public.external_action_jobs j
        where j.action_type = 'storage_object_delete'
          and j.dedupe_key = o.bucket_id || ':' || o.name
      )
      and not exists (
        select 1 from public.cms_assets a
        where a.bucket = o.bucket_id and a.path = o.name
      )
      and (
        (o.bucket_id = 'gallery' and not exists (
          select 1 from public.gallery_images g where g.storage_path = o.name
        ) and not exists (
          select 1 from public.site_settings s
          where s.key = 'homepage_logo_path' and s.value = o.name
        ))
        or
        (o.bucket_id = 'barber-photos' and not exists (
          select 1 from public.barber_photos p where p.storage_path = o.name
        ))
      )
    order by o.created_at, o.id
    limit 100
  loop
    perform public.queue_external_action(
      'storage_object_delete',
      v_object.bucket_id || ':' || v_object.name,
      pg_catalog.jsonb_build_object('bucket', v_object.bucket_id, 'path', v_object.name)
    );
    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

ALTER FUNCTION "public"."queue_orphaned_storage_objects"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.queue_external_action(
    'storage_object_delete',
    p_bucket || ':' || p_object_path,
    pg_catalog.jsonb_build_object('bucket', p_bucket, 'path', p_object_path)
  );
$$;

ALTER FUNCTION "public"."queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."replace_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_expected_generation" bigint DEFAULT NULL::bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if v_email is null or p_phone is null or p_token_hash is null
     or p_token_ciphertext is null or p_expected_generation is null
     or p_expected_generation < 1
     or p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or not exists (
       select 1 from public.bookings b
       where b.phone = p_phone and pg_catalog.lower(b.email) = v_email
         and b.status = 'confirmed'
     ) then
    return false;
  end if;

  perform public.lock_customer_access_emails(array[v_email]);

  update public.customer_booking_access_tokens t
  set phone = p_phone, token_hash = p_token_hash, token_ciphertext = p_token_ciphertext,
      generation = t.generation + 1, updated_at = pg_catalog.now()
  where t.email = v_email and t.generation = p_expected_generation;
  if not found then return false; end if;

  -- Same lock order as fresh-link rotation: token, challenges, sessions.
  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;
  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;
  return true;
end;
$_$;

ALTER FUNCTION "public"."replace_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_expected_generation" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."request_customer_email_link"("p_session_hash" "text", "p_target_email" "text", "p_source_hash" "text", "p_target_hash" "text", "p_source_ciphertext" "text", "p_target_ciphertext" "text", "p_lang" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_source text;
  v_target text := lower(btrim(p_target_email));
  v_source_profile uuid;
  v_target_profile uuid;
  v_source_version bigint;
  v_target_version bigint;
  v_source_generation bigint;
  v_target_generation bigint;
  v_id uuid;
begin
  select s.email into v_source from public.customer_booking_access_sessions s
    where s.token_hash = p_session_hash and s.expires_at > pg_catalog.now();
  if v_source is null then return jsonb_build_object('ok',false,'error','access_denied'); end if;
  if v_target is null or length(v_target) > 254 or v_target !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_target_hash is null or p_target_hash !~ '^[0-9a-f]{64}$'
    or p_source_hash = p_target_hash
    or p_source_ciphertext is null or p_source_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
    or p_target_ciphertext is null or p_target_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
    or length(p_source_ciphertext) not between 40 and 700 or length(p_target_ciphertext) not between 40 and 700
    or p_lang is null or p_lang not in ('sv','en') then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  v_source_profile := public.ensure_customer_email_profile(v_source);
  v_target_profile := public.ensure_customer_email_profile(v_target);
  if v_source_profile = v_target_profile then return jsonb_build_object('ok',true,'status','already_linked'); end if;
  -- Consistent row order for merges touching the same pair in opposite directions.
  perform 1 from public.customer_profiles where id in(v_source_profile,v_target_profile) order by id for update;
  if not exists(select 1 from public.customer_profile_emails where email=v_source and profile_id=v_source_profile)
    or not exists(select 1 from public.customer_profile_emails where email=v_target and profile_id=v_target_profile) then
    return jsonb_build_object('ok',false,'error','stale');
  end if;
  perform public.lock_customer_access_emails(array[v_source,v_target]);
  if not exists(select 1 from public.customer_booking_access_sessions where token_hash=p_session_hash
    and email=v_source and expires_at > pg_catalog.now()) then
    return jsonb_build_object('ok',false,'error','access_denied');
  end if;
  select version into v_source_version from public.customer_profiles where id=v_source_profile;
  select version into v_target_version from public.customer_profiles where id=v_target_profile;
  select generation into v_source_generation from public.customer_booking_access_tokens where email=v_source;
  select coalesce((select generation from public.customer_booking_access_tokens where email=v_target),0) into v_target_generation;
  if v_source_generation is null then return jsonb_build_object('ok',false,'error','access_denied'); end if;
  update public.customer_email_links set used_at=pg_catalog.now() where source_email=v_source and used_at is null;
  insert into public.customer_email_links(source_email,target_email,source_profile,target_profile,
    source_version,target_version,source_generation,target_generation,source_hash,target_hash,source_ciphertext,target_ciphertext)
  values(v_source,v_target,v_source_profile,v_target_profile,v_source_version,v_target_version,
    v_source_generation,v_target_generation,p_source_hash,p_target_hash,p_source_ciphertext,p_target_ciphertext)
  returning id into v_id;
  insert into public.external_action_jobs(action_type,dedupe_key,payload) values
    ('customer_email_link_send',v_id::text||'/source',jsonb_build_object('link_id',v_id,'side','source','lang',p_lang)),
    ('customer_email_link_send',v_id::text||'/target',jsonb_build_object('link_id',v_id,'side','target','lang',p_lang));
  return jsonb_build_object('ok',true,'status','queued');
end;
$_$;

ALTER FUNCTION "public"."request_customer_email_link"("p_session_hash" "text", "p_target_email" "text", "p_source_hash" "text", "p_target_hash" "text", "p_source_ciphertext" "text", "p_target_ciphertext" "text", "p_lang" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."revoke_disabled_staff_invitation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not new.account_enabled or new.role <> 'barber'
    or new.barber_id is distinct from old.barber_id then
    delete from public.staff_invitations where user_id = new.id;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."revoke_disabled_staff_invitation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."rotate_customer_booking_access_token"("p_email" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_access_code" "text", "p_lang" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_phone text;
  v_challenge_id uuid;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or p_access_code !~ '^[0-9a-f]{64}$'
     or p_lang not in ('sv', 'en') then
    return false;
  end if;

  select b.phone into v_phone
  from public.bookings b
  where pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
    and b.status = 'confirmed'
    and b.phone ~ '^07[0-9]{8}$'
  order by b.created_at desc, b.id desc
  limit 1;

  if not found then
    return false;
  end if;

  perform public.lock_customer_access_emails(array[v_email]);

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, v_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        token_hash = excluded.token_hash,
        token_ciphertext = excluded.token_ciphertext,
        generation = public.customer_booking_access_tokens.generation + 1,
        updated_at = pg_catalog.now();

  -- Wait for any in-flight legacy exchange before taking the session-deletion snapshot.
  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;

  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;

  insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_token_hash, 'infinity'::timestamptz)
  returning id into v_challenge_id;

  perform public.queue_external_action(
    'customer_access_email_send',
    v_challenge_id::text,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_challenge_id,
      'lang', p_lang
    )
  );

  return true;
end;
$_$;

ALTER FUNCTION "public"."rotate_customer_booking_access_token"("p_email" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_access_code" "text", "p_lang" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_own_password_changed"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.profiles
  set    must_change_password = false
  where  id = (select auth.uid());
$$;

ALTER FUNCTION "public"."set_own_password_changed"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS "public"."about_content" (
    "key" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "about_content_key_check" CHECK (("key" = ANY (ARRAY['eyebrow'::"text", 'heading'::"text", 'intro'::"text", 'galleryTitle'::"text", 'cutsTitle'::"text", 'stylistsTitle'::"text", 'reviewsTitle'::"text"]))),
    CONSTRAINT "about_content_lang_check" CHECK (("lang" = ANY (ARRAY['sv'::"text", 'en'::"text"]))),
    CONSTRAINT "about_content_value_check" CHECK (("char_length"("value") <= 2000))
);

ALTER TABLE "public"."about_content" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."auth_email_rate_limits" (
    "kind" "text" NOT NULL,
    "scope_hash" "text" NOT NULL,
    "last_sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auth_email_rate_limits_kind_check" CHECK (("kind" = ANY (ARRAY['recovery'::"text", 'email_change'::"text"]))),
    CONSTRAINT "auth_email_rate_limits_scope_hash_check" CHECK (("char_length"("scope_hash") = 64))
);

ALTER TABLE "public"."auth_email_rate_limits" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barber_calendar_tokens" (
    "barber_id" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "google_email" "text",
    "calendar_id" "text" DEFAULT 'primary'::"text" NOT NULL,
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_sync_at" timestamp with time zone,
    "last_sync_error" "text",
    "disconnect_requested_at" timestamp with time zone
);

ALTER TABLE "public"."barber_calendar_tokens" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barber_photos" (
    "barber_id" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "barber_photos_path_len" CHECK ((("char_length"("storage_path") >= 1) AND ("char_length"("storage_path") <= 300)))
);

ALTER TABLE "public"."barber_photos" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barber_recurring_breaks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "barber_id" "text" NOT NULL,
    "weekday" smallint NOT NULL,
    "start_min" smallint NOT NULL,
    "end_min" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "barber_recurring_breaks_end_min_check" CHECK ((("end_min" BETWEEN 555 AND 1080) AND ((("end_min")::integer % 15) = 0))),
    CONSTRAINT "barber_recurring_breaks_start_min_check" CHECK ((("start_min" BETWEEN 540 AND 1065) AND ((("start_min")::integer % 15) = 0))),
    CONSTRAINT "barber_recurring_breaks_time_order" CHECK (("end_min" > "start_min")),
    CONSTRAINT "barber_recurring_breaks_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);

ALTER TABLE "public"."barber_recurring_breaks" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barber_schedules" (
    "barber_id" "text" NOT NULL,
    "weekday" smallint NOT NULL,
    "working" boolean DEFAULT false NOT NULL,
    "start_min" smallint DEFAULT 540 NOT NULL,
    "end_min" smallint DEFAULT 1080 NOT NULL,
    CONSTRAINT "barber_schedules_end_min_check" CHECK ((("end_min" >= 0) AND ("end_min" <= 1440))),
    CONSTRAINT "barber_schedules_start_min_check" CHECK ((("start_min" >= 0) AND ("start_min" <= 1440))),
    CONSTRAINT "barber_schedules_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6))),
    CONSTRAINT "sched_time_order" CHECK (("end_min" > "start_min"))
);

ALTER TABLE "public"."barber_schedules" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barber_slot_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "barber_id" "text" NOT NULL,
    "block_date" "date" NOT NULL,
    "start_min" smallint NOT NULL,
    "end_min" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "barber_slot_blocks_end_min_check" CHECK ((("end_min" >= 0) AND ("end_min" <= 1440))),
    CONSTRAINT "barber_slot_blocks_start_min_check" CHECK ((("start_min" >= 0) AND ("start_min" <= 1440))),
    CONSTRAINT "slot_block_order" CHECK (("end_min" > "start_min"))
);

ALTER TABLE "public"."barber_slot_blocks" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barber_time_off" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "barber_id" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "barber_time_off_reason_check" CHECK (("char_length"("reason") <= 120)),
    CONSTRAINT "timeoff_order" CHECK (("end_date" >= "start_date"))
);

ALTER TABLE "public"."barber_time_off" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."barbers" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "ig" "text" DEFAULT ''::"text" NOT NULL,
    "role_sv" "text" DEFAULT 'Barberare'::"text" NOT NULL,
    "role_en" "text" DEFAULT 'Barber'::"text" NOT NULL,
    "bio_sv" "text" DEFAULT ''::"text" NOT NULL,
    "bio_en" "text" DEFAULT ''::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "barbers_bio_en_check" CHECK (("char_length"("bio_en") <= 600)),
    CONSTRAINT "barbers_bio_sv_check" CHECK (("char_length"("bio_sv") <= 600)),
    CONSTRAINT "barbers_id_check" CHECK ((("char_length"("id") BETWEEN 1 AND 32) AND ("id" ~ '^[a-z0-9-]+$'::"text"))),
    CONSTRAINT "barbers_ig_check" CHECK (("char_length"("ig") <= 60)),
    CONSTRAINT "barbers_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 60)))
);

ALTER TABLE "public"."barbers" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_attempts" (
    "id" bigint NOT NULL,
    "ip_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."booking_attempts" OWNER TO "postgres";

CREATE SEQUENCE IF NOT EXISTS "public"."booking_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."booking_attempts_id_seq" OWNER TO "postgres";

ALTER SEQUENCE "public"."booking_attempts_id_seq" OWNED BY "public"."booking_attempts"."id";

CREATE TABLE IF NOT EXISTS "public"."booking_email_delivery_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sent_kinds" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "failed_at" timestamp with time zone,
    CONSTRAINT "booking_email_delivery_jobs_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "booking_email_delivery_jobs_event_check" CHECK (("event" = ANY (ARRAY['booking_confirmed'::"text", 'booking_cancelled'::"text"]))),
    CONSTRAINT "booking_email_delivery_jobs_last_error_code_check" CHECK ((("last_error_code" IS NULL) OR ("char_length"("last_error_code") <= 80))),
    CONSTRAINT "booking_email_delivery_jobs_sent_kinds_check" CHECK (("sent_kinds" <@ ARRAY['customer'::"text", 'barber'::"text"])),
    CONSTRAINT "booking_email_delivery_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'dispatching'::"text", 'delivered'::"text", 'skipped'::"text", 'superseded'::"text", 'failed'::"text"])))
);

ALTER TABLE "public"."booking_email_delivery_jobs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_reminders" (
    "booking_id" "uuid" NOT NULL,
    "due_at" timestamp with time zone NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_reminders_attempt_count_check" CHECK (("attempt_count" >= 0))
);

ALTER TABLE "public"."booking_reminders" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "barber_id" "text" NOT NULL,
    "service_id" "text" NOT NULL,
    "service_name" "text" NOT NULL,
    "price" numeric NOT NULL,
    "duration_min" integer NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "customer_name" "text" NOT NULL,
    "method" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "lang" "text" NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cancelled_at" timestamp with time zone,
    CONSTRAINT "bookings_cancel_consistency" CHECK ((("status" = 'cancelled'::"text") = ("cancelled_at" IS NOT NULL))),
    CONSTRAINT "bookings_contact_matches_method" CHECK (((("method" = 'phone'::"text") AND ("phone" IS NOT NULL)) OR (("method" = 'email'::"text") AND ("email" IS NOT NULL)) OR (("method" = 'walkin'::"text") AND ("phone" IS NULL) AND ("email" IS NULL)))),
    CONSTRAINT "bookings_customer_name_check" CHECK ((("char_length"("customer_name") >= 1) AND ("char_length"("customer_name") <= 80))),
    CONSTRAINT "bookings_duration_min_check" CHECK ((("duration_min" > 0) AND ("duration_min" <= 600))),
    CONSTRAINT "bookings_email_check" CHECK ((("email" IS NULL) OR (("char_length"("email") BETWEEN 3 AND 254) AND (POSITION(('@'::"text") IN ("email")) > 1)))),
    CONSTRAINT "bookings_lang_check" CHECK (("lang" = ANY (ARRAY['sv'::"text", 'en'::"text"]))),
    CONSTRAINT "bookings_method_valid" CHECK (("method" = ANY (ARRAY['phone'::"text", 'email'::"text", 'walkin'::"text"]))),
    CONSTRAINT "bookings_phone_check" CHECK ((("phone" IS NULL) OR ("phone" ~ '^07[0-9]{8}$'::"text"))),
    CONSTRAINT "bookings_price_check" CHECK ((("price" >= (0)::numeric) AND ("price" <= (100000)::numeric) AND ("price" = "trunc"("price", 2)))),
    CONSTRAINT "bookings_service_id_check" CHECK ((("char_length"("service_id") >= 1) AND ("char_length"("service_id") <= 64))),
    CONSTRAINT "bookings_service_name_check" CHECK ((("char_length"("service_name") >= 1) AND ("char_length"("service_name") <= 80))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "bookings_time_order" CHECK (("end_at" > "start_at"))
);

ALTER TABLE "public"."bookings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."calendar_event_map" (
    "booking_id" "uuid" NOT NULL,
    "barber_id" "text" NOT NULL,
    "google_event_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "calendar_id" "text" NOT NULL
);

ALTER TABLE "public"."calendar_event_map" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cms_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket" "text" NOT NULL,
    "path" "text" NOT NULL,
    "name" "text" NOT NULL,
    "alt" "text" DEFAULT ''::"text" NOT NULL,
    "mime" "text" NOT NULL,
    "width" integer,
    "height" integer,
    "bytes" bigint DEFAULT 0 NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trashed_at" timestamp with time zone,
    "deleting_at" timestamp with time zone,
    CONSTRAINT "cms_assets_alt_check" CHECK (("char_length"("alt") <= 2000)),
    CONSTRAINT "cms_assets_bucket_check" CHECK (("bucket" = ANY (ARRAY['gallery'::"text", 'barber-photos'::"text", 'cms-library'::"text"]))),
    CONSTRAINT "cms_assets_bytes_check" CHECK (("bytes" >= 0)),
    CONSTRAINT "cms_assets_height_check" CHECK ((("height" IS NULL) OR ("height" > 0))),
    CONSTRAINT "cms_assets_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 160))),
    CONSTRAINT "cms_assets_path_check" CHECK ((("path" ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$'::"text") AND ("path" !~~ '%..%'::"text") AND ("path" !~~ '%//%'::"text"))),
    CONSTRAINT "cms_assets_version_check" CHECK (("version" >= 0)),
    CONSTRAINT "cms_assets_width_check" CHECK ((("width" IS NULL) OR ("width" > 0)))
);

ALTER TABLE "public"."cms_assets" OWNER TO "postgres";

COMMENT ON TABLE "public"."cms_assets" IS 'Immutable media registry. During parallel rollout legacy editors remove placements, not retained library bytes. Archive unused files in the studio; garbage collection is a separate reviewed maintenance operation.';

CREATE TABLE IF NOT EXISTS "public"."cms_email_designs" (
    "template" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "design" "jsonb" NOT NULL,
    CONSTRAINT "cms_email_designs_design_check" CHECK ((("jsonb_typeof"("design") = 'object'::"text") AND ("octet_length"(("design")::"text") <= 12000))),
    CONSTRAINT "cms_email_designs_lang_check" CHECK (("lang" = ANY (ARRAY['sv'::"text", 'en'::"text"])))
);

ALTER TABLE "public"."cms_email_designs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cms_revision_media" (
    "revision" bigint NOT NULL,
    "bucket" "text" NOT NULL,
    "path" "text" NOT NULL,
    "reference_count" bigint NOT NULL,
    CONSTRAINT "cms_revision_media_reference_count_check" CHECK (("reference_count" > 0))
);

ALTER TABLE "public"."cms_revision_media" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cms_revisions" (
    "revision" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_id" "uuid",
    "request_id" "uuid",
    "document" "jsonb" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "request_fingerprint" "text",
    CONSTRAINT "cms_revisions_document_check" CHECK ((("jsonb_typeof"("document") = 'object'::"text") AND ("octet_length"(("document")::"text") <= 3145728))),
    CONSTRAINT "cms_revisions_request_fingerprint_check" CHECK (("request_fingerprint" ~ '^[0-9a-f]{32}$'::"text")),
    CONSTRAINT "cms_revisions_revision_check" CHECK (("revision" >= 0)),
    CONSTRAINT "cms_revisions_summary_check" CHECK (("char_length"("summary") <= 160))
);

ALTER TABLE "public"."cms_revisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cms_site" (
    "id" boolean DEFAULT true NOT NULL,
    "revision" bigint DEFAULT 0 NOT NULL,
    "presentation" "jsonb" DEFAULT '{"copy": {}, "pages": [], "images": {}, "styles": {}, "themes": {"dark": {}, "light": {}}, "regions": {}}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cms_site_id_check" CHECK ("id"),
    CONSTRAINT "cms_site_presentation_check" CHECK ((("jsonb_typeof"("presentation") = 'object'::"text") AND ("octet_length"(("presentation")::"text") <= 2097152))),
    CONSTRAINT "cms_site_revision_check" CHECK (("revision" >= 0))
);

ALTER TABLE "public"."cms_site" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_booking_access_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "email" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_booking_access_challenges_email_check" CHECK ((("char_length"("email") >= 3) AND ("char_length"("email") <= 254))),
    CONSTRAINT "customer_booking_access_challenges_phone_check" CHECK (("phone" ~ '^07[0-9]{8}$'::"text")),
    CONSTRAINT "customer_booking_access_challenges_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."customer_booking_access_challenges" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_booking_access_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "email" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_booking_access_sessions_email_check" CHECK ((("char_length"("email") >= 3) AND ("char_length"("email") <= 254))),
    CONSTRAINT "customer_booking_access_sessions_phone_check" CHECK (("phone" ~ '^07[0-9]{8}$'::"text")),
    CONSTRAINT "customer_booking_access_sessions_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."customer_booking_access_sessions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_booking_access_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "token_ciphertext" "text" NOT NULL,
    "generation" bigint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_booking_access_tokens_ciphertext_check" CHECK ((("char_length"("token_ciphertext") BETWEEN 40 AND 700) AND ("token_ciphertext" ~ '^v1\.[A-Za-z0-9_-]+$'::"text"))),
    CONSTRAINT "customer_booking_access_tokens_email_check" CHECK ((("email" = "lower"("btrim"("email"))) AND (("char_length"("email") >= 3) AND ("char_length"("email") <= 254)) AND ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::"text"))),
    CONSTRAINT "customer_booking_access_tokens_generation_check" CHECK (("generation" > 0)),
    CONSTRAINT "customer_booking_access_tokens_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "customer_booking_access_tokens_phone_check" CHECK (("phone" ~ '^07[0-9]{8}$'::"text"))
);

ALTER TABLE "public"."customer_booking_access_tokens" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_booking_receipt_bookings" (
    "receipt_hash" "text" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "parent_email" "text",
    CONSTRAINT "customer_booking_receipt_parent_email_check" CHECK ((("parent_email" IS NULL) OR (("parent_email" = "lower"("btrim"("parent_email"))) AND (("char_length"("parent_email") >= 3) AND ("char_length"("parent_email") <= 254)))))
);

ALTER TABLE "public"."customer_booking_receipt_bookings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_booking_receipts" (
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    CONSTRAINT "customer_booking_receipts_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."customer_booking_receipts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_email_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_email" "text" NOT NULL,
    "target_email" "text" NOT NULL,
    "source_profile" "uuid" NOT NULL,
    "target_profile" "uuid" NOT NULL,
    "source_version" bigint NOT NULL,
    "target_version" bigint NOT NULL,
    "source_generation" bigint NOT NULL,
    "target_generation" bigint NOT NULL,
    "source_hash" "text" NOT NULL,
    "target_hash" "text" NOT NULL,
    "source_ciphertext" "text" NOT NULL,
    "target_ciphertext" "text" NOT NULL,
    "source_verified_at" timestamp with time zone,
    "target_verified_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:30:00'::interval) NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_email_links_check" CHECK ((("source_email" <> "target_email") AND ("source_profile" <> "target_profile") AND ("source_hash" <> "target_hash"))),
    CONSTRAINT "customer_email_links_source_ciphertext_check" CHECK ((("source_ciphertext" ~ '^v1\.[A-Za-z0-9_-]+$'::"text") AND (("length"("source_ciphertext") >= 40) AND ("length"("source_ciphertext") <= 700)))),
    CONSTRAINT "customer_email_links_source_hash_check" CHECK (("source_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "customer_email_links_target_ciphertext_check" CHECK ((("target_ciphertext" ~ '^v1\.[A-Za-z0-9_-]+$'::"text") AND (("length"("target_ciphertext") >= 40) AND ("length"("target_ciphertext") <= 700)))),
    CONSTRAINT "customer_email_links_target_hash_check" CHECK (("target_hash" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."customer_email_links" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_profile_emails" (
    "email" "text" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    CONSTRAINT "customer_profile_emails_email_check" CHECK ((("email" = "lower"("btrim"("email"))) AND (("char_length"("email") >= 3) AND ("char_length"("email") <= 254)) AND ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::"text")))
);

ALTER TABLE "public"."customer_profile_emails" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version" bigint DEFAULT 1 NOT NULL,
    CONSTRAINT "customer_profiles_version_check" CHECK (("version" > 0))
);

ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."email_send_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dedupe_key" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "recipient" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "html" "text" NOT NULL,
    "text_body" "text" NOT NULL,
    "status" "text" NOT NULL,
    "error_code" "text",
    "booking_id" "uuid",
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_send_log_attempt_count_check" CHECK (("attempt_count" >= 1)),
    CONSTRAINT "email_send_log_dedupe_key_check" CHECK (("dedupe_key" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "email_send_log_error_code_check" CHECK (("error_code" = ANY (ARRAY['send_failed_transient'::"text", 'send_failed_permanent'::"text"]))),
    CONSTRAINT "email_send_log_error_matches_status" CHECK ((("status" = 'failed'::"text") = ("error_code" IS NOT NULL))),
    CONSTRAINT "email_send_log_html_check" CHECK (("char_length"("html") <= 500000)),
    CONSTRAINT "email_send_log_kind_check" CHECK (("kind" = ANY (ARRAY['customer_confirmation'::"text", 'barber_confirmation'::"text", 'customer_cancellation'::"text", 'barber_cancellation'::"text", 'customer_reminder'::"text", 'customer_booking_access'::"text", 'customer_email_link'::"text", 'auth_recovery'::"text", 'auth_email_change'::"text", 'auth_invite'::"text"]))),
    CONSTRAINT "email_send_log_recipient_check" CHECK ((("char_length"("recipient") BETWEEN 3 AND 254) AND (POSITION(('@'::"text") IN ("recipient")) > 1))),
    CONSTRAINT "email_send_log_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "email_send_log_subject_check" CHECK ((("char_length"("subject") >= 1) AND ("char_length"("subject") <= 998))),
    CONSTRAINT "email_send_log_text_body_check" CHECK (("char_length"("text_body") <= 100000))
);

ALTER TABLE "public"."email_send_log" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."email_templates" (
    "template" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "preheader" "text" NOT NULL,
    "title" "text" NOT NULL,
    "intro" "text" NOT NULL,
    "section_title" "text",
    "note" "text" NOT NULL,
    "cta_label" "text" NOT NULL,
    "contact_lead" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_templates_contact_len" CHECK ((("contact_lead" IS NULL) OR (("char_length"("contact_lead") >= 1) AND ("char_length"("contact_lead") <= 240)))),
    CONSTRAINT "email_templates_cta_len" CHECK ((("char_length"("cta_label") >= 1) AND ("char_length"("cta_label") <= 80))),
    CONSTRAINT "email_templates_intro_len" CHECK ((("char_length"("intro") >= 1) AND ("char_length"("intro") <= 800))),
    CONSTRAINT "email_templates_lang_check" CHECK (("lang" = ANY (ARRAY['sv'::"text", 'en'::"text"]))),
    CONSTRAINT "email_templates_note_len" CHECK ((("char_length"("note") >= 1) AND ("char_length"("note") <= 800))),
    CONSTRAINT "email_templates_preheader_len" CHECK ((("char_length"("preheader") >= 1) AND ("char_length"("preheader") <= 180))),
    CONSTRAINT "email_templates_section_title_len" CHECK ((("section_title" IS NULL) OR (("char_length"("section_title") >= 1) AND ("char_length"("section_title") <= 120)))),
    CONSTRAINT "email_templates_subject_len" CHECK ((("char_length"("subject") >= 1) AND ("char_length"("subject") <= 120))),
    CONSTRAINT "email_templates_template_check" CHECK (("template" = ANY (ARRAY['customer_confirmation'::"text", 'barber_confirmation'::"text", 'customer_cancellation'::"text", 'barber_cancellation'::"text", 'customer_reminder'::"text", 'customer_booking_access'::"text", 'auth_recovery'::"text", 'auth_email_change'::"text", 'auth_invite'::"text"]))),
    CONSTRAINT "email_templates_title_len" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 120)))
);

ALTER TABLE "public"."email_templates" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."external_action_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action_type" "text" NOT NULL,
    "dedupe_key" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "dispatch_token" "uuid",
    "last_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "external_action_jobs_action_type_check" CHECK (("action_type" = ANY (ARRAY['storage_object_delete'::"text", 'calendar_event_sync'::"text", 'calendar_event_delete'::"text", 'calendar_disconnect'::"text", 'customer_access_email_send'::"text", 'customer_email_link_send'::"text", 'auth_user_access_sync'::"text", 'auth_user_delete'::"text"]))),
    CONSTRAINT "external_action_jobs_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "external_action_jobs_check" CHECK (((("status" = ANY (ARRAY['pending'::"text", 'blocked'::"text"])) AND ("dispatch_token" IS NULL)) OR (("status" = 'dispatching'::"text") AND ("dispatch_token" IS NOT NULL)))),
    CONSTRAINT "external_action_jobs_dedupe_key_check" CHECK ((("char_length"("dedupe_key") >= 1) AND ("char_length"("dedupe_key") <= 300))),
    CONSTRAINT "external_action_jobs_last_error_code_check" CHECK ((("last_error_code" IS NULL) OR ("char_length"("last_error_code") <= 80))),
    CONSTRAINT "external_action_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'dispatching'::"text", 'blocked'::"text"])))
);

ALTER TABLE "public"."external_action_jobs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."gallery_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "alt" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gallery_images_kind_check" CHECK (("kind" = ANY (ARRAY['salon'::"text", 'cuts'::"text"]))),
    CONSTRAINT "gallery_images_storage_path_check" CHECK ((("char_length"("storage_path") >= 1) AND ("char_length"("storage_path") <= 200)))
);

ALTER TABLE "public"."gallery_images" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "barber_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "must_change_password" boolean DEFAULT false NOT NULL,
    "account_enabled" boolean DEFAULT true NOT NULL,
    "auth_sync_version" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'barber'::"text"])))
);

ALTER TABLE "public"."profiles" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."public_action_attempts" (
    "id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "ip_hash" "text" NOT NULL,
    "phone_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_action_attempts_action_check" CHECK (("action" = ANY (ARRAY['lookup'::"text", 'list'::"text", 'cancel'::"text", 'review'::"text", 'request_access'::"text"]))),
    CONSTRAINT "public_action_attempts_ip_hash_check" CHECK (("char_length"("ip_hash") = 64)),
    CONSTRAINT "public_action_attempts_phone_hash_check" CHECK (("char_length"("phone_hash") = 64))
);

ALTER TABLE "public"."public_action_attempts" OWNER TO "postgres";

ALTER TABLE "public"."public_action_attempts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."public_action_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "rating" smallint NOT NULL,
    "text" "text" NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_id" "uuid",
    CONSTRAINT "reviews_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80))),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "reviews_text_check" CHECK ((("char_length"("text") >= 1) AND ("char_length"("text") <= 1000)))
);

ALTER TABLE "public"."reviews" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "barber_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric NOT NULL,
    "duration_min" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "available_weekdays" smallint[] DEFAULT ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint] NOT NULL,
    CONSTRAINT "services_available_weekdays_canonical" CHECK (("available_weekdays" = "public"."canonical_service_weekdays"("available_weekdays"))),
    CONSTRAINT "services_available_weekdays_valid" CHECK ((("cardinality"("available_weekdays") BETWEEN 1 AND 7) AND ("available_weekdays" <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]) AND ("array_position"("available_weekdays", NULL::smallint) IS NULL))),
    CONSTRAINT "services_duration_range" CHECK ((("duration_min" >= 5) AND ("duration_min" <= 600))),
    CONSTRAINT "services_name_len" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80))),
    CONSTRAINT "services_price_range" CHECK ((("price" >= (0)::numeric) AND ("price" <= (100000)::numeric) AND ("price" = "trunc"("price", 2))))
);

ALTER TABLE "public"."services" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."site_content" (
    "key" "text" NOT NULL,
    "lang" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_content_key_len" CHECK ((("char_length"("key") >= 1) AND ("char_length"("key") <= 40))),
    CONSTRAINT "site_content_lang_check" CHECK (("lang" = ANY (ARRAY['sv'::"text", 'en'::"text"]))),
    CONSTRAINT "site_content_value_len" CHECK (("char_length"("value") <= 400))
);

ALTER TABLE "public"."site_content" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."site_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_settings_key_len" CHECK ((("char_length"("key") >= 1) AND ("char_length"("key") <= 40))),
    CONSTRAINT "site_settings_value_len" CHECK (("char_length"("value") <= 500))
);

ALTER TABLE "public"."site_settings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."staff_invitations" (
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_invitations_token_hash_check" CHECK (("token_hash" ~ '^[a-f0-9]{64}$'::"text"))
);

ALTER TABLE "public"."staff_invitations" OWNER TO "postgres";

ALTER TABLE ONLY "public"."booking_attempts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_attempts_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."about_content"
    ADD CONSTRAINT "about_content_pkey" PRIMARY KEY ("key", "lang");

ALTER TABLE ONLY "public"."auth_email_rate_limits"
    ADD CONSTRAINT "auth_email_rate_limits_pkey" PRIMARY KEY ("kind", "scope_hash");

ALTER TABLE ONLY "public"."barber_calendar_tokens"
    ADD CONSTRAINT "barber_calendar_tokens_pkey" PRIMARY KEY ("barber_id");

ALTER TABLE ONLY "public"."barber_photos"
    ADD CONSTRAINT "barber_photos_pkey" PRIMARY KEY ("barber_id");

ALTER TABLE ONLY "public"."barber_recurring_breaks"
    ADD CONSTRAINT "barber_recurring_breaks_barber_id_weekday_int4range_excl" EXCLUDE USING "gist" ("barber_id" WITH =, "weekday" WITH =, "int4range"(("start_min")::integer, ("end_min")::integer, '[)'::"text") WITH &&);

ALTER TABLE ONLY "public"."barber_recurring_breaks"
    ADD CONSTRAINT "barber_recurring_breaks_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."barber_schedules"
    ADD CONSTRAINT "barber_schedules_pkey" PRIMARY KEY ("barber_id", "weekday");

ALTER TABLE ONLY "public"."barber_slot_blocks"
    ADD CONSTRAINT "barber_slot_blocks_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."barber_time_off"
    ADD CONSTRAINT "barber_time_off_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."barbers"
    ADD CONSTRAINT "barbers_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_attempts"
    ADD CONSTRAINT "booking_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_email_delivery_jobs"
    ADD CONSTRAINT "booking_email_delivery_jobs_booking_id_event_key" UNIQUE ("booking_id", "event");

ALTER TABLE ONLY "public"."booking_email_delivery_jobs"
    ADD CONSTRAINT "booking_email_delivery_jobs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_pkey" PRIMARY KEY ("booking_id");

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING "gist" ("barber_id" WITH =, "tstzrange"("start_at", "end_at") WITH &&) WHERE (("status" = 'confirmed'::"text"));

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."calendar_event_map"
    ADD CONSTRAINT "calendar_event_map_pkey" PRIMARY KEY ("booking_id");

ALTER TABLE ONLY "public"."cms_assets"
    ADD CONSTRAINT "cms_assets_bucket_path_key" UNIQUE ("bucket", "path");

ALTER TABLE ONLY "public"."cms_assets"
    ADD CONSTRAINT "cms_assets_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cms_email_designs"
    ADD CONSTRAINT "cms_email_designs_pkey" PRIMARY KEY ("template", "lang");

ALTER TABLE ONLY "public"."cms_revision_media"
    ADD CONSTRAINT "cms_revision_media_pkey" PRIMARY KEY ("revision", "bucket", "path");

ALTER TABLE ONLY "public"."cms_revisions"
    ADD CONSTRAINT "cms_revisions_pkey" PRIMARY KEY ("revision");

ALTER TABLE ONLY "public"."cms_revisions"
    ADD CONSTRAINT "cms_revisions_request_id_key" UNIQUE ("request_id");

ALTER TABLE ONLY "public"."cms_site"
    ADD CONSTRAINT "cms_site_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."customer_booking_access_challenges"
    ADD CONSTRAINT "customer_booking_access_challenges_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."customer_booking_access_challenges"
    ADD CONSTRAINT "customer_booking_access_challenges_token_hash_key" UNIQUE ("token_hash");

ALTER TABLE ONLY "public"."customer_booking_access_sessions"
    ADD CONSTRAINT "customer_booking_access_sessions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."customer_booking_access_sessions"
    ADD CONSTRAINT "customer_booking_access_sessions_token_hash_key" UNIQUE ("token_hash");

ALTER TABLE ONLY "public"."customer_booking_access_tokens"
    ADD CONSTRAINT "customer_booking_access_tokens_email_key" UNIQUE ("email");

ALTER TABLE ONLY "public"."customer_booking_access_tokens"
    ADD CONSTRAINT "customer_booking_access_tokens_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."customer_booking_access_tokens"
    ADD CONSTRAINT "customer_booking_access_tokens_token_hash_key" UNIQUE ("token_hash");

ALTER TABLE ONLY "public"."customer_booking_receipt_bookings"
    ADD CONSTRAINT "customer_booking_receipt_bookings_pkey" PRIMARY KEY ("receipt_hash", "booking_id");

ALTER TABLE ONLY "public"."customer_booking_receipts"
    ADD CONSTRAINT "customer_booking_receipts_pkey" PRIMARY KEY ("token_hash");

ALTER TABLE ONLY "public"."customer_email_links"
    ADD CONSTRAINT "customer_email_links_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."customer_email_links"
    ADD CONSTRAINT "customer_email_links_source_hash_key" UNIQUE ("source_hash");

ALTER TABLE ONLY "public"."customer_email_links"
    ADD CONSTRAINT "customer_email_links_target_hash_key" UNIQUE ("target_hash");

ALTER TABLE ONLY "public"."customer_profile_emails"
    ADD CONSTRAINT "customer_profile_emails_pkey" PRIMARY KEY ("email");

ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."email_send_log"
    ADD CONSTRAINT "email_send_log_dedupe_key_key" UNIQUE ("dedupe_key");

ALTER TABLE ONLY "public"."email_send_log"
    ADD CONSTRAINT "email_send_log_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY ("template", "lang");

ALTER TABLE ONLY "public"."external_action_jobs"
    ADD CONSTRAINT "external_action_jobs_action_type_dedupe_key_key" UNIQUE ("action_type", "dedupe_key");

ALTER TABLE ONLY "public"."external_action_jobs"
    ADD CONSTRAINT "external_action_jobs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."public_action_attempts"
    ADD CONSTRAINT "public_action_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_one_per_booking" UNIQUE ("booking_id");

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_barber_sort_order_key" UNIQUE ("barber_id", "sort_order");

ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."site_content"
    ADD CONSTRAINT "site_content_pkey" PRIMARY KEY ("key", "lang");

ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key");

ALTER TABLE ONLY "public"."barber_slot_blocks"
    ADD CONSTRAINT "slot_block_unique" UNIQUE ("barber_id", "block_date", "start_min", "end_min");

ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("user_id");

ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_token_hash_key" UNIQUE ("token_hash");

CREATE INDEX "barber_recurring_breaks_barber_weekday_start_idx" ON "public"."barber_recurring_breaks" USING "btree" ("barber_id", "weekday", "start_min");

CREATE INDEX "barber_slot_blocks_idx" ON "public"."barber_slot_blocks" USING "btree" ("barber_id", "block_date");

CREATE INDEX "barber_time_off_idx" ON "public"."barber_time_off" USING "btree" ("barber_id", "start_date", "end_date");

CREATE INDEX "barbers_active_idx" ON "public"."barbers" USING "btree" ("sort_order") WHERE "active";

CREATE INDEX "booking_attempts_created_at_idx" ON "public"."booking_attempts" USING "btree" ("created_at");

CREATE INDEX "booking_attempts_ip_time_idx" ON "public"."booking_attempts" USING "btree" ("ip_hash", "created_at");

CREATE INDEX "booking_email_delivery_jobs_dispatch_idx" ON "public"."booking_email_delivery_jobs" USING "btree" ("next_attempt_at", "created_at") WHERE ("status" = 'pending'::"text");

CREATE INDEX "booking_email_delivery_jobs_failed_idx" ON "public"."booking_email_delivery_jobs" USING "btree" ("failed_at", "created_at") WHERE ("status" = 'failed'::"text");

CREATE INDEX "booking_email_delivery_jobs_reclaim_idx" ON "public"."booking_email_delivery_jobs" USING "btree" ("last_attempt_at") WHERE ("status" = 'dispatching'::"text");

CREATE INDEX "booking_reminders_due_idx" ON "public"."booking_reminders" USING "btree" ("due_at") WHERE ("delivered_at" IS NULL);

CREATE INDEX "bookings_barber_time_idx" ON "public"."bookings" USING "btree" ("barber_id", "start_at") WHERE ("status" = 'confirmed'::"text");

CREATE INDEX "bookings_email_idx" ON "public"."bookings" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);

CREATE INDEX "bookings_phone_idx" ON "public"."bookings" USING "btree" ("phone") WHERE ("phone" IS NOT NULL);

CREATE INDEX "calendar_event_map_barber_idx" ON "public"."calendar_event_map" USING "btree" ("barber_id");

CREATE INDEX "calendar_event_map_identity_idx" ON "public"."calendar_event_map" USING "btree" ("barber_id", "calendar_id", "google_event_id");

CREATE INDEX "cms_revision_media_asset" ON "public"."cms_revision_media" USING "btree" ("bucket", "path") INCLUDE ("reference_count");

CREATE INDEX "customer_booking_access_challenges_expiry_idx" ON "public"."customer_booking_access_challenges" USING "btree" ("expires_at");

CREATE INDEX "customer_booking_access_sessions_expiry_idx" ON "public"."customer_booking_access_sessions" USING "btree" ("expires_at");

CREATE INDEX "customer_booking_receipt_booking_idx" ON "public"."customer_booking_receipt_bookings" USING "btree" ("booking_id");

CREATE INDEX "customer_booking_receipts_expiry_idx" ON "public"."customer_booking_receipts" USING "btree" ("expires_at");

CREATE INDEX "customer_email_links_expiry_idx" ON "public"."customer_email_links" USING "btree" ("expires_at");

CREATE INDEX "customer_email_links_source_idx" ON "public"."customer_email_links" USING "btree" ("source_email") WHERE ("used_at" IS NULL);

CREATE INDEX "customer_profile_emails_profile_idx" ON "public"."customer_profile_emails" USING "btree" ("profile_id");

CREATE INDEX "email_send_log_booking_idx" ON "public"."email_send_log" USING "btree" ("booking_id") WHERE ("booking_id" IS NOT NULL);

CREATE INDEX "email_send_log_listing_idx" ON "public"."email_send_log" USING "btree" ("created_at" DESC, "id" DESC);

CREATE INDEX "external_action_jobs_dispatch_idx" ON "public"."external_action_jobs" USING "btree" ("next_attempt_at", "created_at") WHERE ("status" = 'pending'::"text");

CREATE INDEX "external_action_jobs_reclaim_idx" ON "public"."external_action_jobs" USING "btree" ("last_attempt_at") WHERE ("status" = 'dispatching'::"text");

CREATE INDEX "gallery_images_kind_idx" ON "public"."gallery_images" USING "btree" ("kind", "sort_order");

CREATE INDEX "profiles_barber_id_idx" ON "public"."profiles" USING "btree" ("barber_id") WHERE ("barber_id" IS NOT NULL);

CREATE INDEX "profiles_enabled_barber_idx" ON "public"."profiles" USING "btree" ("barber_id") WHERE (("role" = 'barber'::"text") AND ("account_enabled" = true) AND ("barber_id" IS NOT NULL));

CREATE UNIQUE INDEX "profiles_one_account_per_barber_idx" ON "public"."profiles" USING "btree" ("barber_id") WHERE ("barber_id" IS NOT NULL);

CREATE INDEX "public_action_attempts_created_at_idx" ON "public"."public_action_attempts" USING "btree" ("created_at");

CREATE INDEX "public_action_attempts_ip_idx" ON "public"."public_action_attempts" USING "btree" ("action", "ip_hash", "created_at");

CREATE INDEX "public_action_attempts_phone_idx" ON "public"."public_action_attempts" USING "btree" ("action", "phone_hash", "created_at");

CREATE INDEX "reviews_published_idx" ON "public"."reviews" USING "btree" ("created_at" DESC) WHERE "published";

CREATE INDEX "services_barber_active_sort" ON "public"."services" USING "btree" ("barber_id", "active", "sort_order");

CREATE OR REPLACE TRIGGER "barbers_prevent_calendar_cleanup_delete" BEFORE DELETE ON "public"."barbers" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_barber_delete_with_calendar_cleanup"();

CREATE OR REPLACE TRIGGER "booking_calendar_cleanup_on_delete" AFTER DELETE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."queue_booking_calendar_cleanup"();

CREATE OR REPLACE TRIGGER "booking_calendar_cleanup_on_status" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."queue_booking_calendar_cleanup"();

CREATE OR REPLACE TRIGGER "booking_calendar_sync_on_change" AFTER INSERT OR UPDATE OF "status", "barber_id", "service_name", "customer_name", "phone", "email", "start_at", "end_at" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."queue_booking_calendar_sync"();

CREATE OR REPLACE TRIGGER "booking_email_delivery_on_insert" AFTER INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."queue_booking_email_delivery"();

CREATE OR REPLACE TRIGGER "booking_email_delivery_on_status_change" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW WHEN ((("old"."status" = 'confirmed'::"text") AND ("new"."status" = 'cancelled'::"text"))) EXECUTE FUNCTION "public"."queue_booking_email_delivery"();

CREATE OR REPLACE TRIGGER "booking_reminder_on_insert" AFTER INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."queue_booking_reminder_after_insert"();

CREATE OR REPLACE TRIGGER "bookings_customer_email_profile" AFTER INSERT OR UPDATE OF "email" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."assign_booking_customer_profile"();

CREATE OR REPLACE TRIGGER "bookings_prevent_unresolved_email_delete" BEFORE DELETE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_booking_delete_with_unresolved_email"();

CREATE OR REPLACE TRIGGER "cms_revision_media_index" AFTER INSERT OR UPDATE OF "document" ON "public"."cms_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."internal_cms_index_revision_media"();

CREATE OR REPLACE TRIGGER "revoke_disabled_staff_invitation" AFTER UPDATE OF "account_enabled", "role", "barber_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."revoke_disabled_staff_invitation"();

CREATE OR REPLACE TRIGGER "site_settings_normalize_value" BEFORE INSERT OR UPDATE OF "key", "value" ON "public"."site_settings" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_site_setting_value"();

ALTER TABLE ONLY "public"."barber_calendar_tokens"
    ADD CONSTRAINT "barber_calendar_tokens_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."barber_photos"
    ADD CONSTRAINT "barber_photos_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."barber_recurring_breaks"
    ADD CONSTRAINT "barber_recurring_breaks_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."barber_schedules"
    ADD CONSTRAINT "barber_schedules_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."barber_slot_blocks"
    ADD CONSTRAINT "barber_slot_blocks_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."barber_time_off"
    ADD CONSTRAINT "barber_time_off_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."booking_email_delivery_jobs"
    ADD CONSTRAINT "booking_email_delivery_jobs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."calendar_event_map"
    ADD CONSTRAINT "calendar_event_map_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cms_email_designs"
    ADD CONSTRAINT "cms_email_designs_template_lang_fkey" FOREIGN KEY ("template", "lang") REFERENCES "public"."email_templates"("template", "lang") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cms_revision_media"
    ADD CONSTRAINT "cms_revision_media_revision_fkey" FOREIGN KEY ("revision") REFERENCES "public"."cms_revisions"("revision") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cms_revisions"
    ADD CONSTRAINT "cms_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."customer_booking_receipt_bookings"
    ADD CONSTRAINT "customer_booking_receipt_bookings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."customer_booking_receipt_bookings"
    ADD CONSTRAINT "customer_booking_receipt_bookings_receipt_hash_fkey" FOREIGN KEY ("receipt_hash") REFERENCES "public"."customer_booking_receipts"("token_hash") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."customer_email_links"
    ADD CONSTRAINT "customer_email_links_source_email_fkey" FOREIGN KEY ("source_email") REFERENCES "public"."customer_profile_emails"("email");

ALTER TABLE ONLY "public"."customer_email_links"
    ADD CONSTRAINT "customer_email_links_target_email_fkey" FOREIGN KEY ("target_email") REFERENCES "public"."customer_profile_emails"("email");

ALTER TABLE ONLY "public"."customer_profile_emails"
    ADD CONSTRAINT "customer_profile_emails_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."customer_profiles"("id");

ALTER TABLE ONLY "public"."email_send_log"
    ADD CONSTRAINT "email_send_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."staff_invitations"
    ADD CONSTRAINT "staff_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."about_content" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "about_select_all" ON "public"."about_content" FOR SELECT TO "authenticated", "anon" USING (true);

ALTER TABLE "public"."auth_email_rate_limits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."barber_calendar_tokens" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."barber_photos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barber_photos_select_all" ON "public"."barber_photos" FOR SELECT TO "authenticated", "anon" USING (true);

ALTER TABLE "public"."barber_recurring_breaks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."barber_schedules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."barber_slot_blocks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."barber_time_off" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."barbers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barbers_insert_owner" ON "public"."barbers" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_owner"());

CREATE POLICY "barbers_select_active" ON "public"."barbers" FOR SELECT TO "authenticated", "anon" USING (("active" = true));

CREATE POLICY "barbers_select_owner" ON "public"."barbers" FOR SELECT TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "barbers_update_owner" ON "public"."barbers" FOR UPDATE TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

ALTER TABLE "public"."booking_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_email_delivery_jobs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_reminders" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_select_own" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "bookings_select_owner" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."is_owner"());

ALTER TABLE "public"."calendar_event_map" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cms_assets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cms_email_designs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cms_presentation_read" ON "public"."cms_site" FOR SELECT TO "authenticated", "anon" USING (true);

ALTER TABLE "public"."cms_revision_media" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cms_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cms_site" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_booking_access_challenges" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_booking_access_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_booking_access_tokens" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_booking_receipt_bookings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_booking_receipts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_email_links" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_profile_emails" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."email_send_log" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."email_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_templates_select_owner" ON "public"."email_templates" FOR SELECT TO "authenticated" USING ("public"."is_owner"());

ALTER TABLE "public"."external_action_jobs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."gallery_images" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gallery_select_all" ON "public"."gallery_images" FOR SELECT TO "authenticated", "anon" USING (true);

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_owner" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));

ALTER TABLE "public"."public_action_attempts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_breaks_select_owner_or_own" ON "public"."barber_recurring_breaks" FOR SELECT TO "authenticated" USING (("public"."is_owner"() OR ("barber_id" = "public"."current_barber_id"())));

ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_select_published" ON "public"."reviews" FOR SELECT TO "authenticated", "anon" USING (("published" = true));

CREATE POLICY "schedules_delete_own" ON "public"."barber_schedules" FOR DELETE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "schedules_delete_owner" ON "public"."barber_schedules" FOR DELETE TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "schedules_insert_own" ON "public"."barber_schedules" FOR INSERT TO "authenticated" WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "schedules_insert_owner" ON "public"."barber_schedules" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_owner"());

CREATE POLICY "schedules_select_all" ON "public"."barber_schedules" FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "schedules_update_own" ON "public"."barber_schedules" FOR UPDATE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"())) WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "schedules_update_owner" ON "public"."barber_schedules" FOR UPDATE TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services_delete_own" ON "public"."services" FOR DELETE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "services_delete_owner" ON "public"."services" FOR DELETE TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "services_insert_own" ON "public"."services" FOR INSERT TO "authenticated" WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "services_insert_owner" ON "public"."services" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_owner"());

CREATE POLICY "services_select_active" ON "public"."services" FOR SELECT TO "authenticated", "anon" USING (("active" = true));

CREATE POLICY "services_select_own" ON "public"."services" FOR SELECT TO "authenticated" USING (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "services_select_owner" ON "public"."services" FOR SELECT TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "services_update_own" ON "public"."services" FOR UPDATE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"())) WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "services_update_owner" ON "public"."services" FOR UPDATE TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

ALTER TABLE "public"."site_content" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_content_select_all" ON "public"."site_content" FOR SELECT TO "authenticated", "anon" USING (true);

ALTER TABLE "public"."site_settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_settings_delete_owner" ON "public"."site_settings" FOR DELETE TO "authenticated" USING (("public"."is_owner"() AND ("key" = 'cancellation_policy_hours'::"text")));

CREATE POLICY "site_settings_insert_owner" ON "public"."site_settings" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_owner"() AND ("key" = 'cancellation_policy_hours'::"text")));

CREATE POLICY "site_settings_select_all" ON "public"."site_settings" FOR SELECT TO "authenticated", "anon" USING (true);

CREATE POLICY "site_settings_update_owner" ON "public"."site_settings" FOR UPDATE TO "authenticated" USING (("public"."is_owner"() AND ("key" = 'cancellation_policy_hours'::"text"))) WITH CHECK (("public"."is_owner"() AND ("key" = 'cancellation_policy_hours'::"text")));

CREATE POLICY "slot_blocks_delete_own" ON "public"."barber_slot_blocks" FOR DELETE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "slot_blocks_delete_owner" ON "public"."barber_slot_blocks" FOR DELETE TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "slot_blocks_insert_own" ON "public"."barber_slot_blocks" FOR INSERT TO "authenticated" WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "slot_blocks_insert_owner" ON "public"."barber_slot_blocks" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_owner"());

CREATE POLICY "slot_blocks_select_all" ON "public"."barber_slot_blocks" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."staff_invitations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "timeoff_delete_own" ON "public"."barber_time_off" FOR DELETE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "timeoff_delete_owner" ON "public"."barber_time_off" FOR DELETE TO "authenticated" USING ("public"."is_owner"());

CREATE POLICY "timeoff_insert_own" ON "public"."barber_time_off" FOR INSERT TO "authenticated" WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "timeoff_insert_owner" ON "public"."barber_time_off" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_owner"());

CREATE POLICY "timeoff_select_all" ON "public"."barber_time_off" FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "timeoff_update_own" ON "public"."barber_time_off" FOR UPDATE TO "authenticated" USING (("barber_id" = "public"."current_barber_id"())) WITH CHECK (("barber_id" = "public"."current_barber_id"()));

CREATE POLICY "timeoff_update_owner" ON "public"."barber_time_off" FOR UPDATE TO "authenticated" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."barber_schedules";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."barbers";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."services";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."site_content";

ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."site_settings";

-- Tables, sequences and functions above were created with the platform's default grants to the
-- API roles, which differ between platform versions. Clear them, so the grants below are complete.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated", "service_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated", "service_role";
REVOKE ALL ON ALL ROUTINES IN SCHEMA "public" FROM "anon", "authenticated", "service_role";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_add_recurring_break"("p_barber_id" "text", "p_weekday" integer, "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_add_recurring_break"("p_barber_id" "text", "p_weekday" integer, "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_add_slot_block"("p_barber_id" "text", "p_block_date" "date", "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_add_slot_block"("p_barber_id" "text", "p_block_date" "date", "p_start_min" integer, "p_end_min" integer, "p_allow_existing_bookings" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_add_time_off"("p_barber_id" "text", "p_start_date" "date", "p_end_date" "date", "p_reason" "text", "p_allow_existing_bookings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_add_time_off"("p_barber_id" "text", "p_start_date" "date", "p_end_date" "date", "p_reason" "text", "p_allow_existing_bookings" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_cancel_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_booking"("p_booking_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_create_booking"("p_barber_id" "text", "p_start_at" timestamp with time zone, "p_duration_min" integer, "p_service_name" "text", "p_price" numeric, "p_customer_name" "text", "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_booking"("p_barber_id" "text", "p_start_at" timestamp with time zone, "p_duration_min" integer, "p_service_name" "text", "p_price" numeric, "p_customer_name" "text", "p_phone" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_create_service"("p_barber_id" "text", "p_name" "text", "p_price" numeric, "p_duration_min" integer, "p_active" boolean, "p_available_weekdays" smallint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_service"("p_barber_id" "text", "p_name" "text", "p_price" numeric, "p_duration_min" integer, "p_active" boolean, "p_available_weekdays" smallint[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_delete_barber"("p_barber_id" "text", "p_purge_bookings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_barber"("p_barber_id" "text", "p_purge_bookings" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_delete_bookings"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_bookings"("p_ids" "uuid"[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_delete_recurring_break"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_recurring_break"("p_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_delete_service"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_service"("p_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_discard_failed_booking_email_delivery"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_discard_failed_booking_email_delivery"("p_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_get_email_send_log_entry"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_get_email_send_log_entry"("p_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_email_send_log"("p_before" timestamp with time zone, "p_limit" integer, "p_before_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_email_send_log"("p_before" timestamp with time zone, "p_limit" integer, "p_before_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_failed_booking_email_deliveries"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_failed_booking_email_deliveries"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_purge_history"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_purge_history"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_reorder_service"("p_barber_id" "text", "p_service_id" "uuid", "p_direction" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reorder_service"("p_barber_id" "text", "p_service_id" "uuid", "p_direction" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_retry_failed_booking_email_delivery"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_retry_failed_booking_email_delivery"("p_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_save_barber_week"("p_barber_id" "text", "p_week" "jsonb", "p_allow_existing_bookings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_barber_week"("p_barber_id" "text", "p_week" "jsonb", "p_allow_existing_bookings" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_set_barber_account_enabled"("p_barber_id" "text", "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_barber_account_enabled"("p_barber_id" "text", "p_enabled" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."append_customer_booking_receipt"("p_booking_id" "uuid", "p_existing_hash" "text", "p_new_hash" "text", "p_session_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."append_customer_booking_receipt"("p_booking_id" "uuid", "p_existing_hash" "text", "p_new_hash" "text", "p_session_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."assign_booking_customer_profile"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."available_slots"("p_barber_id" "text", "p_date" "date", "p_duration_min" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."available_slots"("p_barber_id" "text", "p_date" "date", "p_duration_min" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."available_slots"("p_barber_id" "text", "p_date" "date", "p_duration_min" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."available_slots_for_service"("p_barber_id" "text", "p_date" "date", "p_service_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."available_slots_for_service"("p_barber_id" "text", "p_date" "date", "p_service_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."available_slots_for_service"("p_barber_id" "text", "p_date" "date", "p_service_id" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."block_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."block_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."booking_confirmation_details"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booking_confirmation_details"("p_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."booking_email_delivery_for_dispatch"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."booking_email_delivery_for_dispatch"("p_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_authorization_owner_for_job"("p_action_type" "text", "p_payload" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."calendar_backfill_source"("p_barber_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_backfill_source"("p_barber_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_connection_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_connection_status"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."calendar_delete_token"("p_barber_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_delete_token"("p_barber_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_forget_event_if_matches"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_forget_event_if_matches"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_queue_event_deletion_for_identity"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_queue_event_deletion_for_identity"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_record_error"("p_barber_id" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_record_error"("p_barber_id" "text", "p_error" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_record_event_if_current"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_record_event_if_current"("p_booking_id" "uuid", "p_barber_id" "text", "p_calendar_id" "text", "p_google_event_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_store_token"("p_barber_id" "text", "p_refresh_token" "text", "p_google_email" "text", "p_calendar_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_store_token"("p_barber_id" "text", "p_refresh_token" "text", "p_google_email" "text", "p_calendar_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."calendar_sync_source"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calendar_sync_source"("p_booking_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_customer_booking_for_browser"("p_booking_id" "uuid", "p_session_hash" "text", "p_receipt_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_customer_booking_for_browser"("p_booking_id" "uuid", "p_session_hash" "text", "p_receipt_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_customer_booking_with_access"("p_booking_id" "uuid", "p_session_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_customer_booking_with_access"("p_booking_id" "uuid", "p_session_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_external_action"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_external_action"("p_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."cleanup_customer_access_email_actions"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."cleanup_customer_booking_access"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."complete_booking_email_delivery"("p_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_booking_email_delivery"("p_id" "uuid", "p_status" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_external_action"("p_id" "uuid", "p_dispatch_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_external_action"("p_id" "uuid", "p_dispatch_token" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."confirm_customer_email_link"("p_session_hash" "text", "p_code_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_customer_email_link"("p_session_hash" "text", "p_code_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."consume_auth_email_send"("p_kind" "text", "p_scope_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_auth_email_send"("p_kind" "text", "p_scope_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."consume_customer_access_email_challenge"("p_challenge_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_customer_access_email_challenge"("p_challenge_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."consume_public_action_attempt"("p_action" "text", "p_ip_hash" "text", "p_phone_hash" "text", "p_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_public_action_attempt"("p_action" "text", "p_ip_hash" "text", "p_phone_hash" "text", "p_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."consume_staff_invitation"("p_token_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_staff_invitation"("p_token_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_booking"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_booking"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_booking_with_limits"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text", "p_ip_hash" "text", "p_ip_window_secs" integer, "p_phone_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_booking_with_limits"("p_barber_id" "text", "p_service_id" "text", "p_start_at" timestamp with time zone, "p_phone" "text", "p_email" "text", "p_lang" "text", "p_customer_name" "text", "p_ip_hash" "text", "p_ip_window_secs" integer, "p_phone_window_secs" integer, "p_ip_limit" integer, "p_phone_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_review_for_browser"("p_session_hash" "text", "p_receipt_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_review_for_browser"("p_session_hash" "text", "p_receipt_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_review_with_access"("p_session_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_review_with_access"("p_session_hash" "text", "p_phone" "text", "p_rating" integer, "p_text" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."current_barber_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_barber_id"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."current_role"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."customer_booking_access_scope"("p_session_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."customer_booking_access_scope"("p_session_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."customer_device_booking_ids"("p_receipt_hash" "text", "p_parent_email" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."customer_profile_emails_for_email"("p_email" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."email_template_for_delivery"("p_template" "text", "p_lang" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."email_template_for_delivery"("p_template" "text", "p_lang" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."ensure_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."ensure_customer_email_profile"("p_email" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."establish_customer_booking_session"("p_access_token" "text", "p_session_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."establish_customer_booking_session"("p_access_token" "text", "p_session_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."exchange_customer_booking_access"("p_challenge_hash" "text", "p_session_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."exchange_customer_booking_access"("p_challenge_hash" "text", "p_session_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."external_action_for_dispatch"("p_id" "uuid", "p_dispatch_token" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."fail_booking_email_delivery"("p_id" "uuid", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_booking_email_delivery"("p_id" "uuid", "p_error_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."fail_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_external_action"("p_id" "uuid", "p_dispatch_token" "uuid", "p_error_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."forget_customer_booking_receipt"("p_receipt_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forget_customer_booking_receipt"("p_receipt_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_assert_media_publishable"("p_document" "jsonb", "p_head" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."internal_cms_assert_owner"("p_actor" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_assert_owner"("p_actor" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_asset_delete_abort"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_asset_delete_abort"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_asset_delete_finalize"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_asset_delete_finalize"("p_actor" "uuid", "p_id" "uuid", "p_version" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_asset_transition"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_asset_transition"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_action" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_asset_update"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_name" "text", "p_alt" "text", "p_archived" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_asset_update"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_name" "text", "p_alt" "text", "p_archived" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_asset_usage"("p_actor" "uuid", "p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_asset_usage"("p_actor" "uuid", "p_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_check_media"("p_actor" "uuid", "p_document" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_check_media"("p_actor" "uuid", "p_document" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_document"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_document"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_document_media_placements"("p_document" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."internal_cms_history"("p_actor" "uuid", "p_before" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_history"("p_actor" "uuid", "p_before" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_index_revision_media"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."internal_cms_media_retained"("p_bucket" "text", "p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_media_retained"("p_bucket" "text", "p_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_missing_media"("p_actor" "uuid", "p_references" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_missing_media"("p_actor" "uuid", "p_references" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_newly_placed_media"("p_document" "jsonb", "p_head" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."internal_cms_publish"("p_actor" "uuid", "p_document" "jsonb", "p_base_revision" bigint, "p_base_fingerprint" "text", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_publish"("p_actor" "uuid", "p_document" "jsonb", "p_base_revision" bigint, "p_base_fingerprint" "text", "p_request_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_register_storage_object"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."internal_cms_revision"("p_actor" "uuid", "p_revision" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_revision"("p_actor" "uuid", "p_revision" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_cms_state"("p_actor" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_cms_state"("p_actor" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_delete_barber_photo"("p_barber_id" "text", "p_expected_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_delete_barber_photo"("p_barber_id" "text", "p_expected_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_delete_gallery_image"("p_id" "uuid", "p_expected_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_delete_gallery_image"("p_id" "uuid", "p_expected_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_insert_gallery_image"("p_kind" "text", "p_storage_path" "text", "p_alt" "text", "p_sort_order" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_insert_gallery_image"("p_kind" "text", "p_storage_path" "text", "p_alt" "text", "p_sort_order" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_purge_email_send_log"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."internal_queue_auth_user_delete"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_queue_auth_user_delete"("p_user_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_record_email_send"("p_dedupe_key" "text", "p_kind" "text", "p_recipient" "text", "p_subject" "text", "p_html" "text", "p_text_body" "text", "p_status" "text", "p_error_code" "text", "p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_record_email_send"("p_dedupe_key" "text", "p_kind" "text", "p_recipient" "text", "p_subject" "text", "p_html" "text", "p_text_body" "text", "p_status" "text", "p_error_code" "text", "p_booking_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_remove_homepage_logo"("p_expected_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_remove_homepage_logo"("p_expected_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_replace_barber_photo"("p_barber_id" "text", "p_expected_path" "text", "p_new_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_replace_barber_photo"("p_barber_id" "text", "p_expected_path" "text", "p_new_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."internal_replace_homepage_logo"("p_expected_path" "text", "p_new_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."internal_replace_homepage_logo"("p_expected_path" "text", "p_new_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_owner"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_owner"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_customer_bookings_for_browser"("p_session_hash" "text", "p_receipt_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_customer_bookings_for_browser"("p_session_hash" "text", "p_receipt_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_customer_bookings_with_access"("p_session_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_customer_bookings_with_access"("p_session_hash" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."lock_customer_access_emails"("p_emails" "text"[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."mark_booking_email_delivery_recipient"("p_id" "uuid", "p_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_booking_email_delivery_recipient"("p_id" "uuid", "p_kind" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."mark_booking_reminder_delivered"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_booking_reminder_delivered"("p_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."normalize_site_setting_value"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."prepare_calendar_disconnect"("p_barber_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_calendar_disconnect"("p_barber_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."prevent_barber_delete_with_calendar_cleanup"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."prevent_booking_delete_with_unresolved_email"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."prune_cms_revisions"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."public_booking_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_booking_catalog"() TO "anon";
GRANT ALL ON FUNCTION "public"."public_booking_catalog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_booking_catalog"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."public_business_discovery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_business_discovery"() TO "anon";
GRANT ALL ON FUNCTION "public"."public_business_discovery"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_business_discovery"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."public_cms_page"("p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_cms_page"("p_path" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."public_cms_page"("p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_cms_page"("p_path" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."public_cms_page_metadata"("p_path" "text", "p_lang" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_cms_page_metadata"("p_path" "text", "p_lang" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."public_cms_page_metadata"("p_path" "text", "p_lang" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_cms_page_metadata"("p_path" "text", "p_lang" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."public_cms_presentation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_cms_presentation"() TO "anon";
GRANT ALL ON FUNCTION "public"."public_cms_presentation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_cms_presentation"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."queue_booking_calendar_cleanup"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_booking_calendar_sync"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_booking_email_delivery"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_booking_reminder_after_insert"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_calendar_event_deletion"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_calendar_event_deletion"("p_booking_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."queue_calendar_event_sync"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_calendar_event_sync"("p_booking_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."queue_due_booking_email_deliveries"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_due_booking_reminders"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_due_external_actions"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_external_action"("p_action_type" "text", "p_dedupe_key" "text", "p_payload" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_orphaned_storage_objects"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."queue_storage_deletion"("p_bucket" "text", "p_object_path" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."replace_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_expected_generation" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_customer_booking_access_token"("p_email" "text", "p_phone" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_expected_generation" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."request_customer_email_link"("p_session_hash" "text", "p_target_email" "text", "p_source_hash" "text", "p_target_hash" "text", "p_source_ciphertext" "text", "p_target_ciphertext" "text", "p_lang" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_customer_email_link"("p_session_hash" "text", "p_target_email" "text", "p_source_hash" "text", "p_target_hash" "text", "p_source_ciphertext" "text", "p_target_ciphertext" "text", "p_lang" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."revoke_disabled_staff_invitation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."rotate_customer_booking_access_token"("p_email" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_access_code" "text", "p_lang" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rotate_customer_booking_access_token"("p_email" "text", "p_token_hash" "text", "p_token_ciphertext" "text", "p_access_code" "text", "p_lang" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_own_password_changed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_own_password_changed"() TO "authenticated";

GRANT SELECT,MAINTAIN ON TABLE "public"."about_content" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."about_content" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."about_content" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."auth_email_rate_limits" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."barber_calendar_tokens" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."barber_photos" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."barber_photos" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."barber_photos" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."barber_recurring_breaks" TO "service_role";
GRANT SELECT ON TABLE "public"."barber_recurring_breaks" TO "authenticated";

GRANT SELECT,MAINTAIN ON TABLE "public"."barber_schedules" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."barber_schedules" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."barber_schedules" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."barber_slot_blocks" TO "anon";
GRANT SELECT,DELETE,MAINTAIN ON TABLE "public"."barber_slot_blocks" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."barber_slot_blocks" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."barber_time_off" TO "anon";
GRANT SELECT,DELETE,MAINTAIN ON TABLE "public"."barber_time_off" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."barber_time_off" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."barbers" TO "anon";
GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."barbers" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."barbers" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."barbers" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."booking_attempts" TO "anon";
GRANT MAINTAIN ON TABLE "public"."booking_attempts" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."booking_attempts" TO "service_role";

GRANT UPDATE ON SEQUENCE "public"."booking_attempts_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."booking_attempts_id_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."booking_attempts_id_seq" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."bookings" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."bookings" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."calendar_event_map" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."cms_assets" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."cms_email_designs" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."cms_revisions" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."cms_site" TO "service_role";
GRANT SELECT ON TABLE "public"."cms_site" TO "anon";
GRANT SELECT ON TABLE "public"."cms_site" TO "authenticated";

GRANT MAINTAIN ON TABLE "public"."email_templates" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."email_templates" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."email_templates" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."gallery_images" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."gallery_images" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."gallery_images" TO "service_role";

GRANT MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."profiles" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."reviews" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."reviews" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."reviews" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."services" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."services" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."services" TO "service_role";

GRANT UPDATE("name") ON TABLE "public"."services" TO "authenticated";

GRANT UPDATE("price") ON TABLE "public"."services" TO "authenticated";

GRANT UPDATE("duration_min") ON TABLE "public"."services" TO "authenticated";

GRANT UPDATE("active") ON TABLE "public"."services" TO "authenticated";

GRANT UPDATE("available_weekdays") ON TABLE "public"."services" TO "authenticated";

GRANT SELECT,MAINTAIN ON TABLE "public"."site_content" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."site_content" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."site_content" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."site_settings" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."site_settings" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."site_settings" TO "service_role";

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."staff_invitations" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE TRUNCATE,REFERENCES,TRIGGER ON TABLES FROM PUBLIC, "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN ON TABLES TO "service_role";

--
-- Rows the application expects to exist
--

-- Scheduled jobs.
SELECT cron.schedule('booking-reminder-dispatch', '* * * * *', 'select public.queue_due_booking_reminders()');
SELECT cron.schedule('booking-attempt-cleanup', '23 * * * *', 'delete from public.booking_attempts
    where created_at < pg_catalog.now() - interval ''2 days''');
SELECT cron.schedule('booking-email-delivery-dispatch', '* * * * *', 'select public.queue_due_booking_email_deliveries()');
SELECT cron.schedule('external-action-dispatch', '* * * * *', 'select public.queue_due_external_actions()');
SELECT cron.schedule('customer-booking-access-cleanup', '23 3 * * *', 'select public.cleanup_customer_booking_access()');
SELECT cron.schedule('booking-email-delivery-cleanup', '17 3 * * *', 'delete from public.booking_email_delivery_jobs
    where status in (''delivered'', ''skipped'', ''superseded'')
      and completed_at < pg_catalog.now() - interval ''90 days''');
SELECT cron.schedule('customer-access-email-action-cleanup', '*/10 * * * *', 'select public.cleanup_customer_access_email_actions()');
SELECT cron.schedule('storage-orphan-reconcile', '53 3 * * *', 'select public.queue_orphaned_storage_objects()');
SELECT cron.schedule('cron-job-run-details-purge', '47 3 * * *', 'delete from cron.job_run_details where end_time < pg_catalog.now() - interval ''7 days''');
SELECT cron.schedule('cms-revision-prune', '37 3 * * *', 'select public.prune_cms_revisions()');
SELECT cron.schedule('email-send-log-purge', '29 3 * * *', 'select public.internal_purge_email_send_log()');

-- Storage buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('barber-photos', 'barber-photos', true, 512000, '{image/webp}');
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('cms-library', 'cms-library', true, 5242880, '{image/webp,font/woff2}');
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('gallery', 'gallery', true, 512000, '{image/webp}');

-- Default rows.
INSERT INTO public.site_settings (key, value) VALUES ('business_city', 'Göteborg');
INSERT INTO public.site_settings (key, value) VALUES ('business_email', 'booking@mail.bladeblendstudio.se');
INSERT INTO public.site_settings (key, value) VALUES ('business_legal_name', '');
INSERT INTO public.site_settings (key, value) VALUES ('business_maps_href', 'https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg');
INSERT INTO public.site_settings (key, value) VALUES ('business_name', 'Blade & Blend Studio');
INSERT INTO public.site_settings (key, value) VALUES ('business_org_number', '');
INSERT INTO public.site_settings (key, value) VALUES ('business_phone_display', '079‑304 36 71');
INSERT INTO public.site_settings (key, value) VALUES ('business_phone_tel', '0793043671');
INSERT INTO public.site_settings (key, value) VALUES ('business_postal_code', '411 34');
INSERT INTO public.site_settings (key, value) VALUES ('business_street', 'Geijersgatan 10');
INSERT INTO public.site_settings (key, value) VALUES ('cancellation_policy_hours', '24');
INSERT INTO public.site_settings (key, value) VALUES ('homepage_logo_path', '');
INSERT INTO public.site_settings (key, value) VALUES ('homepage_logo_scale', 'md');
INSERT INTO public.site_settings (key, value) VALUES ('homepage_logo_style', 'classic');
INSERT INTO public.site_settings (key, value) VALUES ('seo_description_en', '{business_name} is a barbershop in {city}. Choose a barber, service, and time and book online.');
INSERT INTO public.site_settings (key, value) VALUES ('seo_description_sv', '{business_name} är en barbershop i {city}. Välj barberare, behandling och tid och boka online.');
INSERT INTO public.site_settings (key, value) VALUES ('seo_title_en', '{business_name} – Barbershop in {city} | Book online');
INSERT INTO public.site_settings (key, value) VALUES ('seo_title_sv', '{business_name} – Barbershop i {city} | Boka tid online');
INSERT INTO public.site_content (key, lang, value) VALUES ('confirmSent', 'en', 'A booking confirmation has been sent to {email}. Manage the booking with a secure link under "My appointments".');
INSERT INTO public.site_content (key, lang, value) VALUES ('confirmSent', 'sv', 'En bokningsbekräftelse har skickats till {email}. Hantera bokningen via en säker länk under "Mina bokningar".');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('auth_email_change', 'en', 'Confirm new email address', 'Confirm your new email address.', 'Confirm your new email address', 'Confirm {new_email} as the new email address for your account.', NULL, 'The link is valid for 60 minutes and can only be used once. Ignore this email if you did not request the change.', 'Confirm email address', 'Need help? Call us on');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('auth_email_change', 'sv', 'Bekräfta ny e-postadress', 'Bekräfta din nya e-postadress.', 'Bekräfta din nya e-postadress', 'Bekräfta {new_email} som ny e-postadress för ditt konto.', NULL, 'Länken gäller i 60 minuter och kan bara användas en gång. Ignorera mejlet om du inte begärde ändringen.', 'Bekräfta e-postadress', 'Behöver du hjälp? Kontakta oss på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('auth_invite', 'en', 'Your invitation to {business_name}', 'Create your personal password and activate the account.', 'Welcome to the team', 'You have been invited to the barber panel at {business_name}.', NULL, 'The link can only be used once.', 'Create my password', 'Need help? Call us on');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('auth_invite', 'sv', 'Din inbjudan till {business_name}', 'Skapa ditt personliga lösenord och aktivera kontot.', 'Välkommen till teamet', 'Du har blivit inbjuden till barberarpanelen hos {business_name}.', NULL, 'Länken kan bara användas en gång.', 'Skapa mitt lösenord', 'Behöver du hjälp? Kontakta oss på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('auth_recovery', 'en', 'Reset password', 'Choose a new password for your account.', 'Reset your password', 'We received a request to reset the password for your account.', NULL, 'The link is valid for 60 minutes. Ignore this email if you did not request the reset.', 'Choose new password', 'Need help? Call us on');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('auth_recovery', 'sv', 'Återställ lösenord', 'Välj ett nytt lösenord till ditt konto.', 'Återställ ditt lösenord', 'Vi har fått en begäran om att återställa lösenordet för ditt konto.', NULL, 'Länken gäller i 60 minuter. Om du inte begärde återställningen kan du ignorera mejlet.', 'Välj nytt lösenord', 'Behöver du hjälp? Kontakta oss på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('barber_cancellation', 'sv', 'Avbokad tid', 'Avbokad tid {booking_date} {booking_time}.', 'En tid har avbokats', '{customer_name}s tid hos {barber_name} har avbokats.', 'Avbokningsuppgifter', 'Tiden har tagits bort från kommande bokningar.', 'Öppna adminpanelen', 'Vid frågor, kontakta studion på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('barber_confirmation', 'sv', 'Ny bokning', 'Ny bokning {booking_date} {booking_time}.', 'En ny tid är bokad', '{customer_name} har bokat en tid hos {barber_name}.', 'Bokningsuppgifter', 'Bokningen finns i adminpanelen tillsammans med kundens kontaktuppgifter.', 'Öppna adminpanelen', 'Vid frågor, kontakta studion på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_booking_access', 'en', 'Open My appointments', 'Open your secure My appointments link.', 'Open My appointments', 'Use the link to view and manage your booked appointments.', NULL, 'This link remains valid until you request a new one. The previous link then stops working.', 'Open My appointments', 'Ignore this email if you did not request the link.');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_booking_access', 'sv', 'Öppna Mina bokningar', 'Öppna din säkra länk till Mina bokningar.', 'Öppna Mina bokningar', 'Använd länken för att se och hantera dina bokade tider.', NULL, 'Länken gäller tills du begär en ny. Då slutar den tidigare länken att fungera.', 'Öppna Mina bokningar', 'Om du inte begärde länken kan du ignorera detta mejl.');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_cancellation', 'en', 'Cancellation confirmation', 'Your appointment with {barber_name} is cancelled.', 'Your appointment is cancelled', 'Hi {customer_name},
Your cancellation is confirmed.', 'Your cancelled appointment', 'The appointment is no longer active under "My appointments".', 'Book a new appointment', 'Questions? Call us on');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_cancellation', 'sv', 'Avbokningsbekräftelse', 'Din tid hos {barber_name} är avbokad.', 'Din tid är avbokad', 'Hej {customer_name},
Din avbokning är bekräftad.', 'Din avbokade tid', 'Tiden är inte längre aktiv under "Mina bokningar".', 'Boka en ny tid', 'Om du har frågor, kontakta oss på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_confirmation', 'en', 'Booking confirmation', 'Your appointment with {barber_name} is confirmed.', 'Your appointment is confirmed', 'Hi {customer_name},
Thank you for your booking. You are warmly welcome to visit us!', 'Your appointment', 'Follow your appointment under "My appointments". Cancellation policy: {cancellation_hours} hours.', 'My appointments', 'Questions? Call us on');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_confirmation', 'sv', 'Bokningsbekräftelse', 'Din tid hos {barber_name} är bokad.', 'Din tid är bokad', 'Hej {customer_name},
Tack för din bokning, du är varmt välkommen till oss!', 'Din bokade tid', 'Din tid kan följas under "Mina bokningar", avbokningsvillkor {cancellation_hours}h.', 'Mina bokningar', 'Om du har frågor, kontakta oss på');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_reminder', 'en', 'Appointment reminder', 'Your appointment with {barber_name} is tomorrow.', 'See you tomorrow', 'Hi {customer_name},
This is a reminder about your appointment tomorrow.', 'Your appointment', 'Need to cancel? Open "My appointments". Cancellation policy: {cancellation_hours} hours.', 'My appointments', 'Questions? Call us on');
INSERT INTO public.email_templates (template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead) VALUES ('customer_reminder', 'sv', 'Påminnelse inför din bokning', 'Din tid hos {barber_name} är i morgon.', 'Vi ses i morgon', 'Hej {customer_name},
Detta är en påminnelse om din bokade tid i morgon.', 'Din bokade tid', 'Behöver du avboka? Öppna "Mina bokningar". Avbokningsvillkor {cancellation_hours}h.', 'Mina bokningar', 'Om du har frågor, kontakta oss på');
INSERT INTO public.cms_site (id, revision, presentation) VALUES (true, 0, '{"copy": {}, "pages": [], "images": {}, "styles": {}, "themes": {"dark": {}, "light": {}}, "regions": {}}');

--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "cms_register_uploaded_object" AFTER INSERT ON "storage"."objects" FOR EACH ROW EXECUTE FUNCTION "public"."internal_cms_register_storage_object"();

CREATE POLICY "barber_photos_public_read" ON "storage"."objects" FOR SELECT TO "authenticated", "anon" USING (("bucket_id" = 'barber-photos'::"text"));

CREATE POLICY "gallery_public_read" ON "storage"."objects" FOR SELECT TO "authenticated", "anon" USING (("bucket_id" = 'gallery'::"text"));

-- The settings at the top of this file are for this file only.
RESET ALL;
