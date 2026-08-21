begin;
select plan(25);

select ok(has_function_privilege('anon', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'EXECUTE'),
  'expand: deployed browser may create through legacy RPC');
select ok(has_function_privilege('anon', 'public.lookup_booking(text)', 'EXECUTE'),
  'expand: deployed browser may lookup through legacy RPC');
select ok(has_function_privilege('anon', 'public.list_bookings_by_phone(text)', 'EXECUTE'),
  'expand: deployed browser may list through legacy RPC');
select ok(has_function_privilege('anon', 'public.cancel_booking(uuid,text)', 'EXECUTE'),
  'expand: deployed browser may cancel through legacy RPC');
select ok(has_function_privilege('anon', 'public.create_review(text,integer,text)', 'EXECUTE'),
  'expand: deployed browser may review through legacy RPC');

select ok(has_function_privilege('service_role', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'EXECUTE'),
  'expand: submit-booking gateway retains create access');
select ok(has_function_privilege('service_role', 'public.lookup_booking(text)', 'EXECUTE'),
  'expand: action gateway retains lookup access');
select ok(has_function_privilege('service_role', 'public.list_bookings_by_phone(text)', 'EXECUTE'),
  'expand: action gateway retains list access');
select ok(has_function_privilege('service_role', 'public.cancel_booking(uuid,text)', 'EXECUTE'),
  'expand: action gateway retains cancel access');
select ok(has_function_privilege('service_role', 'public.create_review(text,integer,text)', 'EXECUTE'),
  'expand: action gateway retains review access');

select ok(not has_function_privilege('authenticated', 'public.create_booking(text,text,timestamptz,text,text,text,text)', 'EXECUTE'),
  'expand: authenticated role gets no direct create path');
select ok(not has_function_privilege('authenticated', 'public.lookup_booking(text)', 'EXECUTE'),
  'expand: authenticated role gets no direct lookup path');
select ok(not has_function_privilege('authenticated', 'public.list_bookings_by_phone(text)', 'EXECUTE'),
  'expand: authenticated role gets no direct list path');
select ok(not has_function_privilege('authenticated', 'public.cancel_booking(uuid,text)', 'EXECUTE'),
  'expand: authenticated role gets no direct cancel path');
select ok(not has_function_privilege('authenticated', 'public.create_review(text,integer,text)', 'EXECUTE'),
  'expand: authenticated role gets no direct review path');

set local role anon;
select lives_ok(
  $$select public.create_booking('missing', 'missing', now() + interval '1 day', '0700000000', 'test@example.com', 'sv', 'Test')$$,
  'expand: old frontend create call remains executable'
);
select lives_ok(
  $$select public.lookup_booking('0700000000')$$,
  'expand: old frontend lookup call remains executable'
);
select lives_ok(
  $$select public.list_bookings_by_phone('0700000000')$$,
  'expand: old frontend list call remains executable'
);
select lives_ok(
  $$select public.cancel_booking('00000000-0000-0000-0000-000000000001'::uuid, '0700000000')$$,
  'expand: old frontend cancellation call remains executable'
);
select lives_ok(
  $$select public.create_review('0700000000', 5, 'Deployment compatibility test')$$,
  'expand: old frontend review call remains executable'
);

reset role;
select ok(has_function_privilege(
  'service_role',
  'public.create_booking_with_limits(text,text,timestamptz,text,text,text,text,text,integer,integer,integer,integer)',
  'EXECUTE'
), 'expand: booking gateway wrapper remains executable');
select ok(has_function_privilege(
  'service_role',
  'public.consume_public_action_attempt(text,text,text,integer,integer,integer)',
  'EXECUTE'
), 'expand: customer-action gateway limiter remains executable');

set local role service_role;
select lives_ok(
  $$select public.create_booking_with_limits(
    'missing', 'missing', now() + interval '1 day', '0700000000', 'test@example.com', 'sv', 'Test',
    repeat('a', 64), 600, 86400, 10, 5
  )$$,
  'expand: deployed booking gateway database call works'
);
select lives_ok(
  $$select public.consume_public_action_attempt('lookup', repeat('b', 64), repeat('c', 64), 600, 12, 8)$$,
  'expand: deployed customer-action limiter database call works'
);
select lives_ok(
  $$select public.lookup_booking('0700000000')$$,
  'expand: deployed customer-action gateway downstream call works'
);

select * from finish();
rollback;
