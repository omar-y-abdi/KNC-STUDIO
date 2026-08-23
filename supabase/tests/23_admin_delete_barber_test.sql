-- pgTAP — admin_delete_barber RPC (migration 20260718150000). SECURITY DEFINER; authority re-derived
-- from auth.uid() via is_owner(). Proves:
--   anon                    -> no EXECUTE grant (asserted via catalog: has_function_privilege = false)
--   barber                  -> forbidden (only the owner may hard-delete a barber)
--   unknown id              -> not_found
--   active/future confirmed booking -> has_upcoming regardless of purge, and NOTHING is deleted
--   after future resolution  -> purge removes barber + eligible history + login profile + CASCADE child
--                              (barber_schedules); a reviewed booking's review survives, booking_id NULL
--   no bookings             -> a plain delete returns ok with deleted_bookings = 0
-- Identity is stubbed exactly as 06_admin_cancel_booking: seed auth.users + profiles, then
-- `set local role authenticated` + set request.jwt.claims.sub. `reset role` runs as the table owner
-- (bypasses RLS) for setup + verification.
--
begin;
select plan(31);

-- ---- barbers ---------------------------------------------------------------------------------
insert into public.barbers (id, name) values
  ('deltest','Del Test'),
  ('delclean','Del Clean'),
  ('delactive','Del Active'),
  ('delmail','Del Mail');

-- a CASCADE child of the barber (must vanish when the barber row is deleted)
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min) values
  ('deltest', 1, true, 540, 1080);

-- ---- identities ------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-000000000001','owner@del.local'),
  ('30000000-0000-0000-0000-000000000002','deltest@del.local');
insert into public.profiles (id, role, barber_id) values
  ('30000000-0000-0000-0000-000000000001','owner',  null),
  ('30000000-0000-0000-0000-000000000002','barber','deltest');

-- ---- deltest's bookings: 1 upcoming confirmed, 1 past confirmed (reviewed), 1 cancelled ------
-- The two confirmed rows sit in different years so the no-overlap exclusion constraint is satisfied.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, cancelled_at)
values
  ('3b000000-0000-0000-0000-0000000000a1','deltest','h','Hår',350,45,
   '2099-05-01 09:00+00','2099-05-01 09:45+00','Upcoming Kund','phone','0701110001',null,'sv','confirmed',null),
  ('3b000000-0000-0000-0000-0000000000a2','deltest','h','Hår',350,45,
   '2020-05-01 09:00+00','2020-05-01 09:45+00','Past Kund','phone','0701110002',null,'sv','confirmed',null),
  ('3b000000-0000-0000-0000-0000000000a3','deltest','h','Hår',350,45,
   '2020-06-01 09:00+00','2020-06-01 09:45+00','Cancelled Kund','phone','0701110003',null,'sv','cancelled','2020-05-15 10:00+00');

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('3b000000-0000-0000-0000-0000000000a4','delactive','h','Hår',350,45,
   pg_catalog.now() - interval '15 minutes', pg_catalog.now() + interval '30 minutes',
   'Active Kund','phone','0701110004',null,'sv','confirmed');

-- a review tied to the past booking (must survive the purge, detached to booking_id NULL)
insert into public.reviews (id, name, rating, text, booking_id, published) values
  ('3c000000-0000-0000-0000-000000000001','Past K.',5,'Great cut','3b000000-0000-0000-0000-0000000000a2',true);

-- =============================================================================================
-- anon has no EXECUTE grant (catalog check). Supabase default-privileges auto-grant EXECUTE to anon
-- on CREATE; the migration revokes it, so this asserts the grant is gone regardless of the local image.
-- =============================================================================================
select ok(
  not has_function_privilege('anon', 'public.admin_delete_barber(text, boolean)', 'EXECUTE'),
  'admin_delete_barber: anon has no execute'
);
select ok(
  not has_table_privilege('authenticated', 'public.barbers', 'DELETE'),
  'barber rows cannot bypass guarded deletion through direct table access'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.admin_delete_barber(text,boolean)'::regprocedure),
    'hashtextextended(''availability:'' || p_barber_id, 0)'
  ) > 0,
  'barber deletion shares the booking and availability transaction lock'
);

-- =============================================================================================
-- a BARBER (non-owner) is forbidden; the attempt deletes nothing.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000002')::text, true);
select is(
  public.admin_delete_barber('deltest') ->> 'error',
  'forbidden', 'a barber (non-owner) is forbidden from deleting a barber'
);
reset role;
select is(
  (select count(*)::int from public.barbers where id = 'deltest'),
  1, 'the barber is still present after the forbidden attempt'
);

-- =============================================================================================
-- OWNER: unknown id -> not_found; future confirmed bookings block every deletion mode.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000001')::text, true);

select is(
  public.admin_delete_barber('does-not-exist') ->> 'error',
  'not_found', 'deleting a non-existent barber returns not_found'
);

-- Capture the read-only refusal once, then assert all four fields off it.
select set_config('test.hasb', public.admin_delete_barber('deltest')::text, true);
select is((current_setting('test.hasb')::jsonb) ->> 'error',    'has_upcoming',
  'a barber with a future confirmed booking -> has_upcoming');
select is((current_setting('test.hasb')::jsonb) ->> 'count',    '3',
  'has_bookings reports the total booking count (3)');
select is((current_setting('test.hasb')::jsonb) ->> 'upcoming', '1',
  'has_bookings reports upcoming = 1 (the one future confirmed booking)');
select is((current_setting('test.hasb')::jsonb) ->> 'past',     '2',
  'has_bookings reports past = 2 (count - upcoming: the cancelled + the past confirmed)');

select set_config('test.active', public.admin_delete_barber('delactive', true)::text, true);
select is((current_setting('test.active')::jsonb) ->> 'error', 'has_upcoming',
  'an in-progress confirmed appointment blocks barber deletion');
select is((current_setting('test.active')::jsonb) ->> 'upcoming', '1',
  'the active appointment is counted as unresolved');
reset role;

-- The refusal deleted nothing.
select is((select count(*)::int from public.barbers  where id = 'deltest'),        1,
  'the barber still exists after the has_bookings refusal');
select is((select count(*)::int from public.bookings where barber_id = 'deltest'), 3,
  'all 3 bookings still exist after the has_bookings refusal');
select is((select count(*)::int from public.barbers where id = 'delactive'), 1,
  'the barber remains while an appointment is in progress');

-- =============================================================================================
-- OWNER + purge=true is still blocked. After explicit cancellation, history purge may proceed.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000001')::text, true);

select set_config('test.blocked_purge', public.admin_delete_barber('deltest', true)::text, true);
select is((current_setting('test.blocked_purge')::jsonb) ->> 'error', 'has_upcoming',
  'purge=true cannot erase a future confirmed appointment');
reset role;
select is((select count(*)::int from public.barbers where id = 'deltest'), 1,
  'the barber remains after the blocked purge');

update public.bookings
set status = 'cancelled', cancelled_at = pg_catalog.now()
where id = '3b000000-0000-0000-0000-0000000000a1';

-- This test's deltest deliveries are not under test; complete them before testing destructive purge.
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where booking_id in (
  select id from public.bookings where barber_id = 'deltest'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000001')::text, true);
select is(public.admin_delete_barber('deltest', null) ->> 'error', 'has_bookings',
  'null purge flag cannot bypass explicit booking purge confirmation');
select is((select count(*)::int from public.bookings where barber_id = 'deltest'), 3,
  'null purge flag preserves every historical booking');
select set_config('test.del1', public.admin_delete_barber('deltest', true)::text, true);
select is((current_setting('test.del1')::jsonb) ->> 'ok', 'true',
  'owner purge-deletes the barber after future appointments are resolved');
select is((current_setting('test.del1')::jsonb) ->> 'deleted_bookings', '3',
  'the eligible-history purge reports deleted_bookings = 3');

select set_config('test.del2', public.admin_delete_barber('delclean')::text, true);
select is((current_setting('test.del2')::jsonb) ->> 'ok',               'true',
  'deleting a barber with no bookings -> ok:true');
select is((current_setting('test.del2')::jsonb) ->> 'deleted_bookings', '0',
  'a bookingless delete reports deleted_bookings = 0');
reset role;

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('3b000000-0000-0000-0000-0000000000d1','delmail','h','Hår',350,45,
   '2020-08-01 09:00+00','2020-08-01 09:45+00','Delivery Guard','email','0701110099',
   'delete-barber@example.test','sv','confirmed');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000001')::text, true);
select is(public.admin_delete_barber('delmail', true) ->> 'error', 'delivery_pending',
  'barber purge refuses to cascade an unresolved transactional email');
reset role;
select is((select count(*)::int from public.barbers where id='delmail'), 1,
  'barber remains after delivery guard refusal');
select is((select count(*)::int from public.booking_email_delivery_jobs
  where booking_id='3b000000-0000-0000-0000-0000000000d1' and status='pending'), 1,
  'barber purge keeps the recoverable delivery job');

-- ---- final state (as the table owner, RLS-bypassing) ----------------------------------------
select is((select count(*)::int from public.barbers where id in ('deltest','delclean')), 0,
  'both barbers are gone');
select is((select count(*)::int from public.bookings where barber_id = 'deltest'), 0,
  'the purged barber''s bookings are gone');
select is((select count(*)::int from public.profiles where barber_id = 'deltest'), 0,
  'the purged barber''s login profile is gone (not left orphaned with a null barber_id)');
select is((select count(*)::int from public.barber_schedules where barber_id = 'deltest'), 0,
  'a CASCADE child (barber_schedules) is gone with the barber');
select is(
  (select count(*)::int from public.reviews
     where id = '3c000000-0000-0000-0000-000000000001' and booking_id is null),
  1, 'the reviewed booking''s review survives with booking_id NULL');

select * from finish();
rollback;
