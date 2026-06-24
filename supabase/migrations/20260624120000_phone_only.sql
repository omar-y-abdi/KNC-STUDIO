-- Migration 0011 — phone-only contact surface (PLAN §1).
--
-- WHY: email is being removed from the app + RPC surface. The bookings.email / bookings.method
-- COLUMNS stay (nullable, dormant) to avoid a destructive column drop on a frozen schema, but every
-- NEW booking is now method='sms', email=null. The booking insert also moves BEHIND the
-- `submit-booking` edge function (PLAN §3, server-side Turnstile + rate limits), so the public browser
-- (anon) no longer calls create_booking directly — only the edge fn does, via service_role.
--
-- This migration:
--   1. DROPs the 11-arg create_booking (0003/0010) and CREATEs a 9-arg version (no p_method/p_email).
--      Body is COPIED from 0010 EXACTLY, preserving every branch (past-time -> invalid_time;
--      barber-exists -> invalid; H1 schedule gate -> outside_hours; time-off -> outside_hours;
--      exclusion -> slot_taken; check -> invalid; FK -> invalid). The only changes: the method/contact
--      pairing collapses to a single `p_phone is null or p_phone = ''` -> invalid_contact guard, and the
--      insert hardcodes method='sms', phone=p_phone, email=null. EXECUTE is revoked from PUBLIC (so anon
--      cannot reach it) and granted ONLY to service_role (the edge fn's credential).
--   2. DROPs the 2-arg lookup_booking and CREATEs a 1-arg version matching phone only (method literal 'sms').
--   3. REPLACEs cancel_booking (same signature) to match phone only (drops the email arm). Returns 'sms'.
--
-- Frozen migrations 0001..0010 are NOT edited.

-- ===============================================================================================
-- 1. create_booking — 9-arg, phone-only, service_role-only.
-- ===============================================================================================
-- Drop the 11-arg signature (0003 created it, 0010 replaced the body). A DROP+CREATE with a new
-- signature yields a brand-new function object, so its grants reset to the Postgres default (EXECUTE
-- to PUBLIC) — we re-lock them explicitly below.
drop function if exists public.create_booking(
  text, text, text, int, int, timestamptz, text, text, text, text, text
);

create or replace function public.create_booking(
  p_barber_id     text,
  p_service_id    text,
  p_service_name  text,
  p_price         int,
  p_duration_min  int,
  p_start_at      timestamptz,
  p_phone         text,
  p_lang          text,
  p_customer_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end_at    timestamptz;
  v_row       public.bookings;
  -- The booking's Europe/Stockholm wall-clock, derived from the stored instant (matches available_slots).
  v_local_ts  timestamp;   -- naive local timestamp in salon tz
  v_weekday   int;         -- 0=Sun..6=Sat (extract(dow ...)), to match barber_schedules + the front end
  v_slot_min  int;         -- minutes since local midnight (the slot's start_min)
begin
  -- Reject past (or now) start times. (unchanged from 0010)
  if p_start_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  -- Contact guard (defense in depth). Email is gone; the only channel is sms, which needs a phone.
  -- The `submit-booking` gateway already requires a phone, but a direct service_role caller might not,
  -- so we keep this guard and map a missing phone to the same `invalid_contact` Result 0010 produced.
  if p_phone is null or p_phone = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- Unknown barber -> `invalid` (M1). This MUST precede the schedule gate below: an unknown barber
  -- has no barber_schedules row, so the working-hours `not exists` check would otherwise mask the
  -- bad-id case as `outside_hours`. A missing/removed barber is an invalid INPUT, not a scheduling
  -- outcome, so we classify it here. (The FK-violation arm in the INSERT remains as defense in depth
  -- for a barber deleted concurrently between this check and the insert.) (unchanged from 0010)
  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- H1: server-side schedule enforcement. Reject a booking that is on a non-working weekday, inside
  -- a time-off range, or whose [slot, slot+duration] window falls outside the barber's working hours.
  -- The instant -> Stockholm wall-clock conversion mirrors available_slots(0006) EXACTLY so the read
  -- (availability) and write (this insert) agree on every boundary slot, DST included. (unchanged from 0010)
  -- ---------------------------------------------------------------------------------------------
  v_local_ts := p_start_at at time zone 'Europe/Stockholm';            -- instant -> salon wall-clock
  v_weekday  := pg_catalog.date_part('dow',  v_local_ts)::int;          -- 0=Sun..6=Sat
  v_slot_min := pg_catalog.date_part('hour', v_local_ts)::int * 60
              + pg_catalog.date_part('minute', v_local_ts)::int;        -- minutes since local midnight

  -- (a) must be a working weekday AND the [slot, slot+duration] window must fit within working hours.
  --     `<=` on the end so a slot ending exactly at end_min fits (same as available_slots).
  if not exists (
    select 1
    from public.barber_schedules s
    where s.barber_id = p_barber_id
      and s.working = true
      and s.weekday = v_weekday
      and v_slot_min >= s.start_min
      and v_slot_min + p_duration_min <= s.end_min
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  -- (b) must NOT fall inside any time-off range for this barber (inclusive dates, salon-local day).
  if exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and v_local_ts::date between t.start_date and t.end_date
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  v_end_at := p_start_at + pg_catalog.make_interval(mins => p_duration_min);

  begin
    insert into public.bookings (
      barber_id, service_id, service_name, price, duration_min,
      start_at, end_at, customer_name, method, phone, email, lang
    ) values (
      p_barber_id, p_service_id, p_service_name, p_price, p_duration_min,
      p_start_at, v_end_at, p_customer_name,
      -- email is removed: every booking is sms, the phone is the contact, email is null.
      'sms', p_phone, null,
      p_lang
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      -- SQLSTATE 23P01: another CONFIRMED booking already overlaps this barber+time.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation then
      -- SQLSTATE 23514: a column CHECK failed (e.g. a malformed phone from a direct service_role
      -- caller bypassing the gateway's validation). Return a clean Result, not a raw DB error.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
    when foreign_key_violation then
      -- SQLSTATE 23503: barber_id does not reference a barbers row (defense in depth for a barber
      -- deleted concurrently between the check above and this insert). Map to the same `invalid` Result.
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
      'method',       v_row.method,   -- always 'sms' now
      'lang',         v_row.lang
    )
  );
end;
$$;

-- Least privilege. The 9-arg function is a NEW object (PUBLIC has the default EXECUTE), so we strip
-- PUBLIC (this is what actually denies anon — anon only ever reached create_booking via a direct grant
-- in 0003, which no longer exists for this signature) and also revoke anon explicitly for clarity.
-- Only the `submit-booking` edge function, authenticating as service_role, may call it now.
revoke execute on function public.create_booking(
  text, text, text, int, int, timestamptz, text, text, text
) from public;
revoke execute on function public.create_booking(
  text, text, text, int, int, timestamptz, text, text, text
) from anon;
grant execute on function public.create_booking(
  text, text, text, int, int, timestamptz, text, text, text
) to service_role;

-- ===============================================================================================
-- 2. lookup_booking — 1-arg, phone-only.
-- ===============================================================================================
-- Drop the 2-arg (p_contact, p_method) signature and create a phone-only 1-arg version. Email is no
-- longer a lookup channel, so the method param is gone; the returned `method` is the literal 'sms'.
drop function if exists public.lookup_booking(text, text);

create or replace function public.lookup_booking(
  p_contact text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bookings;
begin
  select * into v_row
  from public.bookings b
  where b.status = 'confirmed'
    and b.start_at > pg_catalog.now()
    and b.phone = p_contact
  order by b.start_at asc
  limit 1;

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
      'method',       'sms',
      'contact',      p_contact
    )
  );
end;
$$;

-- The 1-arg signature is a NEW object; lock it down to anon (the public booking flow's lookup is still
-- browser-callable — it only ever returns the caller's OWN row, matched on the exact proven phone).
revoke execute on function public.lookup_booking(text) from public;
grant  execute on function public.lookup_booking(text) to anon;

-- ===============================================================================================
-- 3. cancel_booking — same (uuid, text) signature, phone-only match.
-- ===============================================================================================
-- Signature is unchanged, so the existing 0003 grants (revoke from public, grant to anon) carry over
-- to this replaced body — no re-grant needed. Only the WHERE changes: drop the `lower(email)=...` arm
-- so a booking is cancellable solely by its proven phone. Returns method literal 'sms'.
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_contact    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bookings;
begin
  update public.bookings b
  set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id
    and b.status = 'confirmed'
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
      'method',       'sms',
      'contact',      p_contact
    )
  );
end;
$$;
