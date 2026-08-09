begin;
select plan(10);

select has_table('public', 'booking_reminders', 'booking_reminders table exists');
select ok(
  (select c.relrowsecurity
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'booking_reminders'),
  'booking_reminders has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.booking_reminders', 'select'),
  'service_role cannot read reminder rows directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.mark_booking_reminder_delivered(uuid)', 'execute'),
  'service_role can mark a reminder delivered through the narrow RPC'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.mark_booking_reminder_delivered(uuid)', 'execute'),
  'anon cannot mark reminders delivered'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and t.tgname = 'booking_reminder_on_insert'
      and not t.tgisinternal
  ),
  'booking insert trigger exists'
);
select ok(
  exists (select 1 from cron.job where jobname = 'booking-reminder-dispatch'),
  'one-minute reminder dispatcher is scheduled'
);

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, created_at)
values
  ('26000000-0000-0000-0000-000000000023', 'hassan', 'h', 'Hår', 350, 45,
   '2095-01-01 23:00+00', '2095-01-01 23:45+00',
   'Twenty Three Hours', 'email', '0702600023', '23h@example.com', 'sv',
   '2095-01-01 00:00+00');

select is(
  (select count(*) from public.booking_reminders
   where booking_id = '26000000-0000-0000-0000-000000000023'),
  0::bigint,
  'a booking made 23 hours before start gets no reminder'
);

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, created_at)
values
  ('26000000-0000-0000-0000-000000000024', 'hassan', 'h', 'Hår', 350, 45,
   '2095-01-02 00:00+00', '2095-01-02 00:45+00',
   'Twenty Four Hours', 'email', '0702600024', '24h@example.com', 'sv',
   '2095-01-01 00:00+00');

select is(
  (select due_at from public.booking_reminders
   where booking_id = '26000000-0000-0000-0000-000000000024'),
  '2095-01-01 00:00+00'::timestamptz,
  'a booking made 24 hours before start is due exactly one day before'
);
select ok(
  public.mark_booking_reminder_delivered('26000000-0000-0000-0000-000000000024'),
  'delivery RPC finds and marks the reminder'
);

select * from finish();
rollback;
