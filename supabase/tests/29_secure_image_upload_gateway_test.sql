begin;
select plan(5);

select is(
  (select file_size_limit::bigint from storage.buckets where id = 'gallery'),
  512000::bigint,
  'gallery accepts only gateway-sized output objects'
);
select ok(
  (select allowed_mime_types = array['image/webp']::text[] from storage.buckets where id = 'gallery'),
  'gallery accepts only WebP objects'
);
select is(
  (select file_size_limit::bigint from storage.buckets where id = 'barber-photos'),
  512000::bigint,
  'barber-photos accepts only gateway-sized output objects'
);
select ok(
  (select allowed_mime_types = array['image/webp']::text[] from storage.buckets where id = 'barber-photos'),
  'barber-photos accepts only WebP objects'
);
select is(
  (
    select count(*)::int
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname in (
        'gallery_owner_insert',
        'gallery_owner_update',
        'barber_photos_owner_insert',
        'barber_photos_owner_update',
        'barber_photos_own_insert',
        'barber_photos_own_update'
      )
  ),
  0,
  'authenticated Storage insert and update policies are removed'
);

select * from finish();
rollback;
