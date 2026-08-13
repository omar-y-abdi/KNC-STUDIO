begin;
select plan(26);

select has_table('public', 'booking_email_delivery_jobs', 'booking email delivery job table exists');
select ok(
  (select c.relrowsecurity
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'booking_email_delivery_jobs'),
  'booking email delivery jobs have RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.booking_email_delivery_jobs', 'select'),
  'service role cannot read delivery jobs directly'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booking_email_delivery_jobs'
      and column_name in ('email', 'phone', 'customer_name')
  ),
  'delivery jobs contain no customer contact fields'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.booking_email_delivery_for_dispatch(uuid)', 'execute'),
  'service role can read a dispatching delivery job through the narrow RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.complete_booking_email_delivery(uuid,text)', 'execute'),
  'service role can complete a delivery job through the narrow RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.fail_booking_email_delivery(uuid,text)', 'execute'),
  'service role can retry a failed delivery job through the narrow RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.mark_booking_email_delivery_recipient(uuid,text)', 'execute'),
  'service role can persist a delivered recipient through the narrow RPC'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.booking_email_delivery_for_dispatch(uuid)', 'execute'),
  'anon cannot read delivery jobs'
);
select ok(
  not pg_catalog.has_function_privilege(
    'service_role', 'public.queue_booking_email_delivery()', 'execute'),
  'service role cannot invoke the trigger function directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'service_role', 'public.queue_due_booking_email_deliveries()', 'execute'),
  'service role cannot invoke the cron dispatcher directly'
);
select ok(
  exists (select 1 from cron.job where jobname = 'booking-email-delivery-dispatch'),
  'one-minute booking email dispatcher is scheduled'
);
select ok(
  exists (select 1 from cron.job where jobname = 'booking-email-delivery-cleanup'),
  'terminal booking email delivery cleanup is scheduled'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and t.tgname = 'booking_email_delivery_on_insert'
      and not t.tgisinternal
  ),
  'booking insert queues durable email delivery'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and t.tgname = 'booking_email_delivery_on_status_change'
      and not t.tgisinternal
  ),
  'booking cancellation queues durable email delivery'
);

insert into public.barbers (id, name)
values ('hassan', 'Hassan')
on conflict (id) do nothing;

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, created_at)
values
  ('30000000-0000-0000-0000-000000000001', 'hassan', 'h', 'Hår', 350, 45,
   '2096-01-02 09:00+00', '2096-01-02 09:45+00',
   'Delivery Job', 'email', '0703000001', 'delivery@example.com', 'sv',
   '2096-01-01 00:00+00');

select is(
  (select event from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'),
  'booking_confirmed',
  'new booking gets a confirmation delivery job'
);
select is(
  (select status from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_confirmed'),
  'pending',
  'new confirmation job remains pending until the dispatcher invokes it'
);

update public.booking_email_delivery_jobs
set status = 'dispatching', attempt_count = 1, last_attempt_at = pg_catalog.now()
where booking_id = '30000000-0000-0000-0000-000000000001'
  and event = 'booking_confirmed';

select is(
  (select public.booking_email_delivery_for_dispatch(id)->>'event'
   from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_confirmed'),
  'booking_confirmed',
  'dispatcher can resolve a dispatching confirmation job'
);
select ok(
  public.fail_booking_email_delivery(
    (select id from public.booking_email_delivery_jobs
     where booking_id = '30000000-0000-0000-0000-000000000001'
       and event = 'booking_confirmed'),
    'not_configured'
  ),
  'missing mail configuration requeues the delivery'
);
select is(
  (select status from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_confirmed'),
  'pending',
  'failed confirmation returns to pending state'
);
select is(
  (select last_error_code from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_confirmed'),
  'not_configured',
  'retry state stores only a safe error code'
);

update public.bookings
set status = 'cancelled',
    cancelled_at = pg_catalog.now()
where id = '30000000-0000-0000-0000-000000000001';

select is(
  (select event from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_cancelled'),
  'booking_cancelled',
  'cancellation gets its own delivery job'
);
update public.booking_email_delivery_jobs
set status = 'dispatching', attempt_count = 1, last_attempt_at = pg_catalog.now()
where booking_id = '30000000-0000-0000-0000-000000000001'
  and event = 'booking_cancelled';

select ok(
  public.mark_booking_email_delivery_recipient(
    (select id from public.booking_email_delivery_jobs
     where booking_id = '30000000-0000-0000-0000-000000000001'
       and event = 'booking_cancelled'),
    'customer'
  ),
  'a successful recipient send is durably recorded'
);
select is(
  (select sent_kinds from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_cancelled'),
  array['customer']::text[],
  'retry state retains the sent recipient'
);
select ok(
  public.complete_booking_email_delivery(
    (select id from public.booking_email_delivery_jobs
     where booking_id = '30000000-0000-0000-0000-000000000001'
       and event = 'booking_cancelled'),
    'delivered'
  ),
  'successful delivery reaches a terminal state'
);
select is(
  (select status from public.booking_email_delivery_jobs
   where booking_id = '30000000-0000-0000-0000-000000000001'
     and event = 'booking_cancelled'),
  'delivered',
  'completed cancellation does not remain eligible for retry'
);

select * from finish();
rollback;
