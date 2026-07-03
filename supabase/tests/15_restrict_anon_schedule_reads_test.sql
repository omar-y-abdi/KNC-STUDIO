-- pgTAP — migration 0020: the barber schedule tables' SELECT policies must admit `authenticated`
-- but NOT `anon`. Asserted against the catalog (pg_policies), which directly reflects the policy
-- roles after the migration — no fixtures or column knowledge required. The runtime consequence
-- (anon receives zero rows) is a corollary of an enabled RLS table having no anon-facing policy, and
-- is additionally checked live post-deploy.

begin;
select plan(6);

-- barber_schedules
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'barber_schedules'
     and policyname = 'schedules_select_all' and 'anon' = any (roles)),
  0,
  'barber_schedules.schedules_select_all does NOT grant anon'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'barber_schedules'
     and policyname = 'schedules_select_all' and 'authenticated' = any (roles)),
  1,
  'barber_schedules.schedules_select_all still grants authenticated'
);

-- barber_slot_blocks
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'barber_slot_blocks'
     and policyname = 'slot_blocks_select_all' and 'anon' = any (roles)),
  0,
  'barber_slot_blocks.slot_blocks_select_all does NOT grant anon'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'barber_slot_blocks'
     and policyname = 'slot_blocks_select_all' and 'authenticated' = any (roles)),
  1,
  'barber_slot_blocks.slot_blocks_select_all still grants authenticated'
);

-- barber_time_off
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'barber_time_off'
     and policyname = 'timeoff_select_all' and 'anon' = any (roles)),
  0,
  'barber_time_off.timeoff_select_all does NOT grant anon'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'barber_time_off'
     and policyname = 'timeoff_select_all' and 'authenticated' = any (roles)),
  1,
  'barber_time_off.timeoff_select_all still grants authenticated'
);

select * from finish();
rollback;
