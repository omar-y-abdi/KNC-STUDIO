-- Migration 0017 — per-slot walk-in blocks (barber_slot_blocks).
--
-- WHY: barbers also take bookings over text/phone. Until now the only way to keep an online
-- customer out of a slot promised over SMS was to block the WHOLE day (barber_time_off is
-- date-only). This adds a minute-granular block: a row says "this barber is unavailable on this
-- date between start_min and end_min". The admin panel writes one row per 45-min slot (a tap on
-- the day grid); the schema allows ranges so a single row can also cover a longer stretch.
--
-- Kept deliberately minimal (no reason column, no status): a block either exists or it doesn't,
-- and deleting the row reopens the slot. Vacations/whole days remain barber_time_off's job.
--
-- This migration:
--   1. CREATEs public.barber_slot_blocks + index + RLS mirroring barber_time_off exactly
--      (anon+authenticated may read — block existence is exactly as public as the availability
--      it shapes; owner writes any row; a barber writes only their own).
--   2. REPLACEs available_slots (same signature -> 0006/0016 grants carry over) with ONE new
--      condition: the slot must not overlap a block row. Pure integer math on minutes-from-local-
--      midnight — both sides already live on the salon-local day, no tz conversion involved.
--   3. REPLACEs create_booking (same 9-arg signature -> 0011 service_role-only grants carry over)
--      with the mirrored write-path gate, so a blocked slot cannot be booked by a caller that
--      skips the read path. Returns the existing 'outside_hours' Result — the client already maps
--      it to "slot unavailable", and no new error code means no client/schema churn.

-- ===============================================================================================
-- 1. barber_slot_blocks — a minute-granular unavailability row on a salon-local date.
-- ===============================================================================================
create table public.barber_slot_blocks (
  id         uuid primary key default gen_random_uuid(),
  barber_id  text not null references public.barbers(id) on delete cascade,
  block_date date not null,
  start_min  smallint not null check (start_min between 0 and 1440),
  end_min    smallint not null check (end_min between 0 and 1440),
  created_at timestamptz not null default now(),
  constraint slot_block_order check (end_min > start_min),
  -- One row per exact window: a double-tap (or two devices racing) upserts instead of duplicating,
  -- so unblocking a slot is always a single delete.
  constraint slot_block_unique unique (barber_id, block_date, start_min, end_min)
);

create index barber_slot_blocks_idx on public.barber_slot_blocks (barber_id, block_date);

alter table public.barber_slot_blocks enable row level security;

grant select on public.barber_slot_blocks to anon, authenticated;
grant insert, delete on public.barber_slot_blocks to authenticated;

-- Reads: public (same stance as barber_time_off — the availability RPC already reveals blocks).
create policy slot_blocks_select_all on public.barber_slot_blocks
  for select to anon, authenticated using (true);

-- Writes: the owner may manage any barber's blocks; a barber only their own. No UPDATE policies —
-- a block is immutable (toggle = insert/delete), so there is nothing to update.
create policy slot_blocks_insert_owner on public.barber_slot_blocks
  for insert to authenticated with check (public.is_owner());
create policy slot_blocks_delete_owner on public.barber_slot_blocks
  for delete to authenticated using (public.is_owner());
create policy slot_blocks_insert_own on public.barber_slot_blocks
  for insert to authenticated with check (barber_id = public.current_barber_id());
create policy slot_blocks_delete_own on public.barber_slot_blocks
  for delete to authenticated using (barber_id = public.current_barber_id());

-- ===============================================================================================
-- 2. available_slots — also exclude slots overlapping a block row.
-- ===============================================================================================
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
    -- (b) the slot has not already started — create_booking rejects past starts (`invalid_time`),
    --     so the read path must not advertise them (same Europe/Stockholm instant math).
    and ((p_date + pg_catalog.make_time(slot.slot_min / 60, slot.slot_min % 60, 0))
           at time zone 'Europe/Stockholm') > pg_catalog.now()
    -- (c) no overlap with a confirmed booking that day (instants in Europe/Stockholm)
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
    -- (d) no overlap with a walk-in block that day (half-open window math on local minutes,
    --     mirroring the booking-overlap arithmetic above)
    and not exists (
      select 1
      from public.barber_slot_blocks bl
      where bl.barber_id = p_barber_id
        and bl.block_date = p_date
        and bl.start_min < slot.slot_min + p_duration_min
        and bl.end_min   > slot.slot_min
    )
  order by slot.slot_min;
$$;

-- ===============================================================================================
-- 3. create_booking — mirror the block gate on the write path.
-- ===============================================================================================
-- Body copied from 0011 EXACTLY, plus gate (c): reject a booking whose [slot, slot+duration]
-- window overlaps a block row. Same signature, so the 0011 grants (service_role only) carry over.
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
  if p_phone is null or p_phone = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- Unknown barber -> `invalid` (M1). Must precede the schedule gate (see 0010). (unchanged)
  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- ---------------------------------------------------------------------------------------------
  -- H1: server-side schedule enforcement — the write-path mirror of available_slots. (a)/(b)
  -- unchanged from 0011; (c) is new in 0017 and mirrors the read path's block exclusion.
  -- ---------------------------------------------------------------------------------------------
  v_local_ts := p_start_at at time zone 'Europe/Stockholm';            -- instant -> salon wall-clock
  v_weekday  := pg_catalog.date_part('dow',  v_local_ts)::int;          -- 0=Sun..6=Sat
  v_slot_min := pg_catalog.date_part('hour', v_local_ts)::int * 60
              + pg_catalog.date_part('minute', v_local_ts)::int;        -- minutes since local midnight

  -- (a) must be a working weekday AND the [slot, slot+duration] window must fit within working hours.
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

  -- (c) must NOT overlap a walk-in block (half-open window math on local minutes — the exact
  --     mirror of available_slots' condition (d), so read and write agree on every boundary).
  if exists (
    select 1
    from public.barber_slot_blocks bl
    where bl.barber_id = p_barber_id
      and bl.block_date = v_local_ts::date
      and bl.start_min < v_slot_min + p_duration_min
      and bl.end_min   > v_slot_min
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
      'sms', p_phone, null,
      p_lang
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      -- SQLSTATE 23P01: another CONFIRMED booking already overlaps this barber+time.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation then
      -- SQLSTATE 23514: a column CHECK failed. Return a clean Result, not a raw DB error.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
    when foreign_key_violation then
      -- SQLSTATE 23503: barber deleted concurrently between the check above and this insert.
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
