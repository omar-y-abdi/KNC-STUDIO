begin;
select plan(27);

select ok(
  not has_table_privilege('anon', 'public.customer_booking_access_tokens', 'select'),
  'anon cannot read permanent customer credentials'
);
select ok(
  not has_table_privilege('service_role', 'public.customer_booking_access_tokens', 'select'),
  'service role reaches credentials only through narrow definer RPCs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.rotate_customer_booking_access_token(text,text,text,text,text)',
    'execute'
  ),
  'gateway can rotate an email-scoped token'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.rotate_customer_booking_access_token(text,text,text,text,text)',
    'execute'
  ),
  'browser cannot rotate tokens by calling the database directly'
);
select hasnt_column(
  'public',
  'customer_booking_access_tokens',
  'expires_at',
  'permanent token rows have no time-based expiry'
);

insert into public.barbers (id, name) values ('permanent-access', 'Permanent Access');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, created_at)
values
  ('39000000-0000-4000-8000-000000000001', 'permanent-access', 'service', 'Service', 300, 30,
   '2099-01-02 09:00+00', '2099-01-02 09:30+00', 'First Device', 'email',
   '0703900001', 'person@example.test', 'sv', 'confirmed', '2098-01-01 09:00+00'),
  ('39000000-0000-4000-8000-000000000002', 'permanent-access', 'service', 'Service', 300, 30,
   '2099-01-03 09:00+00', '2099-01-03 09:30+00', 'Second Device', 'email',
   '0703900002', 'person@example.test', 'sv', 'confirmed', '2098-01-02 09:00+00');

set local role service_role;
select set_config(
  'test.first_access',
  public.ensure_customer_booking_access_token(
    'PERSON@EXAMPLE.TEST', '0703900001', repeat('a', 64), 'v1.' || repeat('A', 80)
  )::text,
  true
);
reset role;
select is(
  current_setting('test.first_access')::jsonb->>'token_ciphertext',
  'v1.' || repeat('A', 80),
  'first booking confirmation stores its encrypted permanent token'
);

set local role service_role;
select set_config(
  'test.second_access',
  public.ensure_customer_booking_access_token(
    'person@example.test', '0703900002', repeat('b', 64), 'v1.' || repeat('B', 80)
  )::text,
  true
);
reset role;
select is(
  current_setting('test.second_access')::jsonb->>'token_ciphertext',
  'v1.' || repeat('A', 80),
  'later booking confirmations reuse the existing token'
);
select is(
  (select token_hash from public.customer_booking_access_tokens where email = 'person@example.test'),
  repeat('a', 64),
  'ensuring a later confirmation does not rotate the token hash'
);
select is(
  (select generation from public.customer_booking_access_tokens where email = 'person@example.test'),
  1::bigint,
  'ensuring a later confirmation does not increment token generation'
);

insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
values ('0703900001', 'person@example.test', repeat('9', 64), '2099-01-01 00:00+00');
insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
values ('0703900001', 'person@example.test', repeat('8', 64), '2099-01-01 00:00+00');

set local role service_role;
select is(
  pg_catalog.jsonb_array_length(
    public.list_customer_bookings_with_access(repeat('a', 64))->'bookings'
  ),
  2,
  'permanent email token lists bookings across phone changes'
);
select is(
  public.list_customer_bookings_with_access(repeat('a', 64))->>'phone',
  '0703900002',
  'successful token lookup returns latest phone for consented device registration'
);
select ok(
  public.rotate_customer_booking_access_token(
    'person@example.test', repeat('c', 64), 'v1.' || repeat('C', 80), repeat('d', 64), 'en'
  ),
  'email-only fresh-link request rotates the token'
);
reset role;

select is(
  (select generation from public.customer_booking_access_tokens where email = 'person@example.test'),
  2::bigint,
  'fresh-link request increments generation'
);
select is(
  (select token_hash from public.customer_booking_access_tokens where email = 'person@example.test'),
  repeat('c', 64),
  'fresh-link request replaces current token hash'
);
select is(
  (select pg_catalog.count(*)::int from public.customer_booking_access_sessions
   where email = 'person@example.test'),
  0,
  'fresh-link rotation purges already-exchanged legacy sessions for the email'
);
select is(
  (select pg_catalog.count(*)::int from public.customer_booking_access_challenges
   where email = 'person@example.test' and token_hash = repeat('8', 64)),
  0,
  'fresh-link rotation purges the previous compatibility challenge'
);
select is(
  (select expires_at::text from public.customer_booking_access_challenges
   where email = 'person@example.test'),
  'infinity',
  'current dispatch credential remains valid until token rotation, not a time deadline'
);

set local role service_role;
select is(
  public.list_customer_bookings_with_access(repeat('a', 64))->>'error',
  'access_denied',
  'previous link is rejected immediately after rotation'
);
select is(
  pg_catalog.jsonb_array_length(
    public.list_customer_bookings_with_access(repeat('c', 64))->'bookings'
  ),
  2,
  'fresh link keeps email-scoped booking history'
);
reset role;

select is(
  (select pg_catalog.count(*)::int
   from public.external_action_jobs
   where action_type = 'customer_access_email_send'
     and payload->>'challenge_id' = (
       select id::text from public.customer_booking_access_challenges
       where email = 'person@example.test' and token_hash = repeat('c', 64)
     )),
  1,
  'fresh token email is committed to encrypted durable delivery outbox'
);
select is(
  (select pg_catalog.count(*)::int
   from public.customer_booking_access_challenges
   where email = 'person@example.test'),
  1,
  'rotation retains only the current delivery credential'
);

set local role service_role;
select is(
  public.cancel_customer_booking_with_access(
    '39000000-0000-4000-8000-000000000001', repeat('c', 64)
  )->>'ok',
  'true',
  'email token cancels its booking even when latest phone differs'
);
reset role;
select is(
  (select status from public.bookings where id = '39000000-0000-4000-8000-000000000001'),
  'cancelled',
  'email-scoped cancellation persists'
);

set local role service_role;
select is(
  public.rotate_customer_booking_access_token(
    'missing@example.test', repeat('e', 64), 'v1.' || repeat('E', 80), repeat('f', 64), 'sv'
  ),
  false,
  'unknown email keeps the generic database result without issuing access'
);
reset role;
select is(
  (select pg_catalog.count(*)::int
   from public.customer_booking_access_tokens
   where email = 'missing@example.test'),
  0,
  'unknown email creates no permanent credential'
);
select is(
  (select pg_catalog.count(*)::int
   from public.customer_booking_access_tokens
   where email = 'person@example.test'),
  1,
  'rotation purges prior credential state instead of retaining token rows'
);
select is(
  (select note from public.email_templates
   where template = 'customer_booking_access' and lang = 'sv'),
  'Länken gäller tills du begär en ny. Då slutar den tidigare länken att fungera.',
  'Swedish access email states permanent-until-rotated lifecycle'
);

select * from finish();
rollback;
