-- pgTAP — barber_slot_blocks (migration 0017). Proves:
--   schema: the window CHECKs + the exact-duplicate unique constraint hold
--   read path: a blocked slot disappears from available_slots; adjacent slots stay (half-open)
--   a RANGE block removes every slot it overlaps
--   deleting the block row restores the slot
--   write path: create_booking rejects a blocked slot with 'outside_hours' (read/write agreement)
--   RLS: anon can read blocks but cannot write them
--
-- Fixtures mirror 07_available_slots_test.sql: controlled hassan schedule, working ONLY Monday
-- (2099-01-05, dow=1) 09:00–18:00, all inside a rolled-back tx.

begin;
select plan(16);

select is(pg_catalog.date_part('dow', date '2099-01-05')::int, 1, 'fixture: 2099-01-05 is a Monday (dow=1)');

-- ---- fixtures (controlled hassan schedule) --------------------------------------------------
delete from public.barber_schedules where barber_id = 'hassan';
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
values ('hassan', 1, true, 540, 1080);

-- =============================================================================================
-- SCHEMA: window order + duplicate guard.
-- =============================================================================================
select throws_ok(
  $$insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
    values ('hassan','2099-01-05',630,630)$$,
  '23514', null, 'a zero-length block (end_min = start_min) is rejected'
);
insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
values ('hassan','2099-01-05',630,675);   -- block 10:30–11:15
select throws_ok(
  $$insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
    values ('hassan','2099-01-05',630,675)$$,
  '23505', null, 'an exact-duplicate block is rejected (unique window per barber+date)'
);

-- =============================================================================================
-- READ PATH: the blocked 10:30 slot is excluded; neighbours stay (half-open window math).
-- =============================================================================================
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  11, 'a 10:30 block removes exactly one 45-min slot (12 -> 11)'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45) s where s = '10:30'),
  0, 'the blocked 10:30 slot is absent'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45) s where s = '11:15'),
  1, 'the adjacent 11:15 slot (block ends 11:15) is still available (half-open)'
);
-- A 60-min service starting 09:45 would run 09:45–10:45, overlapping the 10:30 block -> excluded.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 60) s where s = '09:45'),
  0, 'a 60-min 09:45 slot overlapping the block is excluded (duration-aware)'
);

-- Other days are untouched by the block (it is date-scoped)... but every other weekday is off in
-- this fixture, so prove date-scoping on the SAME weekday one week later instead.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-12', 45)),
  12, 'the block is date-scoped: the next Monday still has all 12 slots'
);

-- Deleting the row reopens the slot.
delete from public.barber_slot_blocks where barber_id='hassan' and block_date='2099-01-05';
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  12, 'deleting the block restores the full 12-slot set'
);

-- A 15-MIN QUARTER block (the panel's write unit): 10:30–10:45 kills the 45-min 10:30 slot it
-- overlaps but NOT the neighbouring 09:45 slot (which ends exactly 10:30 — half-open).
insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
values ('hassan','2099-01-05',630,645);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45) s where s = '10:30'),
  0, 'a 15-min quarter block removes the 45-min slot it overlaps'
);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45) s where s = '09:45'),
  1, 'the 09:45 slot ending exactly at the quarter block start stays available'
);
delete from public.barber_slot_blocks where barber_id='hassan' and block_date='2099-01-05';

-- A RANGE block (12:00–15:00) removes every slot whose window it overlaps:
-- 12:00, 12:45, 13:30, 14:15 all start inside it -> 8 left.
insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
values ('hassan','2099-01-05',720,900);
select is(
  (select count(*)::int from public.available_slots('hassan', date '2099-01-05', 45)),
  8, 'a 12:00-15:00 range block removes the four slots it covers'
);

-- =============================================================================================
-- WRITE PATH: create_booking rejects a start inside the block with 'outside_hours'.
-- =============================================================================================
select is(
  (select (public.create_booking(
     'hassan','h',
     (date '2099-01-05' + time '12:45') at time zone 'Europe/Stockholm',
     '0701119999','blocked@example.test','sv','Blocked Walkin'
   ))->>'error'),
  'outside_hours', 'create_booking rejects a blocked slot (read/write agreement)'
);
-- ...and still accepts a slot outside the block on the same day.
select is(
  (select (public.create_booking(
     'hassan','h',
     (date '2099-01-05' + time '09:00') at time zone 'Europe/Stockholm',
     '0701119999','open@example.test','sv','Open Walkin'
   ))->>'ok')::boolean,
  true, 'create_booking still accepts an unblocked slot on the same day'
);

-- =============================================================================================
-- RLS: anon may read block rows (public availability shape) but may not insert.
-- =============================================================================================
set local role anon;
select lives_ok(
  $$select count(*) from public.barber_slot_blocks$$,
  'anon CAN select barber_slot_blocks (read is public, like barber_time_off)'
);
select throws_ok(
  $$insert into public.barber_slot_blocks (barber_id, block_date, start_min, end_min)
    values ('hassan','2099-01-05',540,585)$$,
  '42501', null, 'anon CANNOT insert a block'
);
reset role;

select * from finish();
rollback;
