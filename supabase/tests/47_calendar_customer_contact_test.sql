-- pgTAP — Calendar receives the authorized customer details from the database-owned booking and
-- durable dispatch contracts. OAuth credentials stay in the server-side dispatch context; the
-- Google event body is covered by tests/unit/calendarSync.test.ts.

begin;
select plan(15);

select ok(
  has_function_privilege(
    'service_role',
    'public.external_action_for_dispatch(uuid, uuid)',
    'execute'
  ),
  'service_role can resolve a server-owned Calendar dispatch action'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.external_action_for_dispatch(uuid, uuid)',
    'execute'
  ),
  'anon cannot resolve a Calendar dispatch action'
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
  ('47000000-0000-4000-8000-000000000001', 'calendar-contact', 'calendar-contact-service',
   'Kontaktklippning', 399.50, 45, '2099-04-08 07:00:00+00', '2099-04-08 07:45:00+00',
   'Calendar Customer', 'email', '0701234567', 'calendar-customer@example.com', 'sv');

select set_config(
  'test.calendar_contact_job',
  public.queue_calendar_event_sync('47000000-0000-4000-8000-000000000001')::text,
  true
);

select ok(
  current_setting('test.calendar_contact_job')::uuid is not null,
  'confirmed booking with a linked calendar queues a durable sync job'
);

select set_config(
  'test.calendar_contact_dispatch',
  coalesce(
    public.claim_external_action(current_setting('test.calendar_contact_job')::uuid),
    '{}'::jsonb
  )::text,
  true
);

select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'action_type',
  'calendar_event_sync',
  'claimed dispatch action remains a Calendar sync'
);
select is(
  public.calendar_sync_source('47000000-0000-4000-8000-000000000001')->>'email',
  'calendar-customer@example.com',
  'calendar_sync_source returns the authoritative customer email'
);
select is(
  (
    select booking->>'email'
    from pg_catalog.jsonb_array_elements(
      public.calendar_backfill_source('calendar-contact')->'bookings'
    ) booking
    where booking->>'id' = '47000000-0000-4000-8000-000000000001'
  ),
  'calendar-customer@example.com',
  'calendar_backfill_source returns the authoritative customer email'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'customer_name',
  'Calendar Customer',
  'dispatch payload contains the authoritative customer name'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'phone',
  '0701234567',
  'dispatch payload contains the authorized customer phone'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'email',
  'calendar-customer@example.com',
  'dispatch payload contains the authorized customer email'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'service_name',
  'Kontaktklippning',
  'dispatch payload contains the database-owned service name'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'start_at',
  '2099-04-08T07:00:00+00:00',
  'dispatch payload contains the authoritative start time'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'end_at',
  '2099-04-08T07:45:00+00:00',
  'dispatch payload contains the authoritative end time'
);
select is(
  current_setting('test.calendar_contact_dispatch')::jsonb->>'refresh_token',
  'calendar-contact-refresh',
  'only the server-side dispatch context carries the refresh credential'
);

update public.bookings
set email = 'calendar-customer-updated@example.com'
where id = '47000000-0000-4000-8000-000000000001';

select set_config(
  'test.calendar_contact_updated_dispatch',
  coalesce(
    public.claim_external_action(current_setting('test.calendar_contact_job')::uuid),
    '{}'::jsonb
  )::text,
  true
);
select is(
  current_setting('test.calendar_contact_updated_dispatch')::jsonb->>'email',
  'calendar-customer-updated@example.com',
  'email-only booking updates requeue the current Calendar payload'
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
