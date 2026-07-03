-- pgTAP — barber_login_accounts (migration 0018). Proves:
--   schema:  profiles.must_change_password column exists and defaults to false
--   RPC:     set_own_password_changed() clears must_change_password for the CALLING USER only,
--            leaving every other profiles row untouched
--
-- Fixture strategy: session_replication_role = replica disables FK trigger checks so we can
-- insert bare profiles rows without matching rows in auth.users or public.barbers. The
-- whole transaction rolls back on finish, leaving no test data behind.

begin;
select plan(5);

-- ---- fixtures -----------------------------------------------------------------------
set local session_replication_role = 'replica';

insert into public.profiles (id, role, must_change_password)
values
  ('00000000-0000-0000-0a00-000000000001'::uuid, 'barber', true),  -- user A: the caller
  ('00000000-0000-0000-0a00-000000000002'::uuid, 'barber', true);  -- user B: bystander

-- =============================================================================================
-- SCHEMA: column exists and defaults to false.
-- =============================================================================================
select has_column(
  'public', 'profiles', 'must_change_password',
  'profiles.must_change_password column exists'
);

select col_default_is(
  'public', 'profiles', 'must_change_password', false,
  'must_change_password defaults to false'
);

-- =============================================================================================
-- RPC: set_own_password_changed() scopes update to auth.uid() only.
--
-- Simulate user A calling the RPC by writing their UUID into request.jwt.claims so that
-- auth.uid() returns it for the rest of this transaction. The SECURITY DEFINER function reads
-- this GUC internally — the caller's role is irrelevant to the update scope.
-- =============================================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0a00-000000000001","role":"authenticated"}',
  true   -- local to this transaction
);

-- Call the RPC as user A (returns void; not a pgTAP assertion).
do $$ begin perform public.set_own_password_changed(); end $$;

-- User A's flag must now be false (the RPC cleared it).
select is(
  (select must_change_password
   from public.profiles
   where id = '00000000-0000-0000-0a00-000000000001'::uuid),
  false,
  'set_own_password_changed() clears must_change_password for the calling user'
);

-- User B's flag must remain true (only the caller''s own row is touched).
select is(
  (select must_change_password
   from public.profiles
   where id = '00000000-0000-0000-0a00-000000000002'::uuid),
  true,
  'set_own_password_changed() does not touch any other user''s row'
);

-- =============================================================================================
-- ACL (migration 0019): anon must NOT be able to execute the RPC. Supabase's default privileges
-- auto-grant EXECUTE on new public functions to anon; 0019 revokes it so the ACL matches the
-- documented least-privilege intent (authenticated + trusted server roles only).
-- =============================================================================================
select ok(
  not has_function_privilege('anon', 'public.set_own_password_changed()', 'EXECUTE'),
  'anon cannot execute set_own_password_changed() (revoked in 0019)'
);

select * from finish();
rollback;
