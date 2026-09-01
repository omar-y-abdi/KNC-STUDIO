-- pgTAP — the #46 Calendar dispatch replacement must preserve the final secure #42 customer-access
-- dispatcher. This suite intentionally runs after PR #55/#42: reverse rollout is unsupported.

begin;
select plan(13);

select ok(
  pg_catalog.to_regprocedure('public.consume_customer_access_email_challenge(uuid)') is not null,
  '#42 secure customer-access challenge consumer is present'
);
select ok(
  coalesce(
    pg_catalog.pg_get_functiondef(
      'public.queue_external_action(text,text,jsonb)'::regprocedure
    ),
    ''
  ) like '%customer_access_email_send%'
  and coalesce(
    pg_catalog.pg_get_functiondef(
      'public.queue_external_action(text,text,jsonb)'::regprocedure
    ),
    ''
  ) like '%challenge_id%'
  and coalesce(
    pg_catalog.pg_get_functiondef(
      'public.queue_external_action(text,text,jsonb)'::regprocedure
    ),
    ''
  ) not like '%access_code%',
  '#42 queue contract accepts identifier-only customer-access payloads'
);
select ok(
  coalesce(
    pg_catalog.pg_get_functiondef(
      'public.external_action_for_dispatch(uuid,uuid)'::regprocedure
    ),
    ''
  ) like '%v_token_ciphertext%'
  and coalesce(
    pg_catalog.pg_get_functiondef(
      'public.external_action_for_dispatch(uuid,uuid)'::regprocedure
    ),
    ''
  ) not like '%access_code%',
  '#46 dispatch definition retains secure ciphertext resolution and no plaintext branch'
);

insert into public.barbers (id, name)
values ('customer-dispatch', 'Customer Dispatch');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('49000000-0000-4000-8000-000000000001', 'customer-dispatch', 'service', 'Service', 300, 30,
   '2099-04-08 07:00+00', '2099-04-08 07:30+00', 'Dispatch Customer', 'email',
   '0704900001', 'dispatch@example.test', 'sv', 'confirmed');
insert into public.customer_booking_access_tokens
  (email, phone, token_hash, token_ciphertext)
values
  ('dispatch@example.test', '0704900001', repeat('a', 64), 'v1.' || repeat('A', 80));
insert into public.customer_booking_access_challenges
  (id, phone, email, token_hash, expires_at)
values
  ('49000000-0000-4000-8000-000000000002', '0704900001', 'dispatch@example.test',
   repeat('a', 64), 'infinity'::timestamptz);

select set_config(
  'test.secure_customer_job',
  public.queue_external_action(
    'customer_access_email_send',
    '49000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_build_object(
      'challenge_id', '49000000-0000-4000-8000-000000000002',
      'lang', 'en'
    )
  )::text,
  true
);
select is(
  (select payload - 'challenge_id' - 'lang'
   from public.external_action_jobs
   where id = current_setting('test.secure_customer_job')::uuid),
  '{}'::jsonb,
  'customer access queue payload contains only challenge_id and lang'
);
select ok(
  not exists (
    select 1
    from public.external_action_jobs
    where id = current_setting('test.secure_customer_job')::uuid
      and payload ? 'access_code'
  ),
  'customer access queue payload has no plaintext access_code'
);

select set_config(
  'test.secure_customer_dispatch',
  public.claim_external_action(current_setting('test.secure_customer_job')::uuid)::text,
  true
);
select is(
  current_setting('test.secure_customer_dispatch')::jsonb->>'action_type',
  'customer_access_email_send',
  'secure dispatch returns a customer access email action'
);
select is(
  current_setting('test.secure_customer_dispatch')::jsonb->>'challenge_id',
  '49000000-0000-4000-8000-000000000002',
  'secure dispatch returns the dispatch-only challenge id'
);
select is(
  current_setting('test.secure_customer_dispatch')::jsonb->>'email',
  'dispatch@example.test',
  'secure dispatch resolves the customer email from the challenge'
);
select is(
  current_setting('test.secure_customer_dispatch')::jsonb->>'lang',
  'en',
  'secure dispatch preserves the requested language'
);
select is(
  current_setting('test.secure_customer_dispatch')::jsonb->>'token_ciphertext',
  'v1.' || repeat('A', 80),
  'secure dispatch returns canonical token ciphertext by matching email and token hash'
);
select is(
  current_setting('test.secure_customer_dispatch')::jsonb->>'access_code',
  null,
  'secure dispatch never returns a plaintext access code'
);

insert into public.customer_booking_access_challenges
  (id, phone, email, token_hash, expires_at)
values
  ('49000000-0000-4000-8000-000000000003', '0704900001', 'dispatch@example.test',
   repeat('b', 64), 'infinity'::timestamptz);
select set_config(
  'test.stale_customer_job',
  public.queue_external_action(
    'customer_access_email_send',
    '49000000-0000-4000-8000-000000000003',
    pg_catalog.jsonb_build_object(
      'challenge_id', '49000000-0000-4000-8000-000000000003',
      'lang', 'en'
    )
  )::text,
  true
);
select set_config(
  'test.stale_customer_dispatch',
  public.claim_external_action(current_setting('test.stale_customer_job')::uuid)::text,
  true
);
select is(
  current_setting('test.stale_customer_dispatch')::jsonb->>'superseded',
  'true',
  'a challenge whose email and token hash do not match the canonical token is superseded'
);
select is(
  current_setting('test.stale_customer_dispatch')::jsonb->>'token_ciphertext',
  null,
  'a stale challenge never receives canonical ciphertext'
);

select * from finish();
rollback;
