-- pgTAP — the edge functions' DB primitives. The submit-booking gateway (PLAN §3): the
-- booking_attempts ledger + recent_booking_count_by_phone counter. The transactional email bridge:
-- booking_confirmation_details. All are reached AS service_role through PostgREST; with
-- auto_expose_new_tables OFF, the grants below are what make that work — and what keep anon/authenticated
-- (and even service_role, for the PII bookings table) on the RPC-only path. (The end-to-end behavior of
-- both functions is verified separately via curl.)

begin;
select plan(15);

-- booking_attempts: gateway-only ledger. service_role has EXACTLY the DML the edge fn performs; the
-- public Data API roles get nothing (RLS enabled, no policy, no grant).
select ok(
  pg_catalog.has_table_privilege('service_role', 'public.booking_attempts', 'select'),
  'service_role can SELECT booking_attempts (windowed count)'
);
select ok(
  pg_catalog.has_table_privilege('service_role', 'public.booking_attempts', 'insert'),
  'service_role can INSERT booking_attempts (record attempt)'
);
select ok(
  pg_catalog.has_table_privilege('service_role', 'public.booking_attempts', 'delete'),
  'service_role can DELETE booking_attempts (opportunistic prune)'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.booking_attempts', 'select'),
  'anon canNOT SELECT booking_attempts'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.booking_attempts', 'insert'),
  'anon canNOT INSERT booking_attempts'
);

-- recent_booking_count_by_phone: definer counter, service_role-only (bookings stays RPC-gated PII).
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.recent_booking_count_by_phone(text, timestamptz)', 'execute'),
  'service_role can execute recent_booking_count_by_phone'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.recent_booking_count_by_phone(text, timestamptz)', 'execute'),
  'anon canNOT execute recent_booking_count_by_phone'
);

-- Functional: it counts only the given phone's bookings within the window.
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('hassan','h','Hår',350,45, now() + interval '5 days', now() + interval '5 days' + interval '45 minutes',
   'Count One','phone','0706660000', null,'sv'),
  ('hassan','h','Hår',350,45, now() + interval '6 days', now() + interval '6 days' + interval '45 minutes',
   'Count Two','phone','0706660000', null,'sv');
select is(
  public.recent_booking_count_by_phone('0706660000', now() - interval '1 hour'),
  2, 'recent_booking_count_by_phone counts this phone''s recent bookings (2)'
);

-- booking_confirmation_details: the email webhook read, service_role-only (bookings stays RPC-gated
-- PII — service_role has no direct SELECT on it). Returns recipient/content fields and authoritative status.
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.booking_confirmation_details(uuid)', 'execute'),
  'service_role can execute booking_confirmation_details'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.booking_confirmation_details(uuid)', 'execute'),
  'anon canNOT execute booking_confirmation_details'
);

with ins as (
  insert into public.bookings
    (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
     customer_name, method, phone, email, lang)
  values
    ('hassan','h','Hår',350,45, now() + interval '7 days', now() + interval '7 days' + interval '45 minutes',
     'Test Person','phone','0705550000', null,'sv')
  returning id
)
select set_config('test.cid', (select id::text from ins), true);

select is(
  public.booking_confirmation_details(current_setting('test.cid')::uuid) ->> 'phone',
  '0705550000', 'booking_confirmation_details returns the booking phone'
);
select is(
  public.booking_confirmation_details(current_setting('test.cid')::uuid) ->> 'barber_name',
  'Hassan', 'booking_confirmation_details joins the barber display name'
);
select is(
  public.booking_confirmation_details(current_setting('test.cid')::uuid) ->> 'status',
  'confirmed', 'booking_confirmation_details returns authoritative booking status'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and t.tgname = 'booking_cancellation_on_update'
      and not t.tgisinternal
  ),
  'confirmed to cancelled updates queue cancellation email'
);
select ok(
  public.booking_confirmation_details('00000000-0000-0000-0000-000000000000'::uuid) is null,
  'an unknown booking id returns null (-> recipient_not_found)'
);

select * from finish();
rollback;
