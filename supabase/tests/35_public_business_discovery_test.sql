begin;
select plan(14);

select ok(
  has_function_privilege('anon', 'public.public_business_discovery()', 'EXECUTE'),
  'anonymous website may read whitelisted business discovery'
);
select ok(
  has_function_privilege('authenticated', 'public.public_business_discovery()', 'EXECUTE'),
  'authenticated website may read whitelisted business discovery'
);
select ok(
  has_function_privilege('service_role', 'public.public_business_discovery()', 'EXECUTE'),
  'transactional email worker may read whitelisted business discovery'
);

update public.site_settings set value='Discovery Studio' where key='business_name';
insert into public.barbers (id, name, active, sort_order) values
  ('discovery-active', 'Active Person', true, 900),
  ('discovery-hidden', 'Hidden Person', false, 901);
insert into public.services (id, barber_id, name, price, duration_min, active, sort_order) values
  ('35000000-0000-0000-0000-000000000001', 'discovery-active', 'Visible', 375, 30, true, 1),
  ('35000000-0000-0000-0000-000000000002', 'discovery-active', 'Inactive service', 999, 30, false, 2),
  ('35000000-0000-0000-0000-000000000003', 'discovery-hidden', 'Hidden barber service', 888, 30, true, 1);
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min) values
  ('discovery-active', 1, true, 600, 900),
  ('discovery-active', 2, false, 600, 900),
  ('discovery-hidden', 1, true, 540, 1080);
insert into public.barber_calendar_tokens (barber_id, refresh_token, google_email) values
  ('discovery-active', 'refresh-secret-must-never-leak', 'private@example.test');

set local role anon;
select set_config('test.discovery', public.public_business_discovery()::text, true);
reset role;

select is(
  current_setting('test.discovery')::jsonb -> 'settings' ->> 'business_name',
  'Discovery Studio',
  'discovery reads current CMS business settings'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'barbers') row
   where row ->> 'id' = 'discovery-active'),
  1,
  'active barber is emitted once'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'barbers') row
   where row ->> 'id' = 'discovery-hidden'),
  0,
  'inactive barber is excluded'
);
select ok(
  not exists (
    select 1
    from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'barbers') row
    where row ->> 'id' = 'discovery-active'
      and (row ? 'ig' or row ? 'bio_sv' or row ? 'bio_en')
  ),
  'barber discovery exposes no profile copy beyond id and name'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'services') row
   where row ->> 'id' = '35000000-0000-0000-0000-000000000001'),
  1,
  'active service for active barber is emitted'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'services') row
   where row ->> 'id' = '35000000-0000-0000-0000-000000000002'),
  0,
  'inactive service is excluded'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'services') row
   where row ->> 'id' = '35000000-0000-0000-0000-000000000003'),
  0,
  'service belonging to inactive barber is excluded'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'schedules') row
   where row ->> 'barber_id' = 'discovery-active' and row ->> 'weekday' = '1'),
  1,
  'working schedule for active barber is emitted'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'schedules') row
   where row ->> 'barber_id' = 'discovery-active' and row ->> 'weekday' = '2'),
  0,
  'non-working schedule is excluded'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(current_setting('test.discovery')::jsonb -> 'schedules') row
   where row ->> 'barber_id' = 'discovery-hidden'),
  0,
  'inactive barber schedule is excluded'
);
select is(
  pg_catalog.strpos(current_setting('test.discovery'), 'refresh-secret-must-never-leak'),
  0,
  'Calendar OAuth refresh token never appears in public discovery'
);

select * from finish();
rollback;
