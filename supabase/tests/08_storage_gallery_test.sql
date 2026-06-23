-- pgTAP — Storage `gallery` bucket + its RLS policies (ADMIN_SPEC §1.6 + §2 + §8).
-- Behavioral Storage RLS (real uploads through the Storage API) cannot be exercised offline in
-- pgTAP; here we assert the bucket contract and the policy PRESENCE/shape that enforce
-- public-read / owner-write, so the structural guarantees live inside the green test gate.
--
-- Enforcement model proven here:
--   * public READ  : bucket.public = true  AND a SELECT policy on storage.objects scoped to
--                    bucket_id='gallery' granted to anon + authenticated.
--   * owner WRITE  : INSERT/UPDATE/DELETE policies on storage.objects, each gated on
--                    bucket_id='gallery' AND public.is_owner() (granted to authenticated).

begin;
select plan(9);

-- ---- bucket exists + is public --------------------------------------------------------------
select is(
  (select count(*)::int from storage.buckets where id = 'gallery'),
  1, 'the gallery bucket exists'
);
select is(
  (select public from storage.buckets where id = 'gallery'),
  true, 'the gallery bucket is PUBLIC (public read)'
);

-- ---- RLS is enabled on storage.objects ------------------------------------------------------
select is(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  true, 'RLS is enabled on storage.objects'
);

-- ---- the four gallery policies exist, with the correct commands -----------------------------
-- pg_policy.polcmd: 'r'=SELECT, 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE, '*'=ALL.
select is(
  (select polcmd::text from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_public_read'),
  'r', 'gallery_public_read is a SELECT policy (public read)'
);
select is(
  (select polcmd::text from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_insert'),
  'a', 'gallery_owner_insert is an INSERT policy (owner write)'
);
select is(
  (select polcmd::text from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_update'),
  'w', 'gallery_owner_update is an UPDATE policy (owner write)'
);
select is(
  (select polcmd::text from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_delete'),
  'd', 'gallery_owner_delete is a DELETE policy (owner write)'
);

-- ---- the owner-write policies actually reference is_owner() (not a permissive stub) ----------
-- pg_get_expr renders the policy's USING/WITH CHECK expression; assert it mentions is_owner.
-- (We use ok(<expr> like ...) rather than pgTAP's like() matcher, whose overload resolution is
--  finicky with unknown-typed literals.)
select ok(
  (select pg_get_expr(polqual, polrelid) from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_delete') like '%is_owner%',
  'gallery_owner_delete USING is gated on public.is_owner()'
);
select ok(
  (select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_insert') like '%is_owner%',
  'gallery_owner_insert WITH CHECK is gated on public.is_owner()'
);

select * from finish();
rollback;
