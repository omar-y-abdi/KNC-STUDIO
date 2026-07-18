-- pgTAP — admin_delete_bookings RPC (migration 20260718150100). SECURITY DEFINER; authority re-derived
-- from auth.uid() via is_owner()/current_barber_id(). Proves:
--   empty / null array                          -> empty
--   anon                                        -> no EXECUTE grant (catalog: has_function_privilege = false)
--   authenticated with no owner/barber identity -> forbidden
--   a barber deleting a batch that includes another barber's id -> forbidden, nothing deleted
--   a barber deleting their OWN upcoming confirmed booking      -> has_upcoming, nothing deleted
--   a barber deleting their OWN past booking     -> ok, count=1; its review survives, booking_id NULL
--   the owner deleting any bookings (a past confirmed + a cancelled) -> ok, count=2
-- Identity stubbed as 06_admin_cancel_booking (auth.users + profiles + set local role + jwt claims).
--
-- NOTE (mirrors 07's header): this suite was NOT executed here — the local Supabase/Docker stack is
-- down in this environment. Assertions are written against the migration's contract; the parent runs
-- `supabase test db` to verify. anon lockout is asserted against the catalog (has_function_privilege).

begin;
select plan(17);

-- ---- barbers + identities --------------------------------------------------------------------
insert into public.barbers (id, name) values ('abar','A Barber'), ('bbar','B Barber');
insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-000000000001','owner@db.local'),
  ('40000000-0000-0000-0000-000000000002','abar@db.local'),
  ('40000000-0000-0000-0000-000000000009','noprofile@db.local');
insert into public.profiles (id, role, barber_id) values
  ('40000000-0000-0000-0000-000000000001','owner',  null),
  ('40000000-0000-0000-0000-000000000002','barber','abar');
-- (…09 deliberately has NO profile row -> is_owner() false, current_barber_id() null.)

-- ---- bookings: abar has a past (reviewed), an upcoming, and a cancelled; bbar has one past ----
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, cancelled_at)
values
  ('4b000000-0000-0000-0000-0000000000a1','abar','h','Hår',350,45,
   '2020-05-01 09:00+00','2020-05-01 09:45+00','A Past','sms','0701110001',null,'sv','confirmed',null),
  ('4b000000-0000-0000-0000-0000000000a2','abar','h','Hår',350,45,
   '2099-05-01 09:00+00','2099-05-01 09:45+00','A Upcoming','sms','0701110002',null,'sv','confirmed',null),
  ('4b000000-0000-0000-0000-0000000000a3','abar','h','Hår',350,45,
   '2020-06-01 09:00+00','2020-06-01 09:45+00','A Cancelled','sms','0701110003',null,'sv','cancelled','2020-05-15 10:00+00'),
  ('4b000000-0000-0000-0000-0000000000b1','bbar','h','Hår',350,45,
   '2020-05-01 10:00+00','2020-05-01 10:45+00','B Past','sms','0701110004',null,'sv','confirmed',null);

insert into public.reviews (id, name, rating, text, booking_id, published) values
  ('4c000000-0000-0000-0000-000000000001','A P.',5,'Nice','4b000000-0000-0000-0000-0000000000a1',true);

-- =============================================================================================
-- empty / null selection -> empty (checked before authz; run as the owner).
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','40000000-0000-0000-0000-000000000001')::text, true);
select is(public.admin_delete_bookings(array[]::uuid[]) ->> 'error', 'empty', 'an empty id array -> empty');
select is(public.admin_delete_bookings(null::uuid[])   ->> 'error', 'empty', 'a null id array -> empty');
reset role;

-- =============================================================================================
-- anon has no EXECUTE grant (catalog check; robust whether or not the local image applied Supabase
-- default privileges — the migration revokes anon's auto-granted EXECUTE).
-- =============================================================================================
select ok(
  not has_function_privilege('anon', 'public.admin_delete_bookings(uuid[])', 'EXECUTE'),
  'admin_delete_bookings: anon has no execute'
);

-- =============================================================================================
-- authenticated but neither owner nor barber -> forbidden.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','40000000-0000-0000-0000-000000000009')::text, true);
select is(
  public.admin_delete_bookings(array['4b000000-0000-0000-0000-0000000000a1']::uuid[]) ->> 'error',
  'forbidden', 'an authenticated caller with no owner/barber identity is forbidden'
);
reset role;

-- =============================================================================================
-- a BARBER deleting a batch that includes another barber's id -> forbidden; the WHOLE batch is
-- rejected (neither row deleted).
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','40000000-0000-0000-0000-000000000002')::text, true);
select is(
  public.admin_delete_bookings(array['4b000000-0000-0000-0000-0000000000a1',
                                     '4b000000-0000-0000-0000-0000000000b1']::uuid[]) ->> 'error',
  'forbidden', 'a barber including another barber''s booking id is forbidden'
);
reset role;
select is((select count(*)::int from public.bookings where id = '4b000000-0000-0000-0000-0000000000a1'), 1,
  'the barber''s own id in the rejected batch is NOT deleted');
select is((select count(*)::int from public.bookings where id = '4b000000-0000-0000-0000-0000000000b1'), 1,
  'the other barber''s id in the rejected batch is NOT deleted');

-- =============================================================================================
-- a BARBER deleting their OWN upcoming confirmed booking -> has_upcoming; nothing deleted.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','40000000-0000-0000-0000-000000000002')::text, true);
select is(
  public.admin_delete_bookings(array['4b000000-0000-0000-0000-0000000000a2']::uuid[]) ->> 'error',
  'has_upcoming', 'deleting an upcoming confirmed booking is blocked (has_upcoming)'
);
reset role;
select is((select count(*)::int from public.bookings where id = '4b000000-0000-0000-0000-0000000000a2'), 1,
  'the upcoming booking is NOT deleted');

-- =============================================================================================
-- a BARBER deleting their OWN past booking -> ok, count=1; its review survives detached.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','40000000-0000-0000-0000-000000000002')::text, true);
select set_config('test.d09a',
  public.admin_delete_bookings(array['4b000000-0000-0000-0000-0000000000a1']::uuid[])::text, true);
select is((current_setting('test.d09a')::jsonb) ->> 'ok',    'true', 'a barber deleting their own past booking -> ok:true');
select is((current_setting('test.d09a')::jsonb) ->> 'count', '1',    'the delete reports count = 1');
reset role;
select is((select count(*)::int from public.bookings where id = '4b000000-0000-0000-0000-0000000000a1'), 0,
  'the barber''s own past booking is deleted');
select is(
  (select count(*)::int from public.reviews
     where id = '4c000000-0000-0000-0000-000000000001' and booking_id is null),
  1, 'the deleted booking''s review survives with booking_id NULL'
);

-- =============================================================================================
-- the OWNER may delete ANY bookings (a different barber's past + a cancelled) -> ok, count=2.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','40000000-0000-0000-0000-000000000001')::text, true);
select set_config('test.d09o',
  public.admin_delete_bookings(array['4b000000-0000-0000-0000-0000000000b1',
                                     '4b000000-0000-0000-0000-0000000000a3']::uuid[])::text, true);
select is((current_setting('test.d09o')::jsonb) ->> 'ok',    'true', 'the owner deleting any bookings -> ok:true');
select is((current_setting('test.d09o')::jsonb) ->> 'count', '2',    'the owner delete reports count = 2');
reset role;
select is((select count(*)::int from public.bookings where id = '4b000000-0000-0000-0000-0000000000b1'), 0,
  'the other barber''s past booking is deleted by the owner');
select is((select count(*)::int from public.bookings where id = '4b000000-0000-0000-0000-0000000000a3'), 0,
  'the cancelled booking is deleted by the owner');

select * from finish();
rollback;
