-- A barber edits their own name, handles and bios and uploads work pictures. The new table is closed
-- to every API role: the panel goes through the staff_* functions, upload-image the internal_* ones.

-- Every catalog read queues behind the column add's lock wait: give up after 3 s, changing nothing.
set lock_timeout = '3s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('barber-work', 'barber-work', true, 512000, '{image/webp}')
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Before the foreign key below, so the lock on barbers is taken once at its strongest.
alter table public.barbers
  add column if not exists tiktok text not null default ''
    constraint barbers_tiktok_check check (pg_catalog.char_length(tiktok) <= 60);

create table if not exists public.barber_work_photos (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  barber_id    text not null references public.barbers(id) on delete cascade,
  storage_path text not null unique,
  hidden       boolean not null default false,
  created_at   timestamptz not null default pg_catalog.now(),
  constraint barber_work_photos_path_len check (
    pg_catalog.char_length(storage_path) between 1 and 300
  )
);

create index if not exists barber_work_photos_barber_created_idx
  on public.barber_work_photos (barber_id, created_at desc);

alter table public.barber_work_photos enable row level security;
revoke all on table public.barber_work_photos from public, anon, authenticated, service_role;

create or replace function public.staff_barber_profile(p_barber_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select pg_catalog.jsonb_build_object(
    'name', b.name,
    'ig', b.ig,
    'tiktok', b.tiktok,
    'bio_sv', b.bio_sv,
    'bio_en', b.bio_en
  ) into v_profile
  from public.barbers b
  where b.id = p_barber_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'profile', v_profile,
    'work', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', w.id,
        'path', w.storage_path,
        'hidden', w.hidden
      ) order by w.created_at desc, w.id desc)
      from public.barber_work_photos w
      where w.barber_id = p_barber_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.staff_barber_profile(text)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_barber_profile(text)
  to authenticated;

create or replace function public.staff_update_barber_profile(
  p_barber_id text,
  p_name text,
  p_ig text,
  p_tiktok text,
  p_bio_sv text,
  p_bio_en text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(p_name);
  v_ig text := pg_catalog.btrim(p_ig);
  v_tiktok text := pg_catalog.btrim(p_tiktok);
  v_profile jsonb;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 60 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  if pg_catalog.starts_with(v_ig, '@') then
    v_ig := pg_catalog.substr(v_ig, 2);
  end if;
  if pg_catalog.starts_with(v_tiktok, '@') then
    v_tiktok := pg_catalog.substr(v_tiktok, 2);
  end if;
  if v_ig is null
     or v_ig !~ '^[A-Za-z0-9_.]{0,30}$'
     or v_tiktok is null
     or v_tiktok !~ '^[A-Za-z0-9_.]{0,30}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_handle');
  end if;

  if p_bio_sv is null
     or p_bio_en is null
     or pg_catalog.char_length(p_bio_sv) > 600
     or pg_catalog.char_length(p_bio_en) > 600 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_bio');
  end if;

  update public.barbers b
  set name = v_name,
      ig = v_ig,
      tiktok = v_tiktok,
      bio_sv = p_bio_sv,
      bio_en = p_bio_en
  where b.id = p_barber_id
  returning pg_catalog.jsonb_build_object(
    'name', b.name,
    'ig', b.ig,
    'tiktok', b.tiktok,
    'bio_sv', b.bio_sv,
    'bio_en', b.bio_en
  ) into v_profile;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true, 'profile', v_profile);
end;
$$;

revoke all on function public.staff_update_barber_profile(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_update_barber_profile(text, text, text, text, text, text)
  to authenticated;

create or replace function public.staff_set_barber_work_photo_hidden(p_id uuid, p_hidden boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.barber_work_photos w
  set hidden = p_hidden
  where w.id = p_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.staff_set_barber_work_photo_hidden(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_set_barber_work_photo_hidden(uuid, boolean)
  to authenticated;

create or replace function public.internal_add_barber_work_photo(p_barber_id text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_barber_id is null
     or p_path is null
     or not pg_catalog.starts_with(p_path, p_barber_id || '/')
     or pg_catalog.char_length(p_path) > 300 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_path');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.barber_work_photos (barber_id, storage_path)
  values (p_barber_id, p_path)
  returning id into v_id;

  return pg_catalog.jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.internal_add_barber_work_photo(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.internal_add_barber_work_photo(text, text)
  to service_role;

create or replace function public.internal_delete_barber_work_photo(p_barber_id text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.barber_work_photos w
  where w.barber_id = p_barber_id
    and w.storage_path = p_path;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.internal_delete_barber_work_photo(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.internal_delete_barber_work_photo(text, text)
  to service_role;

-- Replacing keeps the owner and the grants of the baseline definition.
create or replace function public.public_booking_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'barbers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'ig', b.ig,
        'role_sv', b.role_sv,
        'role_en', b.role_en,
        'bio_sv', b.bio_sv,
        'bio_en', b.bio_en,
        'active', b.active,
        'sort_order', b.sort_order,
        'photo_path', p.storage_path,
        'tiktok', b.tiktok,
        'work', coalesce((
          select pg_catalog.jsonb_agg(w.storage_path order by w.created_at desc, w.id desc)
          from public.barber_work_photos w
          where w.barber_id = b.id and not w.hidden
        ), '[]'::jsonb)
      ) order by b.sort_order, b.name)
      from public.barbers b
      left join public.barber_photos p on p.barber_id = b.id
      where b.active
    ), '[]'::jsonb),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id,
        'barber_id', s.barber_id,
        'name', s.name,
        'price', s.price,
        'duration_min', s.duration_min,
        'active', s.active,
        'sort_order', s.sort_order,
        'available_weekdays', s.available_weekdays
      ) order by s.barber_id, s.sort_order, s.name)
      from public.services s
      join public.barbers b on b.id = s.barber_id and b.active
      where s.active
    ), '[]'::jsonb)
  );
$$;

reset lock_timeout;
