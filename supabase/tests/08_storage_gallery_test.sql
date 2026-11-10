-- pgTAP — Storage `gallery` bucket + its RLS policies (ADMIN_SPEC §1.6 + §2 + §8).
-- Behavioral Storage RLS (real uploads through the Storage API) cannot be exercised offline in
-- pgTAP; here we assert the bucket contract and the policy PRESENCE/shape that enforce
-- public-read / gateway-upload, so the structural guarantees live inside the green test gate.
--
-- Enforcement model proven here:
--   * public READ  : bucket.public = true. An object is served by its public URL, which the
--                    Storage API answers without row-level security. No SELECT policy exists on
--                    storage.objects (migration 20261110120500 removed gallery_public_read and
--                    barber_photos_public_read), so anon and authenticated cannot list a bucket.
--                    That the public URL still answers is proven against the real Storage API in
--                    tests/integration/storagePublicRead.test.ts.
--   * gateway WRITE: direct authenticated INSERT/UPDATE policies are absent; upload-image writes
--                    validated WebP output and durable deletion through service_role.

begin;
select plan(14);

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

select is(
  (select public from storage.buckets where id = 'barber-photos'),
  true, 'the barber-photos bucket is PUBLIC (public read)'
);

-- ---- public read is by URL only; every direct client read and write path is gone --------------
-- pg_policy.polcmd: 'r'=SELECT, 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE, '*'=ALL.
select is(
  (select count(*)::int from pg_policy
     where polrelid='storage.objects'::regclass
       and polname in ('gallery_public_read', 'barber_photos_public_read')),
  0, 'the two policies that let the anon key list the public buckets are gone'
);
select is(
  (select count(*)::int from pg_policy
     where polrelid='storage.objects'::regclass and polcmd in ('r', '*')),
  0, 'no policy under any name lets a client role read storage.objects'
);

-- Behaviour, with one object in each bucket: the client roles see no row, the service role does.
insert into storage.objects (bucket_id, name) values
  ('gallery', 'listing-check/a.webp'),
  ('barber-photos', 'listing-check/b.webp');
select is(
  (select count(*)::int from storage.objects where name like 'listing-check/%'),
  2, 'one object exists in each public bucket'
);
set local role anon;
select is(
  (select count(*)::int from storage.objects),
  0, 'anon sees no object row, so it cannot list a bucket'
);
reset role;
set local role authenticated;
select is(
  (select count(*)::int from storage.objects),
  0, 'a signed-in session sees no object row either'
);
reset role;
set local role service_role;
select is(
  (select count(*)::int from storage.objects where name like 'listing-check/%'),
  2, 'the service role, which the upload gateway and the cleanup workers use, still sees both'
);
reset role;

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
    'service_role', 'public.internal_queue_storage_deletion(text,text)', 'EXECUTE'),
  'service-role workers retain durable gallery cleanup for existing jobs and failed uploads'
);

select * from finish();
rollback;
