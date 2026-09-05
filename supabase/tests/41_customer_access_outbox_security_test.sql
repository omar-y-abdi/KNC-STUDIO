begin;
select plan(15);

select ok(
  has_function_privilege(
    'service_role',
    'public.consume_customer_access_email_challenge(uuid)',
    'execute'
  ),
  'service role can consume a dispatch-only customer access challenge'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.consume_customer_access_email_challenge(uuid)',
    'execute'
  ),
  'anonymous callers cannot consume customer access challenges'
);

select throws_ok(
  $$select public.queue_external_action(
    'customer_access_email_send',
    'customer-access-raw-payload',
    jsonb_build_object(
      'challenge_id', '41000000-0000-4000-8000-000000000001',
      'access_code', repeat('a', 64),
      'lang', 'sv'
    )
  )$$,
  '22023',
  'invalid customer access delivery',
  'customer access queue rejects plaintext access-code payloads'
);

insert into public.barbers (id, name) values ('outbox-cipher', 'Outbox Cipher Barber');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('41000000-0000-4000-8000-000000000010', 'outbox-cipher', 'service', 'Service', 300, 30,
   '2099-02-01 09:00+00', '2099-02-01 09:30+00', 'Outbox Customer', 'email',
   '0704100010', 'outbox@example.test', 'sv', 'confirmed');

set local role service_role;
select ok(
  public.rotate_customer_booking_access_token(
    'outbox@example.test', repeat('a', 64), 'v1.' || repeat('A', 80), repeat('b', 64), 'sv'
  ),
  'email-only rotation queues an identifier-only customer access action'
);
reset role;

select set_config(
  'test.customer_action_id',
  (select id::text
   from public.external_action_jobs
   where action_type = 'customer_access_email_send'
     and dedupe_key = (select id::text
                       from public.customer_booking_access_challenges
                       where email = 'outbox@example.test')
   limit 1),
  true
);
select set_config(
  'test.customer_challenge_id',
  (select payload->>'challenge_id'
   from public.external_action_jobs
   where id = current_setting('test.customer_action_id')::uuid),
  true
);

select is(
  (select payload - 'challenge_id' - 'lang'
   from public.external_action_jobs
   where id = current_setting('test.customer_action_id')::uuid),
  '{}'::jsonb,
  'pending customer access payload contains only its challenge identifier and language'
);
select ok(
  not exists (
    select 1
    from public.external_action_jobs
    where id = current_setting('test.customer_action_id')::uuid
      and payload ? 'access_code'
  ),
  'pending customer access payload has no plaintext access code'
);

set local role service_role;
select set_config(
  'test.customer_context',
  public.claim_external_action(current_setting('test.customer_action_id')::uuid)::text,
  true
);
reset role;

select is(
  current_setting('test.customer_context')::jsonb->>'action_type',
  'customer_access_email_send',
  'dispatcher returns a customer access email action'
);
select is(
  current_setting('test.customer_context')::jsonb->>'challenge_id',
  current_setting('test.customer_challenge_id'),
  'dispatcher resolves the same dispatch-only challenge'
);
select ok(
  current_setting('test.customer_context')::jsonb->>'token_ciphertext' ~ '^v1\.[A-Za-z0-9_-]+$',
  'dispatcher returns the canonical encrypted token material'
);
select is(
  current_setting('test.customer_context')::jsonb->>'access_code',
  null,
  'dispatcher never returns a plaintext access code'
);
select is(
  current_setting('test.customer_context')::jsonb->>'email',
  'outbox@example.test',
  'dispatcher resolves the delivery email from the challenge'
);

set local role service_role;
select ok(
  public.consume_customer_access_email_challenge(current_setting('test.customer_challenge_id')::uuid),
  'successful delivery consumes the dispatch-only challenge'
);
select ok(
  public.complete_external_action(
    current_setting('test.customer_action_id')::uuid,
    (current_setting('test.customer_context')::jsonb->>'dispatch_token')::uuid
  ),
  'successful delivery still completes the durable action'
);
reset role;

select is(
  (select count(*)::int
   from public.customer_booking_access_challenges
   where id = current_setting('test.customer_challenge_id')::uuid),
  0,
  'consumed dispatch-only challenge leaves no unused row'
);
select is(
  (select count(*)::int
   from public.external_action_jobs
   where id = current_setting('test.customer_action_id')::uuid),
  0,
  'completed customer access action leaves no queue row'
);

select * from finish();
rollback;
