begin;
select plan(67);

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


-- Current session/repair contract: permanent links mint sessions, existing sessions never renew.
set local role service_role;
select is(
  public.establish_customer_booking_session(repeat('c', 64), repeat('f', 64)),
  true,
  'current permanent lookup hash establishes a session'
);
select is(
  public.establish_customer_booking_session(repeat('f', 64), repeat('1', 64)),
  false,
  'an existing session cannot extend its original expiry by minting another session'
);
select is(
  public.replace_customer_booking_access_token(
    'person@example.test', '0703900002', repeat('9', 64), 'v1.' || repeat('R', 80),
    (current_setting('test.first_access')::jsonb->>'generation')::bigint
  ),
  false,
  'repair of a stale generation cannot overwrite a freshly requested link'
);
reset role;
select is(
  (select token_hash from public.customer_booking_access_tokens where email='person@example.test'),
  repeat('c', 64),
  'freshly requested token remains authoritative after stale repair'
);
select is(
  (select count(*)::int from public.customer_booking_access_challenges
   where email='person@example.test' and token_hash=repeat('c', 64)),
  1,
  'stale repair preserves the fresh-link email challenge'
);
set local role service_role;
select is(
  public.replace_customer_booking_access_token(
    'person@example.test', '0703900002', repeat('9', 64), 'v1.' || repeat('R', 80)
  ),
  false,
  'older callers without a generation fail closed'
);
select is(
  public.replace_customer_booking_access_token(
    'person@example.test', '0703900002', repeat('9', 64), 'v1.' || repeat('R', 80),
    (public.ensure_customer_booking_access_token(
      'person@example.test', '0703900002', repeat('9', 64), 'v1.' || repeat('R', 80)
    )->>'generation')::bigint
  ),
  true,
  'repair of the observed current generation succeeds'
);
select is(
  public.list_customer_bookings_with_access(repeat('f', 64))->>'error',
  'access_denied',
  'successful ciphertext repair invalidates previous sessions'
);
reset role;

select ok(not has_table_privilege('anon','public.customer_booking_receipts','select'), 'device receipt secrets are not public');
select ok(not has_table_privilege('service_role','public.customer_booking_receipt_bookings','select'), 'receipt grants use narrow RPCs');
select ok(not has_function_privilege('service_role','public.customer_device_booking_ids(text,text)','execute'), 'internal receipt predicate cannot be called directly');
select ok(not has_function_privilege('anon','public.append_customer_booking_receipt(uuid,text,text,text)','execute'), 'public callers cannot manufacture receipt grants');

insert into public.barbers(id,name) values('device-receipt','Device receipt');
insert into public.bookings(id,barber_id,service_id,service_name,price,duration_min,start_at,end_at,customer_name,method,phone,email,lang,status)
values
('3a000000-0000-4000-8000-000000000001','device-receipt','s','Old A',100,30,'2099-04-01 10:00Z','2099-04-01 10:30Z','A old','email','0704100001','receipt-a@example.test','sv','confirmed'),
('3a000000-0000-4000-8000-000000000002','device-receipt','s','New A',100,30,'2099-04-02 10:00Z','2099-04-02 10:30Z','A new','email','0704100002','receipt-a@example.test','sv','confirmed'),
('3a000000-0000-4000-8000-000000000003','device-receipt','s','Other B',100,30,'2099-04-03 10:00Z','2099-04-03 10:30Z','B','email','0704100002','receipt-b@example.test','sv','confirmed'),
('3a000000-0000-4000-8000-000000000004','device-receipt','s','Guest X',100,30,'2099-04-04 10:00Z','2099-04-04 10:30Z','X','email','0704100003','receipt-x@example.test','sv','confirmed');
insert into public.customer_booking_access_sessions(phone,email,token_hash,expires_at) values
('0704100002','receipt-a@example.test',repeat('1a',32),now()+interval '1 day'),
('0704100002','receipt-a@example.test',repeat('2a',32),now()+interval '1 day'),
('0704100002','receipt-b@example.test',repeat('1b',32),now()+interval '1 day');

set local role service_role;
select is(public.append_customer_booking_receipt('3a000000-0000-4000-8000-000000000002',null,repeat('1c',32),null)->>'existing','false','first successful booking creates its own receipt');
select is(public.list_customer_bookings_for_browser(null,repeat('1c',32))->>'authority','device','anonymous receipt has explicit device authority');
select ok(not (public.list_customer_bookings_for_browser(null,repeat('1c',32)) ? 'phone'), 'device receipt does not return a verified contact profile');
select is(jsonb_path_query_array(public.list_customer_bookings_for_browser(null,repeat('1c',32)), '$.bookings[*].id'), '["3a000000-0000-4000-8000-000000000002"]'::jsonb, 'same email never expands receipt to older bookings');
select is((select count(*)::int from public.customer_booking_access_scope(repeat('1c',32))),0,'receipt does not become full email authority');
select is(public.create_review_with_access(repeat('1c',32),'0704100002',5,'No proof')->>'error','no_booking','receipt cannot authorize a review');
select is(public.cancel_customer_booking_for_browser('3a000000-0000-4000-8000-000000000001',null,repeat('1c',32))->>'error','not_found','receipt cannot cancel older booking at the same email');
select is(public.cancel_customer_booking_for_browser('3a000000-0000-4000-8000-000000000003',null,repeat('1c',32))->>'error','not_found','shared phone does not let a receipt cancel another customer');
select is(public.append_customer_booking_receipt('3a000000-0000-4000-8000-000000000002',repeat('1c',32),repeat('2c',32),null)->>'existing','true','repeated registration keeps the existing live collection');
reset role;
select is((select count(*)::int from public.customer_booking_receipt_bookings where receipt_hash=repeat('1c',32)),1,'duplicate append does not duplicate grants');
set local role service_role;
select is(public.append_customer_booking_receipt('3a000000-0000-4000-8000-000000000004',repeat('1c',32),repeat('3c',32),repeat('1a',32))->>'existing','true','verified A session attaches only its newly created guest booking');
select is(jsonb_array_length(public.list_customer_bookings_for_browser(repeat('1a',32),repeat('1c',32))->'bookings'),3,'A sees own verified history and A-bound receipt');
select is(jsonb_path_query_array(public.list_customer_bookings_for_browser(repeat('1b',32),repeat('1c',32)), '$.bookings[*].id'), '["3a000000-0000-4000-8000-000000000003"]'::jsonb,'B login never imports A or anonymous receipts');
select is(jsonb_array_length(public.list_customer_bookings_for_browser(repeat('2a',32),repeat('1c',32))->'bookings'),3,'renewed session for the same A retains its receipt grants');
select is(jsonb_array_length(public.list_customer_bookings_for_browser(repeat('ff',32),repeat('1c',32))->'bookings'),2,'without valid full session only separately authorized device IDs remain');
select is(public.cancel_customer_booking_for_browser('3a000000-0000-4000-8000-000000000004',repeat('1b',32),repeat('1c',32))->>'error','not_found','B cannot cancel an A-bound guest receipt');
select is(public.cancel_customer_booking_for_browser('3a000000-0000-4000-8000-000000000002',null,repeat('1c',32))->>'ok','true','device can cancel the exact booking it created within policy');
reset role;
update public.customer_booking_receipts set expires_at=now()+interval '1 hour' where token_hash=repeat('1c',32);
set local role service_role;
select cmp_ok((public.append_customer_booking_receipt('3a000000-0000-4000-8000-000000000004',repeat('1c',32),repeat('5c',32),repeat('1a',32))->>'max_age')::integer,'<=',3600,'cookie lifetime never outlives an existing receipt');
reset role;
update public.customer_booking_receipts set expires_at=now()-interval '1 second' where token_hash=repeat('1c',32);
set local role service_role;
select is(public.list_customer_bookings_for_browser(null,repeat('1c',32))->>'error','access_denied','expired device receipt grants no access');
select is(public.append_customer_booking_receipt('3a000000-0000-4000-8000-000000000004',repeat('1c',32),repeat('4c',32),null)->>'existing','false','a new booking replaces an expired receipt with fresh authority');
select is(jsonb_array_length(public.list_customer_bookings_for_browser(null,repeat('4c',32))->'bookings'),1,'new receipt does not resurrect the expired collection');
reset role;
select public.cleanup_customer_booking_access();
select is((select count(*)::int from public.customer_booking_receipts where token_hash=repeat('1c',32)),0,'scheduled cleanup deletes expired receipts');
select is((select count(*)::int from public.customer_booking_receipt_bookings where receipt_hash=repeat('1c',32)),0,'cleanup also deletes expired ID grants');

set local role service_role;
select lives_ok($$select public.forget_customer_booking_receipt(repeat('4c',32))$$, 'withdrawing consent revokes the optional receipt');
select is(public.list_customer_bookings_for_browser(null,repeat('4c',32))->>'error','access_denied','forgotten receipt cannot authorize history');
select lives_ok($$select public.forget_customer_booking_receipt(repeat('4c',32))$$, 'repeated withdrawal remains safe');
reset role;
select is((select count(*)::int from public.customer_booking_receipt_bookings where receipt_hash=repeat('4c',32)),0,'withdrawal deletes all receipt grants');
select is((select count(*)::int from public.bookings where barber_id='device-receipt'),4,'withdrawing optional storage preserves every customer booking');

select * from finish();
rollback;
