-- pgTAP — btree_gist is installed outside public while the authoritative booking overlap
-- constraint remains active.

begin;
select plan(6);

select is(
  (select n.nspname
   from pg_catalog.pg_extension e
   join pg_catalog.pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'btree_gist'),
  'extensions',
  'btree_gist is installed in the extensions schema'
);
select ok(
  (select e.extrelocatable
   from pg_catalog.pg_extension e
   where e.extname = 'btree_gist'),
  'btree_gist is relocatable'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_constraint c
   where c.conrelid = 'public.bookings'::regclass
     and c.contype = 'x'),
  1,
  'the bookings table retains one authoritative overlap constraint'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.bookings'::regclass
      and c.conname = 'bookings_no_overlap'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%EXCLUDE USING gist%'
  ),
  'bookings_no_overlap remains a GiST exclusion constraint'
);

insert into public.barbers (id, name)
values ('btree-gist-pgtap', 'btree_gist pgTAP');

select lives_ok(
  $$
    insert into public.bookings
      (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values
      ('48000000-0000-4000-8000-000000000001', 'btree-gist-pgtap', 'gist-test',
       'GiST test', 100, 30, '2098-04-08 07:00+00', '2098-04-08 07:30+00',
       'GiST First', 'email', '0704800001', 'gist-first@example.test', 'sv')
  $$,
  'a confirmed booking remains insertable after extension relocation'
);
select throws_ok(
  $$
    insert into public.bookings
      (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values
      ('48000000-0000-4000-8000-000000000002', 'btree-gist-pgtap', 'gist-test',
       'GiST test', 100, 30, '2098-04-08 07:15+00', '2098-04-08 07:45+00',
       'GiST Overlap', 'email', '0704800002', 'gist-overlap@example.test', 'sv')
  $$,
  '23P01', null,
  'bookings_no_overlap still rejects an overlapping confirmed booking'
);

select * from finish();
rollback;
