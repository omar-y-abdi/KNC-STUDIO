begin;
select plan(16);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'booking_calendar_sync_on_change'
      and not tgisinternal
  ),
  'durable Calendar booking trigger remains installed'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'calendar_sync_on_bookings'
      and not tgisinternal
  ),
  'legacy secret-bearing Calendar webhook trigger is absent'
);
select ok(
  pg_catalog.to_regprocedure('public.queue_calendar_event_sync(uuid)') is not null,
  'durable Calendar queue function remains available'
);

insert into public.barbers (id, name) values ('review-fix', 'Review Fix Barber');
insert into public.barber_calendar_tokens (barber_id, refresh_token, calendar_id)
values ('review-fix', 'refresh-token', 'primary');

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('71000000-0000-4000-8000-000000000010', 'review-fix', 'service', 'Service', 300, 30,
   '2099-01-01 09:00+00', '2099-01-01 09:30+00', 'Future Customer', 'email',
   '0707100010', 'future@example.test', 'sv', 'confirmed');

select is(
  (select pg_catalog.count(*)::int from public.external_action_jobs
   where action_type = 'calendar_event_sync'
     and dedupe_key = '71000000-0000-4000-8000-000000000010'),
  1,
  'confirmed booking transaction durably queues Calendar synchronization'
);

set local role service_role;
select is(
  public.create_customer_booking_access_request(
    '0707100099', 'missing@example.test', repeat('a', 64), repeat('b', 64), 'sv'
  ),
  false,
  'non-matching customer access request keeps generic false database result'
);
reset role;

select is(
  (select pg_catalog.count(*)::int from public.external_action_jobs
   where action_type = 'customer_access_email_send'),
  1,
  'non-matching request still follows the same durable outbox write path'
);

select set_config(
  'test.invalid_access_action',
  (select id::text from public.external_action_jobs
   where action_type = 'customer_access_email_send'
   order by created_at desc limit 1),
  true
);
set local role service_role;
select is(
  public.claim_external_action(current_setting('test.invalid_access_action')::uuid)->>'superseded',
  'true',
  'dispatcher suppresses email when no confirmed booking matches the challenge'
);
reset role;

set local role service_role;
select is(
  public.create_customer_booking_access_request(
    '0707100010', 'future@example.test', repeat('c', 64), repeat('d', 64), 'en'
  ),
  true,
  'matching customer access request is accepted'
);
reset role;

select set_config(
  'test.valid_access_action',
  (select j.id::text
   from public.external_action_jobs j
   join public.customer_booking_access_challenges c
     on c.id = (j.payload->>'challenge_id')::uuid
   where j.action_type = 'customer_access_email_send'
     and c.phone = '0707100010'
   order by j.created_at desc limit 1),
  true
);
set local role service_role;
select set_config(
  'test.valid_access_context',
  public.claim_external_action(current_setting('test.valid_access_action')::uuid)::text,
  true
);
reset role;
select is(
  current_setting('test.valid_access_context')::jsonb->>'email',
  'future@example.test',
  'dispatcher resolves matching access email server-side'
);
select is(
  current_setting('test.valid_access_context')::jsonb->>'access_code',
  repeat('d', 64),
  'dispatcher exposes the opaque code only to the claimed service-role worker'
);

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('71000000-0000-4000-8000-000000000020', 'review-fix', 'service', 'Service', 300, 30,
   '2020-01-01 09:00+00', '2020-01-01 09:30+00', 'Review Customer', 'email',
   '0707100020', 'review@example.test', 'sv', 'confirmed');
insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
values ('0707100020', 'review@example.test', repeat('e', 64), pg_catalog.now() + interval '20 minutes');

set local role service_role;
select is(
  public.create_review_with_access(repeat('e', 64), '0707100020', 5, 'Bra.') ->> 'ok',
  'true',
  'review succeeds with a live email-possession session matching phone and email'
);
reset role;

insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
values ('0707100020', 'other@example.test', repeat('f', 64), pg_catalog.now() + interval '20 minutes');
set local role service_role;
select is(
  public.create_review_with_access(repeat('f', 64), '0707100020', 5, 'No.') ->> 'error',
  'no_booking',
  'same phone without possession of the booking email cannot authorize a review'
);
reset role;

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('71000000-0000-4000-8000-000000000030', 'review-fix', 'service', 'Service', 300, 30,
   pg_catalog.now() - interval '10 minutes', pg_catalog.now() + interval '20 minutes',
   'In Progress', 'email', '0707100030', 'active@example.test', 'sv', 'confirmed');

update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where booking_id in (
  '71000000-0000-4000-8000-000000000010',
  '71000000-0000-4000-8000-000000000020',
  '71000000-0000-4000-8000-000000000030'
);

insert into auth.users (id, email)
values ('71000000-0000-4000-8000-000000000099', 'review-owner@example.test');
insert into public.profiles (id, role, barber_id)
values ('71000000-0000-4000-8000-000000000099', 'owner', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', '71000000-0000-4000-8000-000000000099')::text,
  true
);
select is(
  public.admin_delete_bookings(
    array['71000000-0000-4000-8000-000000000030']::uuid[]
  )->>'error',
  'has_upcoming',
  'hard-delete guard treats a started but unfinished appointment as live'
);
reset role;

select is(
  (select pg_catalog.count(*)::int from public.bookings
   where id = '71000000-0000-4000-8000-000000000030'),
  1,
  'in-progress appointment survives targeted history deletion'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', '71000000-0000-4000-8000-000000000099')::text,
  true
);
select lives_ok(
  $$select public.admin_purge_history()$$,
  'owner history purge remains executable with an in-progress appointment present'
);
reset role;

select is(
  (select pg_catalog.count(*)::int from public.bookings
   where id = '71000000-0000-4000-8000-000000000030'),
  1,
  'global history purge preserves the in-progress appointment until end_at'
);

select * from finish();
rollback;
