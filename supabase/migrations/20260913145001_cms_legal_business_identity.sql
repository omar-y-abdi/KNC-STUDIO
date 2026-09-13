-- Reuse owner-only site_settings RLS and public discovery for legal identity.
-- No legal identity is assumed from the public salon name.
create or replace function public.normalize_site_setting_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(new.value);
begin
  case new.key
    when 'homepage_scale', 'about_scale', 'homepage_logo_scale' then
      if v_value not in ('sm', 'md', 'lg', 'xl') then
        raise exception using errcode = '22023', message = 'invalid scale setting';
      end if;
    when 'homepage_logo_style' then
      if v_value not in ('classic', 'monochrome') then
        raise exception using errcode = '22023', message = 'invalid homepage logo style';
      end if;
    when 'homepage_logo_path' then
      if v_value <> ''
         and v_value !~ '^logo/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' then
        raise exception using errcode = '22023', message = 'invalid homepage logo path';
      end if;
    when 'business_name', 'business_street', 'business_city' then
      if char_length(v_value) not between 1 and 160 then
        raise exception using errcode = '22023', message = 'invalid business text setting';
      end if;
    when 'business_legal_name' then
      if char_length(v_value) > 160 or v_value ~ '[[:cntrl:]]' then
        raise exception using errcode = '22023', message = 'invalid legal business name';
      end if;
    when 'business_org_number' then
      if v_value <> '' and v_value !~ '^[0-9]{6}-?[0-9]{4}$' then
        raise exception using errcode = '22023', message = 'invalid business registration number';
      end if;
      if v_value <> '' then
        v_value := pg_catalog.replace(v_value, '-', '');
        v_value := pg_catalog.left(v_value, 6) || '-' || pg_catalog.right(v_value, 4);
      end if;
    when 'business_email' then
      v_value := pg_catalog.lower(v_value);
      if v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception using errcode = '22023', message = 'invalid business email setting';
      end if;
    when 'business_phone_display' then
      if v_value <> '' and char_length(v_value) not between 1 and 80 then
        raise exception using errcode = '22023', message = 'invalid business phone display setting';
      end if;
    when 'business_phone_tel' then
      v_value := pg_catalog.regexp_replace(v_value, '[[:space:]().-]', '', 'g');
      if v_value <> '' and v_value !~ '^\+?[0-9]{3,20}$' then
        raise exception using errcode = '22023', message = 'invalid business phone setting';
      end if;
    when 'business_postal_code' then
      v_value := pg_catalog.regexp_replace(v_value, '[[:space:]]', '', 'g');
      if v_value !~ '^[0-9]{5}$' then
        raise exception using errcode = '22023', message = 'invalid business postal code setting';
      end if;
      v_value := pg_catalog.left(v_value, 3) || ' ' || pg_catalog.right(v_value, 2);
    when 'business_maps_href' then
      if v_value <> '' and v_value !~ '^https://[^[:space:]]+$' then
        raise exception using errcode = '22023', message = 'invalid business maps URL setting';
      end if;
    when 'cancellation_policy_hours' then
      if v_value !~ '^[0-9]{1,3}$' or v_value::integer not between 1 and 168 then
        raise exception using errcode = '22023', message = 'invalid cancellation policy setting';
      end if;
    when 'seo_title_sv', 'seo_title_en' then
      if char_length(v_value) not between 1 and 120 then
        raise exception using errcode = '22023', message = 'invalid SEO title setting';
      end if;
    when 'seo_description_sv', 'seo_description_en' then
      if char_length(v_value) not between 1 and 500 then
        raise exception using errcode = '22023', message = 'invalid SEO description setting';
      end if;
    else
      new.value := v_value;
      return new;
  end case;

  new.value := v_value;
  return new;
end;
$$;

insert into public.site_settings (key, value)
values ('business_legal_name', ''), ('business_org_number', '')
on conflict (key) do nothing;

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
        'business_legal_name', 'business_org_number',
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
