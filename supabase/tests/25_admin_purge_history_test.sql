-- pgTAP — admin_purge_history RPC (migration 20260718150200). SECURITY DEFINER; owner-only. Proves:
--   anon    -> no EXECUTE grant (catalog: has_function_privilege = false)
--   barber  -> forbidden (only the owner may purge), and nothing is deleted
--   owner   -> deletes every cancelled + past-confirmed booking and PRESERVES upcoming confirmed ones,
--              reporting the exact deleted count; a second purge is a no-op (count=0)
-- Identity stubbed as 06_admin_cancel_booking (auth.users + profiles + set local role + jwt claims).
-- admin_purge_history deletes across the WHOLE bookings table, so this test first clears bookings to
-- make the surviving / deleted counts deterministic (everything is inside the BEGIN/ROLLBACK txn).
--
-- NOTE (mirrors 07's header): this suite was NOT executed here — the local Supabase/Docker stack is
-- down in this environment. Assertions are written against the migration's contract; the parent runs
-- `supabase test db` to verify. anon lockout is asserted against the catalog (has_function_privilege).

begin;
select plan(9);

-- Deterministic slate: purge is global, so start from an empty bookings table (txn-local).
delete from public.bookings;

insert into public.barbers (id, name) values ('purgeb','Purge Barber');
insert into auth.users (id, email) values
  ('50000000-0000-0000-0000-000000000001','owner@pg.local'),
  ('50000000-0000-0000-0000-000000000002','purgeb@pg.local');
insert into public.profiles (id, role, barber_id) values
  ('50000000-0000-0000-0000-000000000001','owner',  null),
  ('50000000-0000-0000-0000-000000000002','barber','purgeb');

-- p1 past confirmed, p2 cancelled, p3 upcoming confirmed (survives), p4 past confirmed (distinct day
-- so the two past-confirmed rows for the same barber do not trip the no-overlap exclusion constraint).
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, cancelled_at)
values
  ('5b000000-0000-0000-0000-000000000001','purgeb','h','Hår',350,45,
   '2020-01-01 09:00+00','2020-01-01 09:45+00','Past One','phone','0701110001',null,'sv','confirmed',null),
  ('5b000000-0000-0000-0000-000000000002','purgeb','h','Hår',350,45,
   '2020-01-01 11:00+00','2020-01-01 11:45+00','Cancelled','phone','0701110002',null,'sv','cancelled','2019-12-20 10:00+00'),
  ('5b000000-0000-0000-0000-000000000003','purgeb','h','Hår',350,45,
   '2099-01-01 09:00+00','2099-01-01 09:45+00','Upcoming','phone','0701110003',null,'sv','confirmed',null),
  ('5b000000-0000-0000-0000-000000000004','purgeb','h','Hår',350,45,
   '2020-01-02 09:00+00','2020-01-02 09:45+00','Past Two','phone','0701110004',null,'sv','confirmed',null);

-- =============================================================================================
-- anon has no EXECUTE grant (catalog check); barber -> forbidden (and nothing deleted).
-- =============================================================================================
select ok(
  not has_function_privilege('anon', 'public.admin_purge_history()', 'EXECUTE'),
  'admin_purge_history: anon has no execute'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','50000000-0000-0000-0000-000000000002')::text, true);
select is(public.admin_purge_history() ->> 'error', 'forbidden', 'a barber (non-owner) cannot purge history');
reset role;
select is((select count(*)::int from public.bookings), 4, 'the barber''s forbidden purge deleted nothing');

-- =============================================================================================
-- owner purges: the 3 history rows go, the 1 upcoming confirmed survives.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','50000000-0000-0000-0000-000000000001')::text, true);
select set_config('test.p10', public.admin_purge_history()::text, true);
select is((current_setting('test.p10')::jsonb) ->> 'ok',    'true', 'owner purge -> ok:true');
select is((current_setting('test.p10')::jsonb) ->> 'count', '3',    'purge deletes exactly the 3 non-live rows');
reset role;

select is((select count(*)::int from public.bookings), 1,
  'exactly one booking survives the purge');
select is((select count(*)::int from public.bookings where id = '5b000000-0000-0000-0000-000000000003'), 1,
  'the surviving booking is the upcoming confirmed one');
select is(
  (select count(*)::int from public.bookings
     where id in ('5b000000-0000-0000-0000-000000000001',
                  '5b000000-0000-0000-0000-000000000002',
                  '5b000000-0000-0000-0000-000000000004')),
  0, 'the past-confirmed and cancelled rows are all gone'
);

-- A second purge finds only the upcoming booking -> deletes nothing.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','50000000-0000-0000-0000-000000000001')::text, true);
select is(public.admin_purge_history() ->> 'count', '0', 'a second purge is a no-op (count=0)');
reset role;

select * from finish();
rollback;
