-- barber_photos — one profile photo per barber (Task 2 §3). Replaces the About-section placeholder
-- avatar with a real photo when set. The owner may set any barber's photo; a barber may set ONLY
-- their own. Enforced by RLS on the table AND on the Storage bucket (not the UI).
--
-- Photos live in a public `barber-photos` Storage bucket, one folder per barber (`<barber_id>/<uuid>`),
-- so the bucket policy can scope a barber's writes to their own folder. The table holds the current
-- path (one row per barber) so the public site knows whether a photo exists and where.

create table public.barber_photos (
  barber_id    text primary key references public.barbers(id) on delete cascade,
  storage_path text not null,
  updated_at   timestamptz not null default now(),
  constraint barber_photos_path_len check (char_length(storage_path) between 1 and 300)
);

alter table public.barber_photos enable row level security;
grant select on public.barber_photos to anon, authenticated;
grant insert, update, delete on public.barber_photos to authenticated;

-- Public + authenticated read (the About page needs it; no PII).
create policy barber_photos_select_all on public.barber_photos
  for select to anon, authenticated using (true);
-- Owner writes any row; a barber writes ONLY their own.
create policy barber_photos_insert_owner on public.barber_photos
  for insert to authenticated with check (public.is_owner());
create policy barber_photos_insert_own on public.barber_photos
  for insert to authenticated with check (barber_id = public.current_barber_id());
create policy barber_photos_update_owner on public.barber_photos
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy barber_photos_update_own on public.barber_photos
  for update to authenticated
  using (barber_id = public.current_barber_id())
  with check (barber_id = public.current_barber_id());
create policy barber_photos_delete_owner on public.barber_photos
  for delete to authenticated using (public.is_owner());
create policy barber_photos_delete_own on public.barber_photos
  for delete to authenticated using (barber_id = public.current_barber_id());

-- =============================================================================================
-- Storage bucket `barber-photos` — public read; owner writes any object, a barber writes ONLY
-- objects under their own `<barber_id>/` folder. Guard each CREATE (storage.objects is shared).
-- =============================================================================================
insert into storage.buckets (id, name, public)
values ('barber-photos', 'barber-photos', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_public_read') then
    create policy barber_photos_public_read on storage.objects
      for select to anon, authenticated using (bucket_id = 'barber-photos');
  end if;

  -- Owner: full write on the bucket.
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_owner_insert') then
    create policy barber_photos_owner_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'barber-photos' and public.is_owner());
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_owner_update') then
    create policy barber_photos_owner_update on storage.objects
      for update to authenticated
      using (bucket_id = 'barber-photos' and public.is_owner())
      with check (bucket_id = 'barber-photos' and public.is_owner());
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_owner_delete') then
    create policy barber_photos_owner_delete on storage.objects
      for delete to authenticated using (bucket_id = 'barber-photos' and public.is_owner());
  end if;

  -- Barber: write only objects under their own `<barber_id>/` folder.
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_own_insert') then
    create policy barber_photos_own_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = public.current_barber_id());
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_own_update') then
    create policy barber_photos_own_update on storage.objects
      for update to authenticated
      using (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = public.current_barber_id())
      with check (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = public.current_barber_id());
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'barber_photos_own_delete') then
    create policy barber_photos_own_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = public.current_barber_id());
  end if;
end;
$$;
