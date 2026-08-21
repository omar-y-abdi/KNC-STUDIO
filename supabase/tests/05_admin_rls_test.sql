-- pgTAP — RLS on the admin tables + bookings admin reads, by ROLE (ADMIN_SPEC §2 + §8).
-- The security spine: a barber must NOT reach another barber's data; anon must NOT reach
-- bookings/profiles; owner mutations use guarded RPCs where cross-system invariants require them.
-- permission-denied = 42501.
--
-- Technique: seed auth.users + profiles (as the owner/superuser), then simulate each caller with
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub','<uuid>')::text, true);
-- so auth.uid() (and thus the helper functions) resolve to that user. anon is `set local role
-- anon`. NB: `SET LOCAL ... = <expr>` rejects function-call expressions, so we use the
-- set_config(..., is_local => true) function form (same pattern the existing RPC tests use for
-- their custom GUCs).

begin;
select plan(48);

-- RLS is enabled on every new table.
select is((select relrowsecurity from pg_class where oid='public.barbers'::regclass),          true, 'RLS on barbers');
select is((select relrowsecurity from pg_class where oid='public.profiles'::regclass),         true, 'RLS on profiles');
select is((select relrowsecurity from pg_class where oid='public.barber_schedules'::regclass), true, 'RLS on barber_schedules');
select is((select relrowsecurity from pg_class where oid='public.barber_time_off'::regclass),  true, 'RLS on barber_time_off');
select is((select relrowsecurity from pg_class where oid='public.about_content'::regclass),    true, 'RLS on about_content');
select is((select relrowsecurity from pg_class where oid='public.gallery_images'::regclass),   true, 'RLS on gallery_images');

-- ---- seed identities + supporting rows (as owner/superuser, before dropping role) ------------
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001','owner@knc.local'),
  ('10000000-0000-0000-0000-000000000002','victor@knc.local'),
  ('10000000-0000-0000-0000-000000000003','salman@knc.local');
insert into public.profiles (id, role, barber_id) values
  ('10000000-0000-0000-0000-000000000001','owner', null),
  ('10000000-0000-0000-0000-000000000002','barber','victor'),
  ('10000000-0000-0000-0000-000000000003','barber','salman');

-- One inactive barber to prove anon cannot see inactive rows.
insert into public.barbers (id, name, active, sort_order) values ('hidden-barber','Hidden',false,9);

-- One confirmed booking per barber (future), to prove booking visibility boundaries.
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('victor','h','Hår',350,45,'2099-04-01 09:00+00','2099-04-01 09:45+00','V Kund','phone','0701110001',null,'sv'),
  ('salman','h','Hår',350,45,'2099-04-01 10:00+00','2099-04-01 10:45+00','S Kund','phone','0701110002',null,'sv');

-- =============================================================================================
-- ANON — public reads active barbers/about/gallery; schedule internals return zero rows;
-- no writes anywhere.
-- =============================================================================================
set local role anon;

select is(
  (select count(*)::int from public.barbers where id = 'hidden-barber'),
  0, 'anon cannot see an INACTIVE barber'
);
select ok(
  (select count(*)::int from public.barbers) >= 3,
  'anon sees the active barbers (roster)'
);
select is(
  (select count(*)::int from public.barber_schedules),
  0, 'anon sees no raw schedules; available_slots exposes safe availability'
);
select is(
  (select count(*)::int from public.barber_time_off),
  0, 'anon sees no raw time-off rows'
);
select ok(
  (select count(*)::int from public.about_content) = 14,
  'anon reads about_content (public copy)'
);
select lives_ok(
  $$select count(*) from public.gallery_images$$,
  'anon reads gallery_images (public gallery)'
);

-- anon must NOT read bookings or profiles.
select throws_ok(
  $$select count(*) from public.bookings$$,
  '42501', null, 'anon CANNOT select bookings'
);
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501', null, 'anon CANNOT select profiles'
);

-- anon must NOT write any new table (no insert grant -> 42501).
select throws_ok(
  $$insert into public.barbers (id, name) values ('anon-hack','X')$$,
  '42501', null, 'anon CANNOT insert barbers'
);
select throws_ok(
  $$insert into public.barber_schedules (barber_id, weekday) values ('victor', 1)$$,
  '42501', null, 'anon CANNOT insert barber_schedules'
);
select throws_ok(
  $$insert into public.barber_time_off (barber_id, start_date, end_date) values ('victor','2099-01-01','2099-01-02')$$,
  '42501', null, 'anon CANNOT insert barber_time_off'
);
select throws_ok(
  $$insert into public.about_content (key, lang, value) values ('intro','sv','hack')$$,
  '42501', null, 'anon CANNOT insert about_content'
);
select throws_ok(
  $$insert into public.gallery_images (kind, storage_path) values ('salon','x')$$,
  '42501', null, 'anon CANNOT insert gallery_images'
);
select throws_ok(
  $$update public.barbers set name = 'X' where id = 'victor'$$,
  '42501', null, 'anon CANNOT update barbers'
);

reset role;

-- =============================================================================================
-- BARBER (victor) — own schedule/time_off writable; salman's NOT; sees only own bookings;
-- cannot read profiles other than own; cannot write barbers/about/gallery (owner-only).
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-0000-0000-000000000002')::text, true);

-- bookings: victor sees only his own.
select is(
  (select count(*)::int from public.bookings),
  1, 'victor sees exactly his own bookings (count = 1)'
);
select is(
  (select barber_id from public.bookings),
  'victor', 'the booking victor sees is his own'
);
select is(
  (select count(*)::int from public.bookings where barber_id = 'salman'),
  0, 'victor CANNOT see salman''s bookings'
);

-- profiles: victor reads only his own row.
select is(
  (select count(*)::int from public.profiles),
  1, 'victor sees only his own profile row'
);
select is(
  (select barber_id from public.profiles),
  'victor', 'victor''s own profile resolves to barber_id victor'
);

-- Availability writes are RPC-only so validation and booking-conflict checks share one transaction.
select throws_ok(
  $$update public.barber_schedules set start_min = 600 where barber_id = 'victor' and weekday = 1$$,
  '42501', null, 'victor CANNOT bypass the schedule mutation RPC'
);
select is(
  (select start_min from public.barber_schedules where barber_id='victor' and weekday=1),
  540::smallint, 'the blocked direct schedule update changed nothing'
);

select set_config(
  'test.week',
  jsonb_build_array(
    jsonb_build_object('weekday',0,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',1,'working',true, 'start_min',600,'end_min',960),
    jsonb_build_object('weekday',2,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',3,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',4,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',5,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',6,'working',true, 'start_min',540,'end_min',1080)
  )::text,
  true
);
select is(
  public.admin_save_barber_week('victor', current_setting('test.week')::jsonb) ->> 'ok',
  'true', 'victor CAN save his own schedule through the guarded RPC'
);
select is(
  (select start_min from public.barber_schedules where barber_id='victor' and weekday=1),
  600::smallint, 'victor''s guarded schedule update persisted'
);

select is(
  public.admin_save_barber_week('salman', current_setting('test.week')::jsonb) ->> 'error',
  'forbidden', 'victor CANNOT save another barber''s schedule through the RPC'
);
select is(
  (select start_min from public.barber_schedules where barber_id='salman' and weekday=1),
  540::smallint, 'salman''s schedule remains unchanged by victor'
);

select is(
  public.admin_add_time_off('victor','2099-12-24','2099-12-26','') ->> 'ok',
  'true', 'victor CAN add his own time off through the guarded RPC'
);
select is(
  public.admin_add_time_off('salman','2099-12-24','2099-12-26','') ->> 'error',
  'forbidden', 'victor CANNOT add time off for salman through the RPC'
);

-- owner-only tables: a barber cannot write them. NB the failure SHAPE differs by command:
--   * UPDATE barbers — victor holds the table UPDATE grant but no owner policy matches his rows,
--     so the USING filter hides every row -> the UPDATE is a silent 0-row NO-OP (not 42501).
--     Proven by capturing the affected-row count (must be 0) AND that salman is unchanged.
--   * INSERT about_content/gallery_images — the owner WITH CHECK fails on insert -> 42501.
with upd as (
  update public.barbers set name = 'Hacked' where id = 'salman' returning 1
)
select set_config('test.barber_upd_rows', (select count(*)::int from upd)::text, true);
select is(
  current_setting('test.barber_upd_rows'),
  '0', 'victor''s UPDATE of another barber affects 0 rows (owner-only, silent no-op)'
);
select isnt(
  (select name from public.barbers where id = 'salman'),
  'Hacked', 'salman''s name is unchanged by victor'
);
select throws_ok(
  $$insert into public.about_content (key, lang, value) values ('intro','sv','barber-edit')$$,
  '42501', null, 'victor CANNOT write about_content (owner-only WITH CHECK)'
);
select throws_ok(
  $$insert into public.gallery_images (kind, storage_path) values ('salon','x')$$,
  '42501', null, 'victor CANNOT write gallery_images (owner-only)'
);

reset role;

-- =============================================================================================
-- OWNER — full reads; direct writes only where no guarded transactional gateway is required.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-0000-0000-000000000001')::text, true);

select is(
  (select count(*)::int from public.bookings),
  2, 'owner sees ALL bookings (both barbers)'
);
select ok(
  (select count(*)::int from public.profiles) >= 3,
  'owner sees ALL profiles'
);
select is(
  (select count(*)::int from public.barbers where id='hidden-barber'),
  1, 'owner sees inactive barbers too'
);
select lives_ok(
  $$update public.barbers set name = 'Victor Updated' where id = 'victor'$$,
  'owner CAN update any barber'
);
select is(
  public.admin_save_barber_week('salman', current_setting('test.week')::jsonb) ->> 'ok',
  'true', 'owner CAN update any barber''s schedule through the guarded RPC'
);
select is(
  public.admin_add_time_off('salman','2099-11-01','2099-11-02','') ->> 'ok',
  'true', 'owner CAN insert time off for any barber through the guarded RPC'
);
select lives_ok(
  $$update public.about_content set value = 'Owner edit' where key='intro' and lang='sv'$$,
  'owner CAN edit about_content'
);
select throws_ok(
  $$insert into public.gallery_images (kind, storage_path, alt) values ('cuts','gallery/cuts/x.jpg','x')$$,
  '42501', null, 'owner CANNOT bypass the validated image gateway'
);
select lives_ok(
  $$insert into public.barbers (id, name, sort_order) values ('new-barber','Newbie',5)$$,
  'owner CAN insert a new barber'
);
select throws_ok(
  $$delete from public.barbers where id = 'new-barber'$$,
  '42501', null, 'owner CANNOT bypass guarded barber deletion'
);
select is(
  public.admin_delete_barber('new-barber') ->> 'ok',
  'true', 'owner CAN delete a barber through the guarded RPC'
);

reset role;

select * from finish();
rollback;
