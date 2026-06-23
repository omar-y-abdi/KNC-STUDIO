-- Migration 0006 — admin RPC functions. Source of truth: ADMIN_SPEC.md §2 (cancel) + §3 (slots).
--
-- Both are SECURITY DEFINER + `set search_path = ''` (every object schema-qualified). They return
-- their results as the booking backend does: admin_cancel_booking yields a JSONB Result object;
-- available_slots yields `setof text` (HH:MM slot labels).

-- ---------------------------------------------------------------------------------------------
-- admin_cancel_booking(p_booking_id) — cancel a CONFIRMED booking iff the caller is the owner OR
-- the owning barber (the booking's barber_id = current_barber_id()). Sets status='cancelled' +
-- cancelled_at. Returns {ok:true,...} or {ok:false,error:...}. The authorization is checked in
-- SQL (not via RLS) because this runs SECURITY DEFINER (RLS-bypassing) — so we re-derive the
-- caller's role from auth.uid() via the helper functions.
--
-- Errors:
--   forbidden  — caller is neither owner nor the owning barber (also returned when not authed,
--                since is_owner() is false and current_barber_id() is null then).
--   not_found  — no such booking, or it is already cancelled (idempotent second call).
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

-- ---------------------------------------------------------------------------------------------
-- available_slots(p_barber_id, p_date, p_duration_min) — the bookable HH:MM slots for that
-- barber+date+duration. Supersedes the booking backend's taken-only model (ADMIN_SPEC §3):
--   * weekday := extract(dow from p_date) (0=Sun..6=Sat). If no barber_schedules row with
--     working=true for that weekday -> return NOTHING (barber off that day).
--   * if p_date falls inside any barber_time_off [start_date,end_date] -> return NOTHING.
--   * else, for each of the 12 fixed SLOTS, include it iff
--       (a) [slot_min, slot_min+duration] fits within [start_min, end_min]  (pure integer math;
--           `<=` so a slot ending exactly at end_min fits), AND
--       (b) it does NOT overlap a CONFIRMED booking that day. Overlap is computed on INSTANTS:
--           the slot's [start,end) is materialized as `(p_date + slot_time) AT TIME ZONE
--           'Europe/Stockholm'` (correct on a UTC server, DST-safe), and compared half-open
--           (start_at < slot_end AND end_at > slot_start) to match the exclusion constraint.
-- SECURITY DEFINER so anon can read schedules/time_off/bookings ranges without direct grants.
-- ---------------------------------------------------------------------------------------------
create or replace function public.available_slots(
  p_barber_id    text,
  p_date         date,
  p_duration_min int
)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with sched as (
    -- the working schedule row for this barber on this weekday (if any)
    select s.start_min, s.end_min
    from public.barber_schedules s
    where s.barber_id = p_barber_id
      and s.working = true
      and s.weekday = pg_catalog.date_part('dow', p_date)::int
  ),
  off as (
    -- is the date blocked by time off?
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and p_date between t.start_date and t.end_date
  ),
  slot(label, slot_min) as (
    values
      ('09:00', 540), ('09:45', 585), ('10:30', 630), ('11:15', 675),
      ('12:00', 720), ('12:45', 765), ('13:30', 810), ('14:15', 855),
      ('15:00', 900), ('15:45', 945), ('16:30', 990), ('17:15', 1035)
  )
  select slot.label
  from slot, sched
  where not exists (select 1 from off)
    -- (a) the [slot, slot+duration] window fits within working hours
    and slot.slot_min >= sched.start_min
    and slot.slot_min + p_duration_min <= sched.end_min
    -- (b) no overlap with a confirmed booking that day (instants in Europe/Stockholm)
    and not exists (
      select 1
      from public.bookings b
      where b.barber_id = p_barber_id
        and b.status = 'confirmed'
        and b.start_at < ((p_date + pg_catalog.make_time(slot.slot_min / 60, slot.slot_min % 60, 0)
                            + pg_catalog.make_interval(mins => p_duration_min)) at time zone 'Europe/Stockholm')
        and b.end_at   > ((p_date + pg_catalog.make_time(slot.slot_min / 60, slot.slot_min % 60, 0))
                            at time zone 'Europe/Stockholm')
    )
  order by slot.slot_min;
$$;

-- Least privilege: strip PUBLIC execute, then expose to the roles that need them.
-- admin_cancel_booking: authenticated only (owner/barber via their Auth session).
-- available_slots: anon + authenticated (public booking flow + admin previews).
revoke execute on function public.admin_cancel_booking(uuid)         from public;
revoke execute on function public.available_slots(text, date, int)   from public;
grant  execute on function public.admin_cancel_booking(uuid)         to authenticated;
grant  execute on function public.available_slots(text, date, int)   to anon, authenticated;
