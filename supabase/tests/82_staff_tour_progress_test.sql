-- pgTAP: staff tutorial progress (migration 20261111120000).
begin;
select plan(50);

-- ---- structure and privileges ----------------------------------------------------------------
select has_table('public', 'staff_tour_progress', 'the tutorial progress table exists');
select ok((select relrowsecurity from pg_catalog.pg_class
  where oid = 'public.staff_tour_progress'::regclass), 'the progress table has RLS enabled');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_policy
  where polrelid = 'public.staff_tour_progress'::regclass), 0, 'the progress table has no policy');
select is((select pg_catalog.array_agg(
    a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod)
      || ':' || a.attnotnull::text order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.staff_tour_progress'::regclass and a.attnum > 0 and not a.attisdropped),
  array['profile_id:uuid:true', 'seen:text[]:true', 'removed:boolean:true',
        'updated_at:timestamp with time zone:true'],
  'the progress table has exactly these columns, none of them nullable');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.staff_tour_progress'::regclass and not t.tgisinternal), 0,
  'no trigger is attached to the progress table, so the admin log does not record it');
select is((select pg_catalog.count(*)::int
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role),
       pg_catalog.unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references',
                               'trigger', 'maintain']) as p(privilege)
  where pg_catalog.has_table_privilege(r.api_role::name, 'public.staff_tour_progress',
          p.privilege)), 0,
  'no API role holds any privilege on the progress table');
select is(pg_catalog.pg_get_function_result('public.own_staff_tour_progress()'::regprocedure),
  'TABLE(seen text[], removed boolean)', 'the read returns the columns seen and removed');
select is(pg_catalog.pg_get_function_arguments(
    'public.set_own_staff_tour_progress(text[],boolean)'::regprocedure)
  || ' -> ' || pg_catalog.pg_get_function_result(
    'public.set_own_staff_tour_progress(text[],boolean)'::regprocedure),
  'p_seen text[], p_removed boolean -> void',
  'the write takes p_seen and p_removed and returns nothing');
select ok((select pg_catalog.bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
  from pg_catalog.pg_proc p
  where p.oid in ('public.own_staff_tour_progress()'::regprocedure,
                  'public.set_own_staff_tour_progress(text[],boolean)'::regprocedure)),
  'both functions are security definer with an empty search path');
select is((select p.provolatile::text from pg_catalog.pg_proc p
  where p.oid = 'public.own_staff_tour_progress()'::regprocedure), 's', 'the read is stable');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.own_staff_tour_progress()', 'execute'), 'anon cannot call the read');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.set_own_staff_tour_progress(text[],boolean)', 'execute'), 'anon cannot call the write');
select ok((select pg_catalog.bool_and(p.proacl is not null
    and not exists (select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee = 0))
  from pg_catalog.pg_proc p
  where p.oid in ('public.own_staff_tour_progress()'::regprocedure,
                  'public.set_own_staff_tour_progress(text[],boolean)'::regprocedure)),
  'PUBLIC has no execute on either function');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.own_staff_tour_progress()', 'execute'), 'a staff session may call the read');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.set_own_staff_tour_progress(text[],boolean)', 'execute'),
  'a staff session may call the write');
select ok(not pg_catalog.has_function_privilege('service_role',
    'public.own_staff_tour_progress()', 'execute')
  and not pg_catalog.has_function_privilege('service_role',
    'public.set_own_staff_tour_progress(text[],boolean)', 'execute'),
  'the service role can call neither function');

-- ---- fixtures ---------------------------------------------------------------------------------
insert into public.barbers (id, name) values ('tour-a', 'Tour A'), ('tour-b', 'Tour B');
insert into auth.users (id, email) values
  ('82000000-0000-4000-8000-000000000001', 'barber-a@tour.local'),
  ('82000000-0000-4000-8000-000000000002', 'barber-b@tour.local'),
  ('82000000-0000-4000-8000-000000000009', 'no-profile@tour.local');
insert into public.profiles (id, role, barber_id, account_enabled, must_change_password) values
  ('82000000-0000-4000-8000-000000000001', 'barber', 'tour-a', true, false),
  ('82000000-0000-4000-8000-000000000002', 'barber', 'tour-b', true, false);

-- ---- no session or the service role: refused --------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.own_staff_tour_progress()$$, '42501', null,
  'anon is refused the read');
select throws_ok($$select public.set_own_staff_tour_progress(array['overview'], false)$$,
  '42501', null, 'anon is refused the write');
select throws_ok($$select * from public.staff_tour_progress$$, '42501', null,
  'anon cannot select the table');
reset role;
set local role service_role;
select throws_ok($$select * from public.own_staff_tour_progress()$$, '42501', null,
  'the service role is refused the read');
select throws_ok($$select public.set_own_staff_tour_progress(array['overview'], false)$$,
  '42501', null, 'the service role is refused the write');
select throws_ok($$select * from public.staff_tour_progress$$, '42501', null,
  'the service role cannot select the table');
reset role;

-- ---- barber A: reads and writes only through the two functions --------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '82000000-0000-4000-8000-000000000001')::text, true);
select is((select pg_catalog.count(*)::int from public.own_staff_tour_progress()), 0,
  'a barber who never saved progress reads no row');
select throws_ok($$select * from public.staff_tour_progress$$, '42501', null,
  'a barber cannot select the table');
select throws_ok($$insert into public.staff_tour_progress (profile_id)
  values ('82000000-0000-4000-8000-000000000001')$$, '42501', null,
  'a barber cannot write the table directly');
select lives_ok($$select public.set_own_staff_tour_progress(array['overview'], false)$$,
  'a barber saves the overview as seen');
select results_eq($$select * from public.own_staff_tour_progress()$$,
  $$values (array['overview'], false)$$, 'the barber reads back exactly the saved progress');
select lives_ok($$select public.set_own_staff_tour_progress('{}'::text[], false)$$,
  'a barber resets the progress, as a replay does');
select results_eq($$select * from public.own_staff_tour_progress()$$,
  $$values ('{}'::text[], false)$$, 'the reset progress reads back empty and not removed');
reset role;
update public.staff_tour_progress set updated_at = pg_catalog.now() - interval '1 day'
where profile_id = '82000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.set_own_staff_tour_progress(array['overview', 'schedule'], true)$$,
  'a barber saves other progress');
select results_eq($$select * from public.own_staff_tour_progress()$$,
  $$values (array['overview', 'schedule'], true)$$, 'the barber reads back the new progress');
reset role;
select results_eq($$select seen, removed, updated_at = pg_catalog.now()
  from public.staff_tour_progress where profile_id = '82000000-0000-4000-8000-000000000001'$$,
  $$values (array['overview', 'schedule'], true, true)$$,
  'every write updated the one row of the barber and stamped it with the time of the write');

-- ---- the table's own constraints refuse a bad write -------------------------------------------
set local role authenticated;
select throws_ok($$select public.set_own_staff_tour_progress(array['nope'], false)$$,
  '23514', null, 'an unknown tour id is refused');
select throws_ok($$select public.set_own_staff_tour_progress(
  array['overview', 'overview', 'overview', 'overview', 'overview', 'overview'], false)$$,
  '23514', null, 'more than five entries are refused');
select throws_ok($$select public.set_own_staff_tour_progress(array['overview', null], false)$$,
  '23514', null, 'a missing tour id is refused');
select throws_ok($$select public.set_own_staff_tour_progress('{{overview}}'::text[], false)$$,
  '23514', null, 'a nested list is refused');
select throws_ok($$select public.set_own_staff_tour_progress(null, false)$$,
  '23502', null, 'a missing seen list is refused');
select throws_ok($$select public.set_own_staff_tour_progress(array['overview'], null)$$,
  '23502', null, 'a missing removed flag is refused');
select results_eq($$select * from public.own_staff_tour_progress()$$,
  $$values (array['overview', 'schedule'], true)$$, 'no refused write changed the progress');

-- ---- barber B: cannot see or change the row of barber A ----------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '82000000-0000-4000-8000-000000000002')::text, true);
select is((select pg_catalog.count(*)::int from public.own_staff_tour_progress()), 0,
  'another barber reads no row while the first barber has one');
select lives_ok($$select public.set_own_staff_tour_progress(array['bookings'], false)$$,
  'another barber saves progress');
select results_eq($$select * from public.own_staff_tour_progress()$$,
  $$values (array['bookings'], false)$$, 'another barber reads back only their own progress');
reset role;
select results_eq($$select profile_id, seen, removed from public.staff_tour_progress
  where profile_id in ('82000000-0000-4000-8000-000000000001',
                       '82000000-0000-4000-8000-000000000002')
  order by profile_id$$,
  $$values ('82000000-0000-4000-8000-000000000001'::uuid, array['overview', 'schedule'], true),
           ('82000000-0000-4000-8000-000000000002'::uuid, array['bookings'], false)$$,
  'the second barber''s write added their own row and left the first barber''s row unchanged');

-- ---- a user without a staff profile, and no user at all ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '82000000-0000-4000-8000-000000000009')::text, true);
select is((select pg_catalog.count(*)::int from public.own_staff_tour_progress()), 0,
  'a signed-in user without a profile reads no row');
select throws_ok($$select public.set_own_staff_tour_progress(array['overview'], false)$$,
  '23503', null, 'a signed-in user without a profile cannot store progress');
select set_config('request.jwt.claims', '', true);
select is((select pg_catalog.count(*)::int from public.own_staff_tour_progress()), 0,
  'without a signed-in user the read returns no row');
select throws_ok($$select public.set_own_staff_tour_progress(array['overview'], false)$$,
  '42501', 'sign-in required', 'without a signed-in user the write is refused');
reset role;
select is((select pg_catalog.count(*)::int from public.staff_tour_progress
  where profile_id = '82000000-0000-4000-8000-000000000009'), 0,
  'the refused writes stored nothing');

-- ---- deleting the profile deletes its progress -------------------------------------------------
delete from public.profiles where id = '82000000-0000-4000-8000-000000000001';
select is((select pg_catalog.count(*)::int from public.staff_tour_progress
  where profile_id = '82000000-0000-4000-8000-000000000001'), 0,
  'deleting a profile deletes its progress');
select is((select pg_catalog.count(*)::int from public.staff_tour_progress
  where profile_id = '82000000-0000-4000-8000-000000000002'), 1,
  'the progress of another profile stays');

select * from finish();
rollback;
