-- pgTAP - current booking RPC contract. Public browsers use Edge Function gateways; service_role
-- owns privileged RPC execution. Services are server-authoritative and selected by UUID.

begin;
select plan(34);

insert into public.barber_time_off (barber_id, start_date, end_date, reason)
values ('victor', date '2040-03-20', date '2040-03-20', 'pgtap');

select set_config(
  'test.hassan_service',
  (select id::text from public.services where barber_id = 'hassan' and active order by sort_order limit 1),
  true
);
select set_config(
  'test.victor_service',
  (select id::text from public.services where barber_id = 'victor' and active order by sort_order limit 1),
  true
);
select set_config(
  'test.hassan_service_name',
  (select name from public.services where id::text = current_setting('test.hassan_service')),
  true
);

insert into public.bookings (
  id, barber_id, service_id, service_name, price, duration_min,
  start_at, end_at, customer_name, method, phone, email, lang
)
select
  '93000000-0000-0000-0000-000000000001',
  'hassan', s.id::text, s.name, s.price, s.duration_min,
  timestamptz '2020-03-14T12:30:00Z',
  timestamptz '2020-03-14T12:30:00Z' + pg_catalog.make_interval(mins => s.duration_min),
  'Historisk Kund', 'email', '0709999999', 'historical@example.test', 'sv'
from public.services s
where s.id::text = current_setting('test.hassan_service');

insert into public.bookings (
  id, barber_id, service_id, service_name, price, duration_min,
  start_at, end_at, customer_name, method, phone, email, lang
)
select
  '93000000-0000-0000-0000-000000000002',
  'hassan', s.id::text, s.name, s.price, s.duration_min,
  pg_catalog.now() + interval '1 hour',
  pg_catalog.now() + interval '1 hour' + pg_catalog.make_interval(mins => s.duration_min),
  'Sen Kund', 'email', '0708888888', 'late-cancel@example.test', 'sv'
from public.services s
where s.id::text = current_setting('test.hassan_service');

set local role service_role;

select set_config(
  'test.created',
  public.create_booking(
    'hassan', current_setting('test.hassan_service'),
    timestamptz '2040-03-14T12:30:00Z',
    '0701234567', 'customer@example.test', 'sv', 'Test Kund'
  )::text,
  true
);

select is((current_setting('test.created')::jsonb)->>'ok', 'true', 'valid booking succeeds');
select isnt((current_setting('test.created')::jsonb)->'booking'->>'id', null, 'booking id returned');
select is(
  (current_setting('test.created')::jsonb)->'booking'->>'barber_id',
  'hassan',
  'barber id returned'
);
select ok(
  not ((current_setting('test.created')::jsonb->'booking') ? 'phone')
    and not ((current_setting('test.created')::jsonb->'booking') ? 'email'),
  'contact data never echoed'
);
select is(
  (current_setting('test.created')::jsonb)->'booking'->>'service_name',
  current_setting('test.hassan_service_name'),
  'service name is server-authoritative'
);

select is(
  public.create_booking(
    'hassan', current_setting('test.hassan_service'), timestamptz '2040-03-14T12:30:00Z',
    '0707654321', 'overlap@example.test', 'sv', 'Krock Kund'
  )->>'error',
  'slot_taken',
  'overlap rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), now() - interval '1 day',
    '0701234567', 'past@example.test', 'sv', 'Dåtid Kund'
  )->>'error',
  'invalid_time',
  'past start rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-14T12:07:00Z',
    '0701234567', 'off-grid@example.test', 'sv', 'Fel Grid'
  )->>'error',
  'invalid_time',
  'off-grid minute rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-14T12:15:30Z',
    '0701234567', 'seconds@example.test', 'sv', 'Fel Sekund'
  )->>'error',
  'invalid_time',
  'non-zero seconds rejected'
);
reset role;
select is(
  (select pg_catalog.count(*)::int from public.bookings
   where email in ('off-grid@example.test', 'seconds@example.test')),
  0,
  'invalid grid timestamps are not persisted'
);
set local role service_role;
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-15T06:00:00Z',
    '0701234567', 'early@example.test', 'sv', 'Tidig Kund'
  )->>'error',
  'outside_hours',
  'before opening rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-18T12:30:00Z',
    '0701234567', 'sunday@example.test', 'sv', 'Söndag Kund'
  )->>'error',
  'outside_hours',
  'closed weekday rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-20T12:30:00Z',
    '0701234567', 'off@example.test', 'sv', 'Ledig Kund'
  )->>'error',
  'outside_hours',
  'time off rejected'
);
select is(
  public.create_booking(
    'ghost', current_setting('test.hassan_service'), timestamptz '2040-03-14T12:30:00Z',
    '0701234567', 'ghost@example.test', 'sv', 'Spöke Kund'
  )->>'error',
  'invalid',
  'unknown barber rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-14T12:30:00Z',
    null, 'missing-phone@example.test', 'sv', 'Ingen Telefon'
  )->>'error',
  'invalid_contact',
  'missing phone rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-14T12:30:00Z',
    '0701234567', null, 'sv', 'Ingen E-post'
  )->>'error',
  'invalid_contact',
  'missing email rejected'
);
select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-14T12:30:00Z',
    '0701234567', 'lang@example.test', 'de', 'Fel Språk'
  )->>'error',
  'invalid',
  'unsupported language rejected'
);

reset role;
update public.barbers set active = false where id = 'victor';
set local role service_role;

select is(
  public.create_booking(
    'victor', current_setting('test.victor_service'), timestamptz '2040-03-14T12:30:00Z',
    '0701234567', 'hidden@example.test', 'sv', 'Dold Barberare'
  )->>'error',
  'invalid',
  'inactive barber cannot receive a crafted booking'
);
reset role;
set local role anon;
select is(
  (select pg_catalog.count(*)::int
   from public.available_slots('victor', date '2040-03-14', 45)),
  0,
  'inactive barber exposes no available slots'
);

reset role;
update public.barbers set active = true where id = 'victor';

select is(
  pg_catalog.has_function_privilege(
    'anon', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'execute'
  ),
  false,
  'anon cannot create directly'
);
select is(
  pg_catalog.has_function_privilege(
    'service_role', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'execute'
  ),
  true,
  'service role can create'
);
select is(
  pg_catalog.has_function_privilege('anon', 'public.lookup_booking(text)', 'execute'),
  false,
  'anon cannot lookup directly'
);

set local role service_role;

select set_config('test.looked', public.lookup_booking('0701234567')::text, true);
select is((current_setting('test.looked')::jsonb)->>'ok', 'true', 'service lookup succeeds');
select is(
  (current_setting('test.looked')::jsonb)->'booking'->>'barber_id',
  'hassan',
  'lookup returns matching booking'
);
select is(
  (current_setting('test.looked')::jsonb)->'booking'->>'method',
  'email',
  'lookup returns persisted delivery method'
);
select set_config(
  'test.bid',
  (current_setting('test.looked')::jsonb)->'booking'->>'id',
  true
);
select is(public.lookup_booking('0700000000')->>'error', 'not_found', 'wrong phone is generic');
select is(
  pg_catalog.to_regprocedure('public.cancel_booking(uuid,text)') is null,
  true,
  'legacy cancel_booking signature is removed'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.cancel_customer_booking_with_access(uuid,text)', 'execute'
  ),
  'service role can cancel through the access-scoped replacement'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.cancel_customer_booking_with_access(uuid,text)', 'execute'
  ),
  'anon cannot call access-scoped cancellation directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.cancel_customer_booking_with_access(uuid,text)', 'execute'
  ),
  'authenticated cannot call access-scoped cancellation directly'
);
select is(
  pg_catalog.to_regprocedure('public.create_review(text,integer,text)') is null,
  true,
  'legacy create_review signature is removed'
);

reset role;

select is(
  (select status from public.bookings where id = '93000000-0000-0000-0000-000000000001'),
  'confirmed',
  'rejected past cancellation leaves booking unchanged'
);
select is(
  (select status from public.bookings where id = '93000000-0000-0000-0000-000000000002'),
  'confirmed',
  'rejected late cancellation leaves booking unchanged'
);

select is(
  (select customer_name from public.bookings where id = current_setting('test.bid')::uuid),
  'Test Kund',
  'customer name persisted correctly'
);

select * from finish();
rollback;
