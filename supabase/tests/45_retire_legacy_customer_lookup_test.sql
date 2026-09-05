-- pgTAP — retire phone-keyed lookup/listing and superseded access-request overloads.
-- The protected gateway keeps exchange plus the current permanent-token seams.

begin;
select plan(22);

select ok(
  pg_catalog.to_regprocedure('public.lookup_booking(text)') is null,
  'the retired phone lookup signature is absent'
);
select ok(
  pg_catalog.to_regprocedure('public.list_bookings_by_phone(text)') is null,
  'the retired phone listing signature is absent'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.create_customer_booking_access_request(text,text,text)'
  ) is null,
  'the old three-argument access-request overload is absent'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.create_customer_booking_access_request(text,text,text,text,text)'
  ) is null,
  'the old five-argument access-request overload is absent'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('lookup_booking', 'list_bookings_by_phone', 'create_customer_booking_access_request')
  ),
  'no retired customer lookup or access-request overload remains'
);

select ok(
  pg_catalog.to_regprocedure('public.exchange_customer_booking_access(text,text)') is not null,
  'one-time access exchange remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.customer_booking_access_scope(text)') is not null,
  'access scope remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.list_customer_bookings_with_access(text)') is not null,
  'access-scoped listing remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.cancel_customer_booking_with_access(uuid,text)') is not null,
  'access-scoped cancellation remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.ensure_customer_booking_access_token(text,text,text,text)') is not null,
  'permanent-token ensure remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.replace_customer_booking_access_token(text,text,text,text)') is not null,
  'permanent-token replacement remains present'
);
select ok(
  pg_catalog.to_regprocedure('public.rotate_customer_booking_access_token(text,text,text,text,text)') is not null,
  'permanent-token rotation remains present'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.exchange_customer_booking_access(text,text)',
    'execute'
  ),
  'service role retains access exchange execution'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.exchange_customer_booking_access(text,text)',
    'execute'
  ),
  'anon cannot execute access exchange directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.ensure_customer_booking_access_token(text,text,text,text)',
    'execute'
  ),
  'service role retains permanent-token ensure execution'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.ensure_customer_booking_access_token(text,text,text,text)',
    'execute'
  ),
  'anon cannot execute permanent-token ensure directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.replace_customer_booking_access_token(text,text,text,text)',
    'execute'
  ),
  'service role retains permanent-token replacement execution'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.replace_customer_booking_access_token(text,text,text,text)',
    'execute'
  ),
  'anon cannot execute permanent-token replacement directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.rotate_customer_booking_access_token(text,text,text,text,text)',
    'execute'
  ),
  'service role retains permanent-token rotation execution'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.rotate_customer_booking_access_token(text,text,text,text,text)',
    'execute'
  ),
  'anon cannot execute permanent-token rotation directly'
);

insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
values ('0704500000', 'legacy-preserved@example.test', repeat('a', 64), pg_catalog.now() + interval '15 minutes');
set local role service_role;
select is(
  public.exchange_customer_booking_access(repeat('a', 64), repeat('b', 64)),
  true,
  'preserved one-time exchange still creates an access session'
);
reset role;
select is(
  (select count(*)::integer
   from public.customer_booking_access_sessions
   where token_hash = repeat('b', 64)),
  1,
  'preserved exchange session is persisted'
);

select * from finish();
rollback;
