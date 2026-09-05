-- pgTAP — retire the superseded taken_slots RPC while preserving authoritative availability.

begin;
select plan(5);

insert into public.barbers (id, name)
values ('taken-retire', 'Taken Retire');
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
values ('taken-retire', 1, true, 540, 600);

select ok(
  pg_catalog.to_regprocedure(
    'public.taken_slots(text,timestamp with time zone,timestamp with time zone)'
  ) is null,
  'the exact superseded taken_slots signature is absent'
);
select ok(
  pg_catalog.to_regprocedure('public.available_slots(text,date,integer)') is not null,
  'the authoritative available_slots signature remains present'
);
select ok(
  pg_catalog.has_function_privilege(
    'anon',
    'public.available_slots(text,date,integer)',
    'execute'
  ),
  'anon retains execute on authoritative availability'
);

set local role anon;
select is(
  (
    select pg_catalog.array_agg(slot order by slot)
    from public.available_slots('taken-retire', date '2099-01-05', 30) as slot
  ),
  array['09:00', '09:15', '09:30']::text[],
  'available_slots still returns the expected bookable starts'
);
reset role;

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'taken_slots'
  ),
  'no taken_slots overload remains in public'
);
select * from finish();
rollback;
