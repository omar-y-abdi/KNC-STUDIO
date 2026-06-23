-- pgTAP — available_slots RPC (ADMIN_SPEC §3 + §7). Proves:
--   off-day (no working schedule row for that weekday) -> empty
--   date inside a barber_time_off range               -> empty
--   within working hours, no bookings                 -> the correct fitting subset
--   a slot overlapping a CONFIRMED booking             -> excluded
--   a duration that would run past end_min             -> that slot excluded
--   times computed in Europe/Stockholm                 -> overlap uses the SAME tz instants
--
-- CRITICAL (advisor): the conflicting booking's start_at/end_at are built with the SAME
--   (date + time) AT TIME ZONE 'Europe/Stockholm'
-- expression the RPC uses — NOT a raw UTC literal — so the overlap actually triggers (a UTC
-- literal would be an hour off in winter and the "excludes booked" test would pass for the
-- WRONG reason). Day-of-week is derived from the chosen dates so it cannot drift from the seed.
--
-- Fixtures: we reuse the seeded barber `hassan` (its id is the only kind the existing
-- bookings.barber_id CHECK accepts: in ('hassan','victor','salman')). To get a controlled
-- schedule we DELETE hassan's seeded schedule rows in this rolled-back tx and insert exactly one:
-- working ONLY Monday (weekday 1) 09:00–18:00; every other weekday absent (off).
-- Dates: 2099-01-05 is a Monday (dow=1); 2099-01-04 is a Sunday.

begin;
select plan(14);

-- Sanity-anchor the chosen dates' weekdays so the test is self-consistent with the seed model.
select is(pg_catalog.date_part('dow', date '2099-01-05')::int, 1, 'fixture: 2099-01-05 is a Monday (dow=1)');
select is(pg_catalog.date_part('dow', date '2099-01-04')::int, 0, 'fixture: 2099-01-04 is a Sunday (dow=0)');

-- ---- fixtures (controlled hassan schedule) --------------------------------------------------
delete from public.barber_schedules where barber_id = 'hassan';
-- Working ONLY Monday 09:00–18:00 (540..1080). No row for any other weekday -> those are off.
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
values ('hassan', 1, true, 540, 1080);

-- =============================================================================================
-- OFF-DAY: Sunday has no working schedule row -> empty.
-- =============================================================================================
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-04', 45)),
  0, 'off-day (Sunday, no working schedule) returns no slots'
);
-- A weekday with no schedule row at all (Tuesday 2099-01-06, dow=2) is also off.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-06', 45)),
  0, 'a weekday with no schedule row returns no slots'
);
-- working=false would also be off — flip it off, assert, then flip back. (We avoid SAVEPOINT +
-- ROLLBACK TO here because rolling back a savepoint also rewinds pgTAP's internal assertion
-- counter, corrupting the final plan count; explicit inverse statements keep the counter intact.)
update public.barber_schedules set working = false where barber_id='hassan' and weekday=1;
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  0, 'Monday with working=false returns no slots'
);
update public.barber_schedules set working = true where barber_id='hassan' and weekday=1;

-- ANON CONTRACT: available_slots is anon-callable (the public booking flow uses it). Prove anon
-- can EXECUTE it and gets the expected full set on the working Monday.
set local role anon;
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  12, 'anon CAN call available_slots (anon-callable) and gets the 12-slot Monday set'
);
reset role;

-- =============================================================================================
-- FULL WORKING MONDAY, no bookings: 45-min -> all 12 slots; 60-min -> 11 (17:15 would end 18:15).
-- =============================================================================================
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  12, 'a full working Monday with no bookings returns all 12 slots (45 min)'
);
select results_eq(
  $$select * from public.available_slots('hassan', date '2099-01-05', 45) order by 1$$,
  $$values ('09:00'),('09:45'),('10:30'),('11:15'),('12:00'),('12:45'),
           ('13:30'),('14:15'),('15:00'),('15:45'),('16:30'),('17:15')$$,
  'the 45-min slot set is exactly the 12 fixed SLOTS, in order'
);

-- DURATION that runs past end_min: 60-min drops 17:15 (17:15+60 = 18:15 > 18:00). 16:30+60=17:30 ok.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 60)),
  11, 'a 60-min duration excludes 17:15 (would end 18:15 > end_min)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 60) s where s = '17:15'),
  0, '17:15 is absent from the 60-min set (its window runs past end_min)'
);

-- =============================================================================================
-- TIME OFF covering the Monday -> empty (even though it is a working weekday).
-- =============================================================================================
insert into public.barber_time_off (barber_id, start_date, end_date)
values ('hassan','2099-01-04','2099-01-06');   -- range spans the Monday
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  0, 'a date inside a time-off range returns no slots'
);
delete from public.barber_time_off where barber_id='hassan' and start_date='2099-01-04';

-- =============================================================================================
-- OVERLAP with a CONFIRMED booking. Build the booking instants with the SAME Stockholm-local
-- expression the RPC uses, so the overlap is real. Book 10:30–11:15 (45 min) -> that slot is
-- excluded; an adjacent slot (11:15) is NOT (half-open ranges, like the exclusion constraint).
-- =============================================================================================
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values (
  'hassan','h','Hår',350,45,
  (date '2099-01-05' + time '10:30') at time zone 'Europe/Stockholm',
  (date '2099-01-05' + time '11:15') at time zone 'Europe/Stockholm',
  'Booked','sms','0701119999',null,'sv'
);

-- 10:30 overlaps the booking -> excluded; the 45-min set drops exactly that one slot (11 left).
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  11, 'a confirmed booking at 10:30 removes exactly that slot (12 -> 11)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45) s where s = '10:30'),
  0, 'the booked 10:30 slot is absent from the available set'
);
-- The adjacent 11:15 slot is still available (booking ends exactly at 11:15; half-open, no overlap).
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45) s where s = '11:15'),
  1, 'the adjacent 11:15 slot (booking ends 11:15) is still available (half-open)'
);

select * from finish();
rollback;
