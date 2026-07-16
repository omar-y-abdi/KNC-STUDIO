-- pgTAP — services table (Task 2 §1: per-barber flat catalog, migration 0017).
-- Verifies the seed gave each barber the starter menu, and that the check + FK constraints hold.
-- (RLS mirrors the audited barbers / barber_slot_blocks posture and is exercised by 05_admin_rls.)

begin;
select plan(6);

-- The seed (supabase/seed.sql) gives each seed barber the 5-item starter menu.
select is(
  (select count(*)::int from public.services where barber_id = 'hassan'), 5,
  'hassan is seeded with 5 services');
select is(
  (select count(*)::int from public.services where active and barber_id = 'victor'), 5,
  'victor has 5 active services');

-- Check constraints reject bad rows.
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min) values ('hassan','',100,30) $$,
  '23514', null, 'empty name rejected (name-length check)');
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min) values ('hassan','X',-5,30) $$,
  '23514', null, 'negative price rejected');
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min) values ('hassan','X',100,2) $$,
  '23514', null, 'too-short duration rejected');

-- Foreign key: an unknown barber_id is rejected.
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min) values ('ghost','X',100,30) $$,
  '23503', null, 'unknown barber_id rejected (foreign key)');

select * from finish();
rollback;
