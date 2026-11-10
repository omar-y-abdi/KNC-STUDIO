-- Storage: public buckets are read by URL, not listed (checklist item 14b).
--
-- "gallery" and "barber-photos" are public buckets: the Storage API serves an object to anyone who
-- has its URL (/storage/v1/object/public/<bucket>/<path>) without consulting row-level security.
-- The two SELECT policies below were not what made those URLs work. What they added was that
-- anyone holding the anon key could list every object of both buckets through the Storage API.
-- "cms-library" is public in the same way and never had such a policy.
--
-- After this migration storage.objects has no policy for the anon or authenticated role, so
-- neither can list a bucket or read an object row. Nothing in the application lists or downloads
-- with those roles: the site and the admin build public URLs from paths stored in the database,
-- and every upload, copy and removal goes through an Edge Function that uses the service role,
-- which row-level security does not restrict.
--
-- Deployment order: old and new application code behave the same before and after.
--
-- To restore the previous state:
--   create policy "barber_photos_public_read" on storage.objects for select
--     to authenticated, anon using (bucket_id = 'barber-photos');
--   create policy "gallery_public_read" on storage.objects for select
--     to authenticated, anon using (bucket_id = 'gallery');

-- Dropping a policy takes an exclusive lock on storage.objects, and while this statement waits for
-- that lock every Storage request queues behind it. Give up after three seconds: the migration
-- then fails and changes nothing.
set lock_timeout = '3s';

drop policy if exists "gallery_public_read" on storage.objects;
drop policy if exists "barber_photos_public_read" on storage.objects;

-- The setting above is for the session; leave the next migration what it would have had.
reset lock_timeout;
