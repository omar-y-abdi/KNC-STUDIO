begin;
select plan(31);

select ok(not has_function_privilege('anon', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'EXECUTE'),
  'contract: anon cannot create directly');
select ok(not has_function_privilege('anon', 'public.lookup_booking(text)', 'EXECUTE'),
  'contract: anon cannot lookup directly');
select ok(not has_function_privilege('anon', 'public.list_bookings_by_phone(text)', 'EXECUTE'),
  'contract: anon cannot list directly');
select is(pg_catalog.to_regprocedure('public.cancel_booking(uuid,text)') is null, true,
  'contract: legacy cancel_booking signature is removed');
select is(pg_catalog.to_regprocedure('public.create_review(text,integer,text)') is null, true,
  'contract: legacy create_review signature is removed');

select ok(has_function_privilege('service_role', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'EXECUTE'),
  'contract: submit-booking gateway retains create access');
select ok(has_function_privilege('service_role', 'public.lookup_booking(text)', 'EXECUTE'),
  'contract: action gateway retains lookup access');
select ok(has_function_privilege('service_role', 'public.list_bookings_by_phone(text)', 'EXECUTE'),
  'contract: action gateway retains list access');
select ok(has_function_privilege('service_role', 'public.cancel_customer_booking_with_access(uuid,text)', 'EXECUTE'),
  'contract: action gateway retains access-scoped cancel access');
select ok(has_function_privilege('service_role', 'public.create_review_with_access(text,text,integer,text)', 'EXECUTE'),
  'contract: action gateway retains access-scoped review access');
select ok(has_function_privilege(
  'service_role', 'public.create_customer_booking_access_request(text,text,text)', 'EXECUTE'),
  'contract: action gateway can create email-scoped access links'
);
select ok(has_function_privilege(
  'service_role', 'public.exchange_customer_booking_access(text,text)', 'EXECUTE'),
  'contract: action gateway can exchange one-time access links'
);
select ok(has_function_privilege(
  'service_role', 'public.list_customer_bookings_with_access(text)', 'EXECUTE'),
  'contract: action gateway can list through an access session'
);
select ok(has_function_privilege(
  'service_role', 'public.cancel_customer_booking_with_access(uuid,text)', 'EXECUTE'),
  'contract: action gateway can cancel through an access session'
);

select ok(not has_function_privilege('authenticated', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'EXECUTE'),
  'contract: authenticated cannot create directly');
select ok(not has_function_privilege('authenticated', 'public.lookup_booking(text)', 'EXECUTE'),
  'contract: authenticated cannot lookup directly');
select ok(not has_function_privilege('authenticated', 'public.list_bookings_by_phone(text)', 'EXECUTE'),
  'contract: authenticated cannot list directly');
select ok(not has_function_privilege('authenticated', 'public.cancel_booking(uuid,text)', 'EXECUTE'),
  'contract: authenticated cannot call removed cancel signature');
select ok(not has_function_privilege('authenticated', 'public.create_review(text,integer,text)', 'EXECUTE'),
  'contract: authenticated cannot call removed review signature');
select ok(not has_function_privilege(
  'anon', 'public.list_customer_bookings_with_access(text)', 'EXECUTE'),
  'contract: anonymous callers cannot use access-scoped booking RPCs directly'
);
select ok(not has_function_privilege(
  'authenticated', 'public.list_customer_bookings_with_access(text)', 'EXECUTE'),
  'contract: authenticated callers cannot use access-scoped booking RPCs directly'
);

set local role anon;
select throws_ok(
  $$select public.create_booking('missing', 'missing', now() + interval '1 day', '0700000000', 'test@example.com', 'sv', 'Test')$$,
  '42501', null, 'contract: old frontend create call is rejected'
);
select throws_ok(
  $$select public.lookup_booking('0700000000')$$,
  '42501', null, 'contract: old frontend lookup call is rejected'
);
select throws_ok(
  $$select public.list_bookings_by_phone('0700000000')$$,
  '42501', null, 'contract: old frontend list call is rejected'
);
select is(pg_catalog.to_regprocedure('public.cancel_booking(uuid,text)') is null, true,
  'contract: old frontend cancellation signature no longer resolves');
select is(pg_catalog.to_regprocedure('public.create_review(text,integer,text)') is null, true,
  'contract: old frontend review signature no longer resolves');
reset role;

select ok(has_function_privilege(
  'service_role',
  'public.create_booking_with_limits(text,text,timestamptz,text,text,text,text,text,integer,integer,integer,integer)',
  'EXECUTE'
), 'contract: booking gateway wrapper remains executable');
select ok(has_function_privilege(
  'service_role',
  'public.consume_public_action_attempt(text,text,text,integer,integer,integer)',
  'EXECUTE'
), 'contract: customer-action gateway limiter remains executable');

set local role service_role;
select lives_ok(
  $$select public.create_booking_with_limits(
    'missing', 'missing', now() + interval '1 day', '0700000000', 'test@example.com', 'sv', 'Test',
    repeat('d', 64), 600, 86400, 10, 5
  )$$,
  'contract: booking gateway database call still works'
);
select lives_ok(
  $$select public.consume_public_action_attempt('request_access', repeat('e', 64), repeat('f', 64), 600, 12, 8)$$,
  'contract: customer-action limiter database call still works'
);
select lives_ok(
  $$select public.lookup_booking('0700000000')$$,
  'contract: customer-action gateway downstream call still works'
);

select * from finish();
rollback;
