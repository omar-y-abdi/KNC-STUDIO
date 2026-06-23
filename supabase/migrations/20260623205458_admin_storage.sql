-- Migration 0007 — Storage `gallery` bucket. Source of truth: ADMIN_SPEC.md §1.6 + §2 + §8.
--
-- The gallery bucket holds public salon/cuts photos. Contract:
--   * PUBLIC read   — anyone (anon) may download objects (the public About page builds public
--                     Storage URLs); enforced by `public=true` on the bucket AND a permissive
--                     SELECT policy on storage.objects scoped to this bucket.
--   * OWNER write   — INSERT/UPDATE/DELETE on objects in this bucket only when public.is_owner()
--                     (the salon owner's Auth session). No anon/barber writes.
--
-- Idempotent: the bucket insert uses ON CONFLICT DO NOTHING, and the policies are created only if
-- absent, so a re-applied migration (or one whose objects already exist) does not error.

-- Create the bucket (public read). storage.buckets.id + name are NOT NULL with no default.
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

-- RLS on storage.objects is already enabled by the Storage extension; we add bucket-scoped
-- policies. Guard each CREATE so re-runs are safe (storage.objects is a shared table; we must not
-- clobber other buckets' policies, and CREATE POLICY has no IF NOT EXISTS).
do $$
begin
  -- Public read: anyone may select objects in the gallery bucket.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'gallery_public_read'
  ) then
    create policy gallery_public_read on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'gallery');
  end if;

  -- Owner insert.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'gallery_owner_insert'
  ) then
    create policy gallery_owner_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'gallery' and public.is_owner());
  end if;

  -- Owner update.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'gallery_owner_update'
  ) then
    create policy gallery_owner_update on storage.objects
      for update to authenticated
      using (bucket_id = 'gallery' and public.is_owner())
      with check (bucket_id = 'gallery' and public.is_owner());
  end if;

  -- Owner delete.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass and polname = 'gallery_owner_delete'
  ) then
    create policy gallery_owner_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'gallery' and public.is_owner());
  end if;
end;
$$;
