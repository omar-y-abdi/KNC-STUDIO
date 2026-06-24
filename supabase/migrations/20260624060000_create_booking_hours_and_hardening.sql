-- Migration 0010 — create_booking hardening: server-side working-hours/schedule enforcement (H1),
-- foreign-key-violation handling (M1), and dropping the now-dead public taken_slots grant (L2).
--
-- WHY: the original create_booking (0003) validated only past-time + contact pairing, then inserted.
-- The schedule rules (working weekday, within [start_min,end_min], not on time-off) lived ONLY in the
-- advisory `available_slots` RPC, which drives the UI grey-out. Because create_booking is granted to
-- anon (the public browser credential), a direct caller could book OUTSIDE working hours, on an OFF
-- day, or during time-off — a slot the UI would never offer. This re-runs the SAME schedule gate that
-- `available_slots` (0006) uses, on the SAME Europe/Stockholm instant math, inside the write path.
--
-- All existing behavior is preserved exactly:
--   past/now start          -> invalid_time
--   method/contact mismatch -> invalid_contact
--   NEW off-day/time-off/outside-hours -> outside_hours
--   exclusion (overlap)     -> slot_taken
--   check constraint        -> invalid
--   NEW foreign key (bad barber_id, post-0009 FK) -> invalid   (M1: 0009 swapped the CHECK for an FK,
--                            so a bad id now raises foreign_key_violation, which the old handler missed)
--
-- Frozen migrations 0001..0009 are NOT edited; this CREATE OR REPLACE supersedes the 0003 definition.

create or replace function public.create_booking(
  p_barber_id     text,
  p_service_id    text,
  p_service_name  text,
  p_price         int,
  p_duration_min  int,
  p_start_at      timestamptz,
  p_method        text,
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
  v_end_at    timestamptz;
  v_row       public.bookings;
  -- The booking's Europe/Stockholm wall-clock, derived from the stored instant (matches available_slots).
  v_local_ts  timestamp;   -- naive local timestamp in salon tz
  v_weekday   int;         -- 0=Sun..6=Sat (extract(dow ...)), to match barber_schedules + the front end
  v_slot_min  int;         -- minutes since local midnight (the slot's start_min)
begin
  -- Reject past (or now) start times. (unchanged)
  if p_start_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  -- Method/contact pairing: sms needs phone, email needs email. (unchanged)
  if not (
    (p_method = 'sms'   and p_phone is not null and p_phone <> '') or
    (p_method = 'email' and p_email is not null and p_email <> '')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- Unknown barber -> `invalid` (M1). This MUST precede the schedule gate below: an unknown barber
  -- has no barber_schedules row, so the working-hours `not exists` check would otherwise mask the
  -- bad-id case as `outside_hours`. A missing/removed barber is an invalid INPUT, not a scheduling
  -- outcome, so we classify it here. (The FK-violation arm in the INSERT remains as defense in depth
  -- for a barber deleted concurrently between this check and the insert.)
  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- H1: server-side schedule enforcement. Reject a booking that is on a non-working weekday, inside
  -- a time-off range, or whose [slot, slot+duration] window falls outside the barber's working hours.
  -- The instant -> Stockholm wall-clock conversion mirrors available_slots(0006) EXACTLY so the read
  -- (availability) and write (this insert) agree on every boundary slot, DST included.
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
      p_start_at, v_end_at, p_customer_name, p_method,
      -- only persist the contact for the chosen channel
      case when p_method = 'sms'   then p_phone else null end,
      case when p_method = 'email' then p_email else null end,
      p_lang
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      -- SQLSTATE 23P01: another CONFIRMED booking already overlaps this barber+time.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation then
      -- SQLSTATE 23514: a column CHECK failed (defense in depth against a direct anon caller).
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
    when foreign_key_violation then
      -- SQLSTATE 23503: barber_id does not reference a barbers row. 0009 replaced the old hardcoded
      -- CHECK with this FK, so a bad/removed barber id now surfaces here; map it to the same clean
      -- `invalid` Result the CHECK used to produce (restores the documented defense-in-depth).
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

-- The signature is unchanged, so the 0003 grants (revoke from public, grant to anon) still apply to
-- this replaced body. No re-grant needed for create_booking.

-- ---------------------------------------------------------------------------------------------
-- L2: taken_slots is dead on the public path — `available_slots` (0006) superseded it and no adapter
-- calls it. Remove its anon EXECUTE so the public surface shrinks to what the app actually uses. The
-- function definition is kept (admin/debug), just no longer reachable by the anon browser credential.
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.taken_slots(text, timestamptz, timestamptz) from anon;
