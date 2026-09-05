-- pgTAP — retire direct customer booking/review, phone-rate, and fire-and-forget confirmation APIs.
-- Access-scoped customer actions, atomic booking, and durable email delivery remain the contract.

begin;
select plan(22);

select ok(
  pg_catalog.to_regprocedure('public.cancel_booking(uuid,text)') is null,
  'the direct customer cancellation signature is absent'
);
select ok(
  pg_catalog.to_regprocedure('public.create_review(text,integer,text)') is null,
  'the direct customer review signature is absent'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.recent_booking_count_by_phone(text,timestamp with time zone)'
  ) is null,
  'the retired phone rate helper is absent'
);
select ok(
  pg_catalog.to_regprocedure('public.queue_booking_confirmation()') is null,
  'the retired fire-and-forget confirmation function is absent'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and p.oid = pg_catalog.to_regprocedure('public.queue_booking_confirmation()')
  ),
  'no trigger references the retired confirmation function'
);
select ok(
  not exists (
    select 1
    from cron.job
    where command ilike '%recent_booking_count_by_phone%'
       or command ilike '%queue_booking_confirmation%'
       or command ilike '%cancel_booking%'
       or command ilike '%create_review%'
  ),
  'no cron job references a retired booking or review function'
);

select ok(
  pg_catalog.to_regprocedure('public.cancel_customer_booking_with_access(uuid,text)') is not null,
  'access-scoped cancellation remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.create_review_with_access(text,text,integer,text)') is not null,
  'access-scoped review remains present'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.create_booking_with_limits(text,text,timestamp with time zone,text,text,text,text,text,integer,integer,integer,integer)'
  ) is not null,
  'the atomic booking gateway remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.queue_booking_email_delivery()') is not null,
  'durable booking email delivery remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.ensure_customer_booking_access_token(text,text,text,text)') is not null,
  'permanent-token confirmation seam remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.rotate_customer_booking_access_token(text,text,text,text,text)') is not null,
  'email-only permanent-token rotation remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.exchange_customer_booking_access(text,text)') is not null,
  'compatibility exchange remains present'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.cancel_customer_booking_with_access(uuid,text)',
    'execute'
  ),
  'service role can execute access-scoped cancellation'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_review_with_access(text,text,integer,text)',
    'execute'
  ),
  'service role can execute access-scoped review'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_booking_with_limits(text,text,timestamp with time zone,text,text,text,text,text,integer,integer,integer,integer)',
    'execute'
  ),
  'service role can execute the atomic booking gateway'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and t.tgname = 'booking_email_delivery_on_insert'
      and p.oid = 'public.queue_booking_email_delivery()'::regprocedure
  ),
  'booking insert trigger uses durable email delivery'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and t.tgname = 'booking_email_delivery_on_status_change'
      and p.oid = 'public.queue_booking_email_delivery()'::regprocedure
  ),
  'booking status trigger uses durable email delivery'
);

insert into public.barbers (id, name)
values ('retire-booking', 'Retire Booking');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('46000000-0000-0000-0000-000000000001', 'retire-booking', 'service', 'Service', 300, 30,
   '2099-01-02 09:00+00', '2099-01-02 09:30+00', 'Cancel Customer', 'email',
   '0704600001', 'cancel@example.test', 'sv', 'confirmed'),
  ('46000000-0000-0000-0000-000000000002', 'retire-booking', 'service', 'Service', 300, 30,
   '2020-01-02 09:00+00', '2020-01-02 09:30+00', 'Review Customer', 'email',
   '0704600002', 'review@example.test', 'sv', 'confirmed');
insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
values
  ('0704600001', 'cancel@example.test', repeat('a', 64), pg_catalog.now() + interval '20 minutes'),
  ('0704600002', 'review@example.test', repeat('b', 64), pg_catalog.now() + interval '20 minutes');

set local role service_role;
select is(
  public.cancel_customer_booking_with_access(
    '46000000-0000-0000-0000-000000000001', repeat('a', 64)
  )->>'ok',
  'true',
  'access-scoped cancellation remains operational'
);
select is(
  public.create_review_with_access(repeat('b', 64), '0704600002', 5, 'Retired API test')->>'ok',
  'true',
  'access-scoped review remains operational'
);
reset role;
select is(
  (select status from public.bookings where id = '46000000-0000-0000-0000-000000000001'),
  'cancelled',
  'access-scoped cancellation changes only its authorized booking'
);
select is(
  (select count(*)::integer
   from public.reviews
   where name = 'Review C.'),
  1,
  'access-scoped review persists the authorized review'
);

select * from finish();
rollback;
