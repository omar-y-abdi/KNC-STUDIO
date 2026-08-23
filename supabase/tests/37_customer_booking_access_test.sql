begin;
select plan(20);

select ok(
  not has_table_privilege('anon', 'public.customer_booking_access_challenges', 'select'),
  'anon cannot read access challenges directly'
);
select ok(
  not has_table_privilege('service_role', 'public.customer_booking_access_sessions', 'select'),
  'service role cannot read access sessions directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_customer_booking_access_request(text, text, text)',
    'execute'
  ),
  'gateway role can create an access challenge'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_customer_booking_access_request(text, text, text)',
    'execute'
  ),
  'anon cannot create an access challenge directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_customer_bookings_with_access(text)',
    'execute'
  ),
  'authenticated cannot list customer history directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.cancel_customer_booking_with_access(uuid, text)',
    'execute'
  ),
  'gateway role can cancel through an access session'
);
select ok(
  exists (select 1 from cron.job where jobname = 'customer-booking-access-cleanup'),
  'expired access material has a cleanup schedule'
);

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('37000000-0000-0000-0000-000000000001', 'hassan', 'h', 'Hår', 350, 45,
   now() + interval '4 days', now() + interval '4 days 45 minutes',
   'Access A', 'email', '0703700000', 'a@example.test', 'sv', 'confirmed'),
  ('37000000-0000-0000-0000-000000000002', 'hassan', 'h', 'Hår', 350, 45,
   now() + interval '5 days', now() + interval '5 days 45 minutes',
   'Access B', 'email', '0703700000', 'b@example.test', 'sv', 'confirmed');

set local role service_role;
select ok(
  public.create_customer_booking_access_request(
    '0703700000', 'A@EXAMPLE.TEST', repeat('a', 64)
  ),
  'matching phone and email create an access link'
);
select ok(
  not public.create_customer_booking_access_request(
    '0703700000', 'unknown@example.test', repeat('b', 64)
  ),
  'unknown email cannot create an access link'
);
reset role;
select is(
  (select pg_catalog.count(*) from public.customer_booking_access_challenges),
  2::bigint,
  'matching and non-matching requests perform the same challenge write workload'
);
set local role service_role;
select ok(
  public.exchange_customer_booking_access(repeat('a', 64), repeat('c', 64)),
  'unused unexpired access link exchanges exactly once'
);
select ok(
  not public.exchange_customer_booking_access(repeat('a', 64), repeat('d', 64)),
  'used access link cannot be exchanged again'
);
select is(
  jsonb_array_length(
    public.list_customer_bookings_with_access(repeat('c', 64))->'bookings'
  ),
  1,
  'session sees only exact phone and email booking, not another customer sharing phone'
);
select is(
  public.list_customer_bookings_with_access(repeat('c', 64))->'bookings'->0->>'id',
  '37000000-0000-0000-0000-000000000001',
  'session returns matching booking only'
);
select is(
  public.cancel_customer_booking_with_access(
    '37000000-0000-0000-0000-000000000002', repeat('c', 64)
  )->>'error',
  'not_found',
  'session cannot cancel another customer sharing the phone number'
);
reset role;
select is(
  (select status from public.bookings where id = '37000000-0000-0000-0000-000000000002'),
  'confirmed',
  'other customer booking remains confirmed'
);
set local role service_role;
select is(
  public.cancel_customer_booking_with_access(
    '37000000-0000-0000-0000-000000000001', repeat('c', 64)
  )->>'ok',
  'true',
  'session cancels its own sufficiently future booking'
);
reset role;
select is(
  (select status from public.bookings where id = '37000000-0000-0000-0000-000000000001'),
  'cancelled',
  'matching customer booking is cancelled'
);
set local role service_role;
select is(
  public.list_customer_bookings_with_access(repeat('f', 64))->>'error',
  'access_denied',
  'unknown session token is rejected'
);

reset role;
update public.customer_booking_access_sessions
set expires_at = now() - interval '1 second'
where token_hash = repeat('c', 64);
set local role service_role;
select is(
  public.list_customer_bookings_with_access(repeat('c', 64))->>'error',
  'access_denied',
  'expired session token is rejected'
);
reset role;

select * from finish();
rollback;
