-- pgTAP — Calendar receives the authorized customer details from authoritative service-role source
-- RPCs. The durable job contains only the booking identifier; OAuth credentials and customer
-- details are resolved at dispatch/execution time. The generic customer dispatcher is not owned by
-- this contract and must remain independent.

begin;
select plan(22);

select ok(
  has_function_privilege(
    'service_role',
    'public.calendar_sync_source(uuid)',
    'execute'
  ),
  'service_role can resolve the authoritative Calendar booking source'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.calendar_sync_source(uuid)',
    'execute'
  ),
  'anon cannot resolve the authoritative Calendar booking source'
);

insert into public.barbers (id, name)
values ('calendar-contact', 'Calendar Contact')
on conflict (id) do nothing;

insert into public.barber_calendar_tokens (barber_id, refresh_token, calendar_id)
values ('calendar-contact', 'calendar-contact-refresh', 'primary');

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('47000000-0000-0000-0000-000000000001', 'calendar-contact', 'calendar-contact-service',
   'Kontaktklippning', 399.50, 45, '2099-04-08 07:00:00+00', '2099-04-08 07:45:00+00',
   'Calendar Customer', 'email', '0701234567', 'calendar-customer@example.com', 'sv');

select set_config(
  'test.calendar_contact_job',
  public.queue_calendar_event_sync('47000000-0000-0000-0000-000000000001')::text,
  true
);

select ok(
  current_setting('test.calendar_contact_job')::uuid is not null,
  'confirmed booking with a linked calendar queues a durable sync job'
);
select is(
  (
    select payload
    from public.external_action_jobs
    where id = current_setting('test.calendar_contact_job')::uuid
  ),
  pg_catalog.jsonb_build_object(
    'booking_id', '47000000-0000-0000-0000-000000000001'
  ),
  'Calendar durable payload contains only the booking identifier'
);

select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'customer_name',
  'Calendar Customer',
  'calendar_sync_source returns the authoritative customer name'
);
select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'phone',
  '0701234567',
  'calendar_sync_source returns the authorized customer phone'
);
select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'email',
  'calendar-customer@example.com',
  'calendar_sync_source returns the authorized customer email'
);
select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'service_name',
  'Kontaktklippning',
  'calendar_sync_source returns the database-owned service name'
);
select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'start_at',
  '2099-04-08T07:00:00+00:00',
  'calendar_sync_source returns the authoritative start time'
);
select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'end_at',
  '2099-04-08T07:45:00+00:00',
  'calendar_sync_source returns the authoritative end time'
);

select is(
  (
    select booking->>'customer_name'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-0000-0000-000000000001'
  ),
  'Calendar Customer',
  'calendar_backfill_source returns the authoritative customer name'
);
select is(
  (
    select booking->>'phone'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-0000-0000-000000000001'
  ),
  '0701234567',
  'calendar_backfill_source returns the authorized customer phone'
);
select is(
  (
    select booking->>'email'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-0000-0000-000000000001'
  ),
  'calendar-customer@example.com',
  'calendar_backfill_source returns the authorized customer email'
);
select is(
  (
    select booking->>'service_name'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-0000-0000-000000000001'
  ),
  'Kontaktklippning',
  'calendar_backfill_source returns the database-owned service name'
);
select is(
  (
    select booking->>'start_at'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-0000-0000-000000000001'
  ),
  '2099-04-08T07:00:00+00:00',
  'calendar_backfill_source returns the authoritative start time'
);
select is(
  (
    select booking->>'end_at'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-0000-0000-000000000001'
  ),
  '2099-04-08T07:45:00+00:00',
  'calendar_backfill_source returns the authoritative end time'
);

select is(
  pg_catalog.pg_get_functiondef(
    'public.external_action_for_dispatch(uuid, uuid)'::regprocedure
  ) like '%customer_access_email_send%',
  true,
  'the generic customer-access dispatcher remains present'
);
select is(
  pg_catalog.pg_get_functiondef(
    'public.external_action_for_dispatch(uuid, uuid)'::regprocedure
  ) not like '%calendar_sync_source%',
  true,
  'the generic dispatcher does not absorb Calendar source ownership'
);

set local role service_role;
select ok(
  public.claim_external_action(current_setting('test.calendar_contact_job')::uuid) is not null,
  'Calendar action remains claimable through the generic durable dispatcher'
);
reset role;

update public.bookings
set email = 'calendar-customer-updated@example.com'
where id = '47000000-0000-0000-0000-000000000001';

select is(
  (
    select status
    from public.external_action_jobs
    where id = current_setting('test.calendar_contact_job')::uuid
  ),
  'pending',
  'email-only booking updates requeue the Calendar action'
);
select is(
  public.calendar_sync_source('47000000-0000-0000-0000-000000000001')->>'email',
  'calendar-customer-updated@example.com',
  'Calendar execution source observes the latest customer email'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and t.tgname = 'booking_calendar_sync_on_change'
      and not t.tgisinternal
      and pg_catalog.pg_get_triggerdef(t.oid) ilike '%email%'
  ),
  'Calendar trigger treats customer email changes as sync-relevant'
);

select * from finish();
rollback;
