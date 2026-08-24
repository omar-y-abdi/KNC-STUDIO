-- Owner-managed homepage logo. Bytes remain in the existing public gallery bucket, but only the
-- authenticated upload gateway may create, replace, or delete logo objects. The current path lives
-- in existing `site_settings`, keeping public chrome, email contact CMS, Worker discovery, and admin
-- writes on their existing authority seams.

insert into public.site_settings (key, value)
values
  ('homepage_logo_path', ''),
  ('homepage_logo_scale', 'md'),
  ('homepage_logo_style', 'classic')
on conflict (key) do nothing;

create or replace function public.internal_replace_homepage_logo(
  p_expected_path text,
  p_new_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_path text;
  v_job_id uuid;
begin
  if p_expected_path is null
     or p_new_path is null
     or (p_expected_path <> ''
       and p_expected_path !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
     or p_new_path !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
     or pg_catalog.char_length(p_new_path) > 300 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('homepage-logo', 0)
  );

  select nullif(s.value, '') into v_current_path
  from public.site_settings s
  where s.key = 'homepage_logo_path'
  for update;

  if coalesce(v_current_path, '') <> p_expected_path then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  insert into public.site_settings (key, value)
  values ('homepage_logo_path', p_new_path)
  on conflict (key) do update set value = excluded.value;

  if v_current_path is not null then
    v_job_id := public.queue_storage_deletion('gallery', v_current_path);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'previous_path', v_current_path,
    'deletion_id', v_job_id
  );
end;
$$;

create or replace function public.internal_remove_homepage_logo(p_expected_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_path text;
  v_job_id uuid;
begin
  if p_expected_path is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('homepage-logo', 0)
  );

  select nullif(s.value, '') into v_current_path
  from public.site_settings s
  where s.key = 'homepage_logo_path'
  for update;

  if v_current_path is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_current_path <> p_expected_path then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  update public.site_settings set value = '' where key = 'homepage_logo_path';
  v_job_id := public.queue_storage_deletion('gallery', v_current_path);
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bucket', 'gallery',
    'path', v_current_path,
    'deletion_id', v_job_id
  );
end;
$$;

revoke execute on function public.internal_replace_homepage_logo(text, text)
  from public, anon, authenticated;
revoke execute on function public.internal_remove_homepage_logo(text)
  from public, anon, authenticated;
grant execute on function public.internal_replace_homepage_logo(text, text) to service_role;
grant execute on function public.internal_remove_homepage_logo(text) to service_role;

-- The reconciler considers a referenced logo durable inventory, never stale garbage.
create or replace function public.queue_orphaned_storage_objects()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object record;
  v_queued integer := 0;
begin
  for v_object in
    select o.bucket_id, o.name
    from storage.objects o
    where o.bucket_id in ('gallery', 'barber-photos')
      and o.created_at < pg_catalog.now() - interval '30 minutes'
      and not exists (
        select 1 from public.external_action_jobs j
        where j.action_type = 'storage_object_delete'
          and j.dedupe_key = o.bucket_id || ':' || o.name
      )
      and (
        (o.bucket_id = 'gallery' and not exists (
          select 1 from public.gallery_images g where g.storage_path = o.name
        ) and not exists (
          select 1 from public.site_settings s
          where s.key = 'homepage_logo_path' and s.value = o.name
        ))
        or
        (o.bucket_id = 'barber-photos' and not exists (
          select 1 from public.barber_photos p where p.storage_path = o.name
        ))
      )
    order by o.created_at, o.id
    limit 100
  loop
    perform public.queue_external_action(
      'storage_object_delete',
      v_object.bucket_id || ':' || v_object.name,
      pg_catalog.jsonb_build_object('bucket', v_object.bucket_id, 'path', v_object.name)
    );
    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

-- The public site, Worker metadata, and transactional sender all consume this whitelisted contract.
-- Logo settings are public presentation metadata, not credentials.
create or replace function public.public_business_discovery()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'settings', coalesce((
      select pg_catalog.jsonb_object_agg(s.key, s.value)
      from public.site_settings s
      where s.key = any (array[
        'homepage_scale', 'about_scale', 'homepage_logo_path', 'homepage_logo_scale',
        'homepage_logo_style',
        'business_name', 'business_email', 'business_phone_display', 'business_phone_tel',
        'business_street', 'business_postal_code', 'business_city', 'business_maps_href',
        'cancellation_policy_hours',
        'seo_title_sv', 'seo_description_sv', 'seo_title_en', 'seo_description_en'
      ]::text[])
    ), '{}'::jsonb),
    'barbers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'name', b.name
      ) order by b.sort_order, b.id)
      from public.barbers b
      where b.active = true
    ), '[]'::jsonb),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id,
        'barber_id', s.barber_id,
        'price', s.price
      ) order by s.barber_id, s.sort_order, s.id)
      from public.services s
      join public.barbers b on b.id = s.barber_id and b.active = true
      where s.active = true
    ), '[]'::jsonb),
    'schedules', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'barber_id', s.barber_id,
        'weekday', s.weekday,
        'start_min', s.start_min,
        'end_min', s.end_min
      ) order by s.weekday, s.start_min, s.barber_id)
      from public.barber_schedules s
      join public.barbers b on b.id = s.barber_id and b.active = true
      where s.working = true
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.public_business_discovery() from public;
grant execute on function public.public_business_discovery() to anon, authenticated, service_role;
