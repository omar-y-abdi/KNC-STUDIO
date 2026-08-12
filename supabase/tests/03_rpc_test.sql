-- pgTAP - current booking RPC contract. Public browsers use Edge Function gateways; service_role
-- owns privileged RPC execution. Services are server-authoritative and selected by UUID.

begin;
select plan(25);

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
  public.cancel_booking(current_setting('test.bid')::uuid, '0700000000')->>'error',
  'not_found',
  'wrong cancellation contact is generic'
);
select is(
  public.cancel_booking(current_setting('test.bid')::uuid, '0701234567')->>'ok',
  'true',
  'matching contact cancels'
);
select is(
  public.cancel_booking(current_setting('test.bid')::uuid, '0701234567')->>'error',
  'not_found',
  'second cancellation is idempotent'
);

reset role;

select is(
  (select customer_name from public.bookings where id = current_setting('test.bid')::uuid),
  'Test Kund',
  'customer name persisted correctly'
);

select * from finish();
rollback;
