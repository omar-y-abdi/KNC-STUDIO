-- pgTAP — available_slots RPC, PACKED model (migration 0025 + .claude/runtime/SLOT_PACKING_SPEC.md).
-- The RPC no longer returns a fixed 45-min grid; it emits bookable start times STEPPED BY the
-- service duration and LEFT-PACKED into each free interval between bookings/blocks. Proves:
--   empty day, dur=30 -> 09:00,09:30,…,17:30 (18)   | dur=45 -> the 12-slot grid | dur=90 -> 6 slots
--   a 90-min booking 09:00–10:30, dur=30 -> first free slot is EXACTLY 10:30 (gap right after)
--   a 45-min booking 09:00–09:45, dur=30 -> first free slot is 09:45 (offset grid, NOT 10:00)
--   a MID-DAY booking 10:00–11:30, dur=30 -> 09:00 & 09:30 emitted BEFORE it, 11:30 right after
--   p_duration_min <= 0 / off-day / non-working weekday / time-off  -> no rows
--   anon (the public booking flow) can EXECUTE the RPC (grants preserved across the rewrite)
--
-- CRITICAL (mirrors the prior test's advisor note): each conflicting booking's start_at/end_at is
--   built with the SAME (date + time) AT TIME ZONE 'Europe/Stockholm' expression the RPC uses to map
--   instants back to salon-local minutes — NOT a raw UTC literal — so the overlap lands on the exact
--   minutes the packer reasons about (a UTC literal would be an hour off in winter and the packing
--   assertions would pass/fail for the WRONG reason). Day-of-week is derived from the chosen dates.
--
-- All assertions are on the FUTURE date 2099-01-05 (a Monday), so the now()-filter always passes and
-- the packed grid is exercised in full. Fixtures mirror the other tests: controlled hassan schedule
-- working ONLY Monday (weekday 1) 09:00–18:00 (540..1080); every other weekday absent (off).
--
-- NOTE: this suite was NOT executed here — the local pgTAP/Docker stack is down in this environment.
-- The assertions are written against the spec's worked examples; the parent runs them / verifies.

begin;
select plan(18);

-- Sanity-anchor the chosen dates' weekdays so the test is self-consistent with the seed model.
select is(pg_catalog.date_part('dow', date '2099-01-05')::int, 1, 'fixture: 2099-01-05 is a Monday (dow=1)');
select is(pg_catalog.date_part('dow', date '2099-01-04')::int, 0, 'fixture: 2099-01-04 is a Sunday (dow=0)');

-- ---- fixtures (controlled hassan schedule) --------------------------------------------------
delete from public.barber_schedules where barber_id = 'hassan';
-- Working ONLY Monday 09:00–18:00 (540..1080). No row for any other weekday -> those are off.
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
values ('hassan', 1, true, 540, 1080);

-- =============================================================================================
-- EMPTY WORKING MONDAY — the duration STEP defines the grid, packed from the open edge.
-- =============================================================================================
-- dur=30: 09:00,09:30,…,17:30 (last t=1050, 1050+30=1080=close). 18 slots.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30',
        '14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30']::text[],
  'empty day, dur=30 -> 30-min-stepped grid 09:00..17:30 (18 slots)'
);
-- dur=45: 09:00,09:45,…,17:15 — coincides with the OLD fixed grid. 12 slots.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 45) s),
  array['09:00','09:45','10:30','11:15','12:00','12:45',
        '13:30','14:15','15:00','15:45','16:30','17:15']::text[],
  'empty day, dur=45 -> 45-min-stepped grid 09:00..17:15 (12 slots, == the old fixed grid)'
);
-- dur=90: 09:00,10:30,12:00,13:30,15:00,16:30 (last 990, +90=1080). 6 slots.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 90) s),
  array['09:00','10:30','12:00','13:30','15:00','16:30']::text[],
  'empty day, dur=90 -> 90-min-stepped grid 09:00..16:30 (6 slots)'
);

-- ANON CONTRACT: available_slots is anon-callable (the public booking flow uses it). Prove anon can
-- EXECUTE it after the rewrite (grants preserved) and gets the full 30-min grid.
set local role anon;
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30)),
  18, 'anon CAN call available_slots (grants preserved) and gets the 18-slot 30-min grid'
);
reset role;

-- p_duration_min <= 0 -> no slots (guard; also mirrors create_booking having nothing to book).
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 0)),
  0, 'a non-positive duration returns no slots'
);

-- =============================================================================================
-- PACK AROUND A BOOKING AT THE OPEN EDGE — the next slot starts EXACTLY when the booking ends.
-- 90-min booking 09:00–10:30, dur=30 -> gap [540,540] emits nothing; tail from 630 -> 10:30,11:00,…
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,90,
  (date '2099-01-05' + time '09:00') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '10:30') at time zone 'Europe/Stockholm',
  'Booked 90','sms','0701119999',null,'sv'
);
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00',
        '14:30','15:00','15:30','16:00','16:30','17:00','17:30']::text[],
  'a 90-min booking 09:00–10:30, dur=30 -> slots pack from 10:30 (the booking end) onward (15 slots)'
);
select is(
  (select pg_catalog.min(s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  '10:30', 'the first free 30-min slot is EXACTLY the 90-min booking''s end (gap right after)'
);
delete from public.bookings where barber_id='hassan'
  and (start_at at time zone 'Europe/Stockholm')::date = date '2099-01-05';

-- =============================================================================================
-- PACK ONTO AN OFFSET GRID — a 45-min booking shifts every later 30-min slot off the :00/:30 grid.
-- 45-min booking 09:00–09:45, dur=30 -> tail from 585 -> 09:45,10:15,10:45,… (NOT 10:00).
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,45,
  (date '2099-01-05' + time '09:00') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '09:45') at time zone 'Europe/Stockholm',
  'Booked 45','sms','0701119999',null,'sv'
);
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['09:45','10:15','10:45','11:15','11:45','12:15','12:45','13:15',
        '13:45','14:15','14:45','15:15','15:45','16:15','16:45','17:15']::text[],
  'a 45-min booking 09:00–09:45, dur=30 -> offset grid 09:45,10:15,… (16 slots, never 10:00)'
);
select is(
  (select pg_catalog.min(s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  '09:45', 'the first free 30-min slot is 09:45 (the booking end), NOT the fixed-grid 10:00'
);
delete from public.bookings where barber_id='hassan'
  and (start_at at time zone 'Europe/Stockholm')::date = date '2099-01-05';

-- =============================================================================================
-- PACK BOTH SIDES OF A MID-DAY BOOKING — proves the gap-loop emits BEFORE the block, and the tail
-- resumes EXACTLY at its end. 10:00–11:30, dur=30 -> gap [540,600] -> 09:00,09:30; tail from 690 ->
-- 11:30,12:00,…,17:30. (The one case an impl that only packs the tail would get wrong.)
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,90,
  (date '2099-01-05' + time '10:00') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '11:30') at time zone 'Europe/Stockholm',
  'Booked mid','sms','0701119999',null,'sv'
);
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['09:00','09:30','11:30','12:00','12:30','13:00','13:30','14:00',
        '14:30','15:00','15:30','16:00','16:30','17:00','17:30']::text[],
  'a mid-day booking 10:00–11:30, dur=30 -> 09:00,09:30 before it and 11:30… after it (15 slots)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '09:30'),
  1, '09:30 (a slot BEFORE the booking) is emitted — the free-gap loop runs, not just the tail'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '11:30'),
  1, '11:30 (the booking end) is the first slot AFTER the booking — the tail packs from be'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '10:00'),
  0, '10:00 (the booked start) is absent'
);
delete from public.bookings where barber_id='hassan'
  and (start_at at time zone 'Europe/Stockholm')::date = date '2099-01-05';

-- =============================================================================================
-- CLOSED DAYS — off weekday, non-working weekday with no schedule row, and a covering time-off.
-- =============================================================================================
-- Sunday 2099-01-04 has no working schedule row -> empty.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-04', 30)),
  0, 'off-day (Sunday, no working schedule row) returns no slots'
);
-- Tuesday 2099-01-06 (dow=2) has no schedule row at all in this fixture -> also off.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-06', 30)),
  0, 'a weekday with no schedule row returns no slots'
);
-- A time-off range covering the working Monday closes it entirely.
insert into public.barber_time_off (barber_id, start_date, end_date)
values ('hassan','2099-01-04','2099-01-06');   -- range spans the Monday
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30)),
  0, 'a date inside a time-off range returns no slots (even on a working weekday)'
);

select * from finish();
rollback;
