-- pgTAP — admin_delete_barber RPC (migration 20260718150000). SECURITY DEFINER; authority re-derived
-- from auth.uid() via is_owner(). Proves:
--   anon                    -> no EXECUTE grant (asserted via catalog: has_function_privilege = false)
--   barber                  -> forbidden (only the owner may hard-delete a barber)
--   unknown id              -> not_found
--   has bookings, no purge  -> has_bookings with count / past / upcoming, and NOTHING is deleted
--   purge=true              -> removes the barber + its bookings + its login profile + a CASCADE child
--                              (barber_schedules); a reviewed booking's review survives, booking_id NULL
--   no bookings             -> a plain delete returns ok with deleted_bookings = 0
-- Identity is stubbed exactly as 06_admin_cancel_booking: seed auth.users + profiles, then
-- `set local role authenticated` + set request.jwt.claims.sub. `reset role` runs as the table owner
-- (bypasses RLS) for setup + verification.
--
-- NOTE (mirrors 07's header): this suite was NOT executed here — the local Supabase/Docker stack is
-- down in this environment. Assertions are written against the migration's contract; the parent runs
-- `supabase test db` to verify. The brief's "anon -> forbidden" is asserted against the catalog
-- (has_function_privilege): the migration revokes anon's EXECUTE, so anon cannot enter the body at all.

begin;
select plan(19);

-- ---- barbers ---------------------------------------------------------------------------------
insert into public.barbers (id, name) values
  ('deltest','Del Test'),
  ('delclean','Del Clean');

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
   '2099-05-01 09:00+00','2099-05-01 09:45+00','Upcoming Kund','sms','0701110001',null,'sv','confirmed',null),
  ('3b000000-0000-0000-0000-0000000000a2','deltest','h','Hår',350,45,
   '2020-05-01 09:00+00','2020-05-01 09:45+00','Past Kund','sms','0701110002',null,'sv','confirmed',null),
  ('3b000000-0000-0000-0000-0000000000a3','deltest','h','Hår',350,45,
   '2020-06-01 09:00+00','2020-06-01 09:45+00','Cancelled Kund','sms','0701110003',null,'sv','cancelled','2020-05-15 10:00+00');

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
-- OWNER: unknown id -> not_found; a barber WITH bookings and no purge -> has_bookings (+ counts).
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000001')::text, true);

select is(
  public.admin_delete_barber('does-not-exist') ->> 'error',
  'not_found', 'deleting a non-existent barber returns not_found'
);

-- Capture the (read-only) has_bookings refusal once, then assert all four fields off it.
select set_config('test.hasb', public.admin_delete_barber('deltest')::text, true);
select is((current_setting('test.hasb')::jsonb) ->> 'error',    'has_bookings',
  'a barber with bookings and no purge -> has_bookings');
select is((current_setting('test.hasb')::jsonb) ->> 'count',    '3',
  'has_bookings reports the total booking count (3)');
select is((current_setting('test.hasb')::jsonb) ->> 'upcoming', '1',
  'has_bookings reports upcoming = 1 (the one future confirmed booking)');
select is((current_setting('test.hasb')::jsonb) ->> 'past',     '2',
  'has_bookings reports past = 2 (count - upcoming: the cancelled + the past confirmed)');
reset role;

-- The refusal deleted nothing.
select is((select count(*)::int from public.barbers  where id = 'deltest'),        1,
  'the barber still exists after the has_bookings refusal');
select is((select count(*)::int from public.bookings where barber_id = 'deltest'), 3,
  'all 3 bookings still exist after the has_bookings refusal');

-- =============================================================================================
-- OWNER + purge=true -> the barber, its bookings, its login profile and CASCADE children all go; the
-- review survives detached. A separate bookingless barber deletes cleanly with deleted_bookings=0.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','30000000-0000-0000-0000-000000000001')::text, true);

select set_config('test.del1', public.admin_delete_barber('deltest', true)::text, true);
select is((current_setting('test.del1')::jsonb) ->> 'ok',               'true',
  'owner purge-deletes the barber -> ok:true');
select is((current_setting('test.del1')::jsonb) ->> 'deleted_bookings', '3',
  'the purge reports deleted_bookings = 3');

select set_config('test.del2', public.admin_delete_barber('delclean')::text, true);
select is((current_setting('test.del2')::jsonb) ->> 'ok',               'true',
  'deleting a barber with no bookings -> ok:true');
select is((current_setting('test.del2')::jsonb) ->> 'deleted_bookings', '0',
  'a bookingless delete reports deleted_bookings = 0');
reset role;

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
