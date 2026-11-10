-- Public buckets serve objects by URL without row-level security: these two SELECT policies only
-- let anyone list both buckets. The app neither lists nor reads as anon or authenticated.

-- Every Storage request queues behind the drop's lock wait: give up after 3 s, changing nothing.
set lock_timeout = '3s';

drop policy if exists "gallery_public_read" on storage.objects;
drop policy if exists "barber_photos_public_read" on storage.objects;

reset lock_timeout;
