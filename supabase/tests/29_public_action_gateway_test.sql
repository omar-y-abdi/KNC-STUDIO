begin;
select plan(14);

select has_table('public', 'public_action_attempts', 'public action ledger exists');
select is(
  (select c.relrowsecurity from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'public_action_attempts'),
  true,
  'public action ledger has RLS enabled'
);

select is(
  pg_catalog.has_table_privilege('anon', 'public.public_action_attempts', 'select'),
  false,
  'anon cannot read action hashes'
);
select is(
  pg_catalog.has_table_privilege('authenticated', 'public.public_action_attempts', 'insert'),
  false,
  'authenticated clients cannot write action hashes'
);

select is(
  pg_catalog.has_function_privilege('anon', 'public.lookup_booking(text)', 'execute'),
  false,
  'anon cannot call booking lookup directly'
);
select is(
  pg_catalog.has_function_privilege('anon', 'public.list_bookings_by_phone(text)', 'execute'),
  false,
  'anon cannot list phone bookings directly'
);
select is(
  pg_catalog.has_function_privilege('anon', 'public.cancel_booking(uuid,text)', 'execute'),
  false,
  'anon cannot cancel directly'
);
select is(
  pg_catalog.has_function_privilege('anon', 'public.create_review(text,integer,text)', 'execute'),
  false,
  'anon cannot submit reviews directly'
);

select is(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.consume_public_action_attempt(text,text,text,integer,integer,integer)',
    'execute'
  ),
  true,
  'service role can consume a rate-limit attempt'
);

select is(
  public.consume_public_action_attempt(
    'lookup', repeat('a', 64), repeat('b', 64), 600, 2, 2
  ),
  true,
  'first attempt is accepted'
);
select is(
  public.consume_public_action_attempt(
    'lookup', repeat('a', 64), repeat('b', 64), 600, 2, 2
  ),
  true,
  'second attempt reaches configured limit'
);
select is(
  public.consume_public_action_attempt(
    'lookup', repeat('a', 64), repeat('b', 64), 600, 2, 2
  ),
  false,
  'third attempt is rate limited atomically'
);
select is(
  public.consume_public_action_attempt(
    'invalid', repeat('c', 64), repeat('d', 64), 600, 2, 2
  ),
  false,
  'unknown action is rejected'
);
select is(
  (select count(*)::integer from public.public_action_attempts
   where action = 'lookup' and ip_hash = repeat('a', 64)),
  2,
  'only accepted attempts are stored'
);

select * from finish();
rollback;
