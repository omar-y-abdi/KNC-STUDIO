-- pgTAP — available_slots RPC, FIXED 15-min GRID model (migration 0026 + .claude/runtime/SLOT_PACKING_SPEC.md).
-- The RPC no longer steps by the service duration and packs each free gap from its left edge; it now
-- emits every start on a FIXED 15-minute grid anchored at open, keeping the ones where the chosen
-- service FITS (ends by close AND its half-open [t,t+dur) window overlaps no confirmed booking / block).
-- Proves:
--   empty day, dur=30 -> 09:00,09:15,…,17:30 (35)  | dur=45 -> …,17:15 (34) | dur=90 -> …,16:30 (31)
--   a 90-min booking 09:00–10:30, dur=30 -> first free start is EXACTLY 10:30 (the tick at the end fits)
--   a 45-min booking 09:00–09:45, dur=30 -> 09:45 AND 10:00 both bookable (the model change: 10:00 is a
--     grid tick that FITS after the booking — the old duration-stepped packer skipped it)
--   a MID-DAY booking 10:00–11:30, dur=30 -> 09:00,09:15,09:30 emitted BEFORE it (09:30 ends at the
--     block start, half-open fit), then the grid resumes at 11:30 (the tick at the block end fits)
--   p_duration_min <= 0 / off-day / non-working weekday / time-off  -> no rows
--   anon (the public booking flow) can EXECUTE the RPC (grants preserved across the rewrite)
--
-- CRITICAL (mirrors the prior test's advisor note): each conflicting booking's start_at/end_at is
--   built with the SAME (date + time) AT TIME ZONE 'Europe/Stockholm' expression the RPC uses to map
--   instants back to salon-local minutes — NOT a raw UTC literal — so the overlap lands on the exact
--   minutes the grid reasons about (a UTC literal would be an hour off in winter and the fit
--   assertions would pass/fail for the WRONG reason). Day-of-week is derived from the chosen dates.
--
-- All assertions are on the FUTURE date 2099-01-05 (a Monday), so the now()-filter always passes and
-- the full grid is exercised. Fixtures mirror the other tests: controlled hassan schedule working ONLY
-- Monday (weekday 1) 09:00–18:00 (540..1080); every other weekday absent (off).
--
-- NOTE: this suite was NOT executed here — the local pgTAP/Docker stack is down in this environment.
-- The assertions are written against the spec's worked examples; the parent runs them / verifies.

begin;
select plan(21);

-- Sanity-anchor the chosen dates' weekdays so the test is self-consistent with the seed model.
select is(pg_catalog.date_part('dow', date '2099-01-05')::int, 1, 'fixture: 2099-01-05 is a Monday (dow=1)');
select is(pg_catalog.date_part('dow', date '2099-01-04')::int, 0, 'fixture: 2099-01-04 is a Sunday (dow=0)');

-- ---- fixtures (controlled hassan schedule) --------------------------------------------------
delete from public.barber_schedules where barber_id = 'hassan';
-- Working ONLY Monday 09:00–18:00 (540..1080). No row for any other weekday -> those are off.
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
values ('hassan', 1, true, 540, 1080);

-- =============================================================================================
-- EMPTY WORKING MONDAY — a FIXED 15-min grid; the duration only sets the LAST start (t+dur<=close).
-- =============================================================================================
-- dur=30: 09:00,09:15,…,17:30 (last t=1050, 1050+30=1080=close). 35 slots = (1050-540)/15+1.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['09:00','09:15','09:30','09:45','10:00','10:15','10:30','10:45','11:00','11:15','11:30','11:45',
        '12:00','12:15','12:30','12:45','13:00','13:15','13:30','13:45','14:00','14:15','14:30','14:45',
        '15:00','15:15','15:30','15:45','16:00','16:15','16:30','16:45','17:00','17:15','17:30']::text[],
  'empty day, dur=30 -> fixed 15-min grid 09:00..17:30 (35 slots)'
);
-- dur=45: same 15-min grid, last start 17:15 (17:15+45=18:00). 34 slots = (1035-540)/15+1.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 45) s),
  array['09:00','09:15','09:30','09:45','10:00','10:15','10:30','10:45','11:00','11:15','11:30','11:45',
        '12:00','12:15','12:30','12:45','13:00','13:15','13:30','13:45','14:00','14:15','14:30','14:45',
        '15:00','15:15','15:30','15:45','16:00','16:15','16:30','16:45','17:00','17:15']::text[],
  'empty day, dur=45 -> fixed 15-min grid 09:00..17:15 (34 slots)'
);
-- dur=90: same 15-min grid, last start 16:30 (16:30+90=18:00). 31 slots = (990-540)/15+1.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 90) s),
  array['09:00','09:15','09:30','09:45','10:00','10:15','10:30','10:45','11:00','11:15','11:30','11:45',
        '12:00','12:15','12:30','12:45','13:00','13:15','13:30','13:45','14:00','14:15','14:30','14:45',
        '15:00','15:15','15:30','15:45','16:00','16:15','16:30']::text[],
  'empty day, dur=90 -> fixed 15-min grid 09:00..16:30 (31 slots)'
);

-- ANON CONTRACT: available_slots is anon-callable (the public booking flow uses it). Prove anon can
-- EXECUTE it after the rewrite (grants preserved) and gets the full 15-min grid.
set local role anon;
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30)),
  35, 'anon CAN call available_slots (grants preserved) and gets the 35-slot 15-min grid'
);
reset role;

-- p_duration_min <= 0 -> no slots (guard; also mirrors create_booking having nothing to book).
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 0)),
  0, 'a non-positive duration returns no slots'
);

-- =============================================================================================
-- FIT AROUND A BOOKING AT THE OPEN EDGE — the grid resumes at the tick that first fits after the block.
-- 90-min booking 09:00–10:30 [540,630), dur=30 -> t=540..615 all overlap; t=630 fits (630>=630).
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,90,
  (date '2099-01-05' + time '09:00') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '10:30') at time zone 'Europe/Stockholm',
  'Booked 90','phone','0701119999',null,'sv'
);
-- Grid resumes at 10:30 (the booking end) and continues on the fixed 15-min ticks. 29 slots.
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['10:30','10:45','11:00','11:15','11:30','11:45','12:00','12:15','12:30','12:45','13:00','13:15',
        '13:30','13:45','14:00','14:15','14:30','14:45','15:00','15:15','15:30','15:45','16:00','16:15',
        '16:30','16:45','17:00','17:15','17:30']::text[],
  'a 90-min booking 09:00–10:30, dur=30 -> grid resumes at 10:30 (the booking end) onward (29 slots)'
);
select is(
  (select pg_catalog.min(s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  '10:30', 'the first free 30-min tick is EXACTLY the 90-min booking''s end (the tick at be fits, t>=be)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '10:15'),
  0, '10:15 is absent — [10:15,10:45) still overlaps the booking [540,630), so the tick does NOT fit'
);
delete from public.bookings where barber_id='hassan'
  and (start_at at time zone 'Europe/Stockholm')::date = date '2099-01-05';

-- =============================================================================================
-- THE MODEL CHANGE — the grid stays FIXED; a shorter booking does NOT shift later ticks off :00/:15.
-- 45-min booking 09:00–09:45 [540,585), dur=30 -> 09:45 fits (585>=585) AND 10:00 fits (600>=585).
-- Under the OLD duration-stepped packer 10:00 was skipped (it stepped 09:45,10:15,…); now it is back.
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,45,
  (date '2099-01-05' + time '09:00') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '09:45') at time zone 'Europe/Stockholm',
  'Booked 45','phone','0701119999',null,'sv'
);
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['09:45','10:00','10:15','10:30','10:45','11:00','11:15','11:30','11:45','12:00','12:15','12:30',
        '12:45','13:00','13:15','13:30','13:45','14:00','14:15','14:30','14:45','15:00','15:15','15:30',
        '15:45','16:00','16:15','16:30','16:45','17:00','17:15','17:30']::text[],
  'a 45-min booking 09:00–09:45, dur=30 -> fixed grid resumes at 09:45 and KEEPS 10:00 (32 slots)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '10:00'),
  1, '10:00 IS offered — a fixed 15-min tick that fits after the booking (the model change vs. the old packer)'
);
select is(
  (select pg_catalog.min(s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  '09:45', 'the first free 30-min tick is 09:45 (the booking end); 09:00/09:15/09:30 overlap and drop out'
);
delete from public.bookings where barber_id='hassan'
  and (start_at at time zone 'Europe/Stockholm')::date = date '2099-01-05';

-- =============================================================================================
-- FIT BOTH SIDES OF A MID-DAY BOOKING — proves the grid emits BEFORE the block (half-open at the block
-- start) and resumes AT its end. 90-min booking 10:00–11:30 [600,690), dur=30 -> leading 09:00,09:15,
-- 09:30 (09:30: [570,600) ends at the block start, 600>600 false -> fits); t=585..675 overlap; then the
-- grid resumes at 11:30 (690>=690). 28 slots. (The one case a tail-only impl would get wrong.)
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,90,
  (date '2099-01-05' + time '10:00') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '11:30') at time zone 'Europe/Stockholm',
  'Booked mid','phone','0701119999',null,'sv'
);
select is(
  (select pg_catalog.array_agg(s order by s) from public.available_slots('hassan', date '2099-01-05', 30) s),
  array['09:00','09:15','09:30','11:30','11:45','12:00','12:15','12:30','12:45','13:00','13:15','13:30',
        '13:45','14:00','14:15','14:30','14:45','15:00','15:15','15:30','15:45','16:00','16:15','16:30',
        '16:45','17:00','17:15','17:30']::text[],
  'a mid-day booking 10:00–11:30, dur=30 -> 09:00,09:15,09:30 before it and 11:30… after it (28 slots)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '09:30'),
  1, '09:30 (a tick BEFORE the booking, ending exactly at the block start) fits — the grid emits before the block'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '09:45'),
  0, '09:45 is absent — [09:45,10:15) overlaps the booking [600,690), so the tick does NOT fit'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 30) s where s = '11:30'),
  1, '11:30 (the booking end) is the first tick AFTER the booking — the tick at be fits (t>=be)'
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
