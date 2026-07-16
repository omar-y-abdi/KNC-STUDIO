-- pgTAP — barber_photos (Task 2 §3, migration 0019). Verifies the table + FK + PK; the bucket +
-- Storage/table RLS mirror the audited gallery + services posture.

begin;
select plan(4);

select is((select count(*)::int from public.barber_photos), 0, 'barber_photos starts empty');

insert into public.barber_photos (barber_id, storage_path) values ('hassan', 'hassan/abc.jpg');
select is(
  (select storage_path from public.barber_photos where barber_id = 'hassan'),
  'hassan/abc.jpg', 'a photo path round-trips');

-- One row per barber (primary key on barber_id).
select throws_ok(
  $$ insert into public.barber_photos (barber_id, storage_path) values ('hassan', 'hassan/def.jpg') $$,
  '23505', null, 'a second photo row for the same barber is rejected (primary key)');

-- Foreign key: unknown barber rejected.
select throws_ok(
  $$ insert into public.barber_photos (barber_id, storage_path) values ('ghost', 'ghost/x.jpg') $$,
  '23503', null, 'unknown barber_id rejected (foreign key)');

select * from finish();
rollback;
