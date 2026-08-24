begin;
select plan(8);

select ok(
  has_function_privilege('anon', 'public.public_booking_catalog()', 'execute'),
  'anonymous frontend can load public booking catalog'
);
select ok(
  has_function_privilege('authenticated', 'public.public_booking_catalog()', 'execute'),
  'admin frontend can reuse public booking catalog'
);

insert into public.barbers
  (id, name, ig, role_sv, role_en, bio_sv, bio_en, active, sort_order)
values
  ('catalog-visible', 'Visible', 'visible', 'Barberare', 'Barber', 'Bio', 'Bio', true, 901),
  ('catalog-hidden', 'Hidden', 'hidden', 'Barberare', 'Barber', 'Bio', 'Bio', false, 900);
insert into public.services
  (id, barber_id, name, price, duration_min, active, sort_order)
values
  (gen_random_uuid(), 'catalog-visible', 'Visible service', 410, 45, true, 2),
  (gen_random_uuid(), 'catalog-visible', 'Hidden service', 420, 45, false, 1),
  (gen_random_uuid(), 'catalog-hidden', 'Hidden barber service', 430, 45, true, 1);

select is(
  (select pg_catalog.count(*)::int
   from pg_catalog.jsonb_array_elements(public.public_booking_catalog()->'barbers') row
   where row->>'id' = 'catalog-visible'),
  1,
  'catalog contains active barber'
);
select is(
  (select pg_catalog.count(*)::int
   from pg_catalog.jsonb_array_elements(public.public_booking_catalog()->'barbers') row
   where row->>'id' = 'catalog-hidden'),
  0,
  'catalog excludes inactive barber'
);
select is(
  (select pg_catalog.count(*)::int
   from pg_catalog.jsonb_array_elements(public.public_booking_catalog()->'services') row
   where row->>'name' = 'Visible service'),
  1,
  'catalog contains active service for active barber'
);
select is(
  (select pg_catalog.count(*)::int
   from pg_catalog.jsonb_array_elements(public.public_booking_catalog()->'services') row
   where row->>'name' = 'Hidden service'),
  0,
  'catalog excludes inactive service'
);
select is(
  (select pg_catalog.count(*)::int
   from pg_catalog.jsonb_array_elements(public.public_booking_catalog()->'services') row
   where row->>'name' = 'Hidden barber service'),
  0,
  'catalog excludes services owned by inactive barber'
);
select is(
  public.public_booking_catalog()->'barbers'->-1->>'id',
  'catalog-visible',
  'catalog ordering follows database sort order without frontend constants'
);

select * from finish();
rollback;
