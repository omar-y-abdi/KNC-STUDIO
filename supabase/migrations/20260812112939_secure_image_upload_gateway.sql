update storage.buckets
set
  file_size_limit = 512000,
  allowed_mime_types = array['image/webp']::text[]
where id in ('gallery', 'barber-photos');

drop policy if exists gallery_owner_insert on storage.objects;
drop policy if exists gallery_owner_update on storage.objects;
drop policy if exists barber_photos_owner_insert on storage.objects;
drop policy if exists barber_photos_owner_update on storage.objects;
drop policy if exists barber_photos_own_insert on storage.objects;
drop policy if exists barber_photos_own_update on storage.objects;
