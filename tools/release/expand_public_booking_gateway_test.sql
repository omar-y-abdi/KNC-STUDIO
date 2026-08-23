begin;
select plan(39);

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
select ok(has_function_privilege(
  'service_role', 'public.create_customer_booking_access_request(text,text,text)', 'EXECUTE'),
  'expand: new gateway can create email-scoped access links'
);
select ok(has_function_privilege(
  'service_role', 'public.exchange_customer_booking_access(text,text)', 'EXECUTE'),
  'expand: new gateway can exchange one-time access links'
);
select ok(has_function_privilege(
  'service_role', 'public.list_customer_bookings_with_access(text)', 'EXECUTE'),
  'expand: new gateway can list through an access session'
);
select ok(has_function_privilege(
  'service_role', 'public.cancel_customer_booking_with_access(uuid,text)', 'EXECUTE'),
  'expand: new gateway can cancel through an access session'
);
select ok(not has_function_privilege(
  'anon', 'public.create_customer_booking_access_request(text,text,text)', 'EXECUTE'),
  'expand: anonymous callers cannot create access links directly'
);
select ok(not has_function_privilege(
  'anon', 'public.exchange_customer_booking_access(text,text)', 'EXECUTE'),
  'expand: anonymous callers cannot exchange access links directly'
);
select ok(not has_function_privilege(
  'anon', 'public.list_customer_bookings_with_access(text)', 'EXECUTE'),
  'expand: anonymous callers cannot list access-scoped bookings directly'
);
select ok(not has_function_privilege(
  'anon', 'public.cancel_customer_booking_with_access(uuid,text)', 'EXECUTE'),
  'expand: anonymous callers cannot cancel access-scoped bookings directly'
);

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
  $$select public.consume_public_action_attempt('request_access', repeat('b', 64), repeat('c', 64), 600, 12, 8)$$,
  'expand: deployed customer-action limiter database call works'
);
select lives_ok(
  $$select public.lookup_booking('0700000000')$$,
  'expand: deployed customer-action gateway downstream call works'
);
select lives_ok(
  $$select public.create_customer_booking_access_request(
    '0700000000', 'missing@example.test', repeat('d', 64)
  )$$,
  'expand: new gateway access-link call works beside legacy browser RPCs'
);
select lives_ok(
  $$select public.exchange_customer_booking_access(repeat('e', 64), repeat('f', 64))$$,
  'expand: new gateway access-link exchange call works'
);
select lives_ok(
  $$select public.list_customer_bookings_with_access(repeat('0', 64))$$,
  'expand: new gateway scoped list call works'
);
select lives_ok(
  $$select public.cancel_customer_booking_with_access(
    '00000000-0000-0000-0000-000000000001'::uuid, repeat('1', 64)
  )$$,
  'expand: new gateway scoped cancellation call works'
);

reset role;
insert into public.barbers (id, name) values ('expand-mail', 'Expand Mail');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('52000000-0000-4000-8000-000000000001', 'expand-mail', 'service', 'Service', 300, 30,
   '2099-01-01 09:00+00', '2099-01-01 09:30+00', 'Expand Mail', 'email', '0705200001',
   'expand-mail@example.test', 'sv');
update public.booking_email_delivery_jobs
set status = 'dispatching', attempt_count = 1, last_attempt_at = pg_catalog.now()
where booking_id = '52000000-0000-4000-8000-000000000001';
select set_config(
  'test.expand_mail_delivery_id',
  (select id::text from public.booking_email_delivery_jobs
   where booking_id = '52000000-0000-4000-8000-000000000001'),
  true
);
set local role service_role;
select ok(
  public.fail_booking_email_delivery(
    current_setting('test.expand_mail_delivery_id')::uuid,
    'send_failed_permanent'
  ),
  'expand: deployed send-confirmation permanent failure code is accepted before contract'
);
reset role;
select is(
  (select status from public.booking_email_delivery_jobs
   where booking_id = '52000000-0000-4000-8000-000000000001'),
  'failed',
  'expand: permanent email failures remain recoverable during mixed-version deployment'
);

select * from finish();
rollback;
