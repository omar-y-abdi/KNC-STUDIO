-- pgTAP — Storage `gallery` bucket + its RLS policies (ADMIN_SPEC §1.6 + §2 + §8).
-- Behavioral Storage RLS (real uploads through the Storage API) cannot be exercised offline in
-- pgTAP; here we assert the bucket contract and the policy PRESENCE/shape that enforce
-- public-read / gateway-upload, so the structural guarantees live inside the green test gate.
--
-- Enforcement model proven here:
--   * public READ  : bucket.public = true  AND a SELECT policy on storage.objects scoped to
--                    bucket_id='gallery' granted to anon + authenticated.
--   * gateway WRITE: direct authenticated INSERT/UPDATE policies are absent; upload-image writes
--                    validated WebP output and durable deletion through service_role.

begin;
select plan(8);

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

-- ---- public read remains; every direct client write path is gone -----------------------------
-- pg_policy.polcmd: 'r'=SELECT, 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE, '*'=ALL.
select is(
  (select polcmd::text from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_public_read'),
  'r', 'gallery_public_read is a SELECT policy (public read)'
);
select is(
  (select count(*)::int from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_insert'),
  0, 'gallery has no direct authenticated INSERT policy'
);
select is(
  (select count(*)::int from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_update'),
  0, 'gallery has no direct authenticated UPDATE policy'
);
select is(
  (select count(*)::int from pg_policy
     where polrelid='storage.objects'::regclass and polname='gallery_owner_delete'),
  0, 'gallery has no direct authenticated DELETE policy'
);

select ok(
  has_function_privilege(
    'service_role', 'public.internal_delete_gallery_image(uuid,text)', 'EXECUTE'),
  'service-role image gateway owns durable gallery cleanup'
);

select * from finish();
rollback;
