-- One public, whitelisted business-discovery contract feeds website metadata, machine discovery,
-- and transactional email rendering. Mutable facts remain sourced from their existing CMS/domain
-- tables; callers never maintain a second business profile.

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
        'homepage_scale', 'about_scale',
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

alter publication supabase_realtime add table public.barbers;
alter publication supabase_realtime add table public.services;
alter publication supabase_realtime add table public.barber_schedules;

-- Replace shipped SEO copy that duplicated mutable hours, staff, address, and prices. Owner-customized
-- values are preserved; placeholders keep normal business-name/city edits consistent automatically.
update public.site_settings
set value = '{business_name} – Barbershop i {city} | Boka tid online'
where key = 'seo_title_sv'
  and value = 'Blade & Blend Studio – Barbershop i Göteborg | Boka tid online';
update public.site_settings
set value = '{business_name} är en barbershop i {city}. Välj barberare, behandling och tid och boka online.'
where key = 'seo_description_sv'
  and value = 'Blade & Blend Studio – barbershop på Geijersgatan 10 i Göteborg. Boka tid online hos Hassan, Victor eller Salman. Öppet mån–lör 09–18, klippning från 200 kr.';
update public.site_settings
set value = '{business_name} – Barbershop in {city} | Book online'
where key = 'seo_title_en'
  and value = 'Blade & Blend Studio – Barbershop in Gothenburg | Book online';
update public.site_settings
set value = '{business_name} is a barbershop in {city}. Choose a barber, service, and time and book online.'
where key = 'seo_description_en'
  and value = 'Blade & Blend Studio – barbershop at Geijersgatan 10 in Gothenburg. Book online with Hassan, Victor or Salman. Open Monday to Saturday 09:00–18:00, cuts from 200 kr.';

update public.email_templates
set note = 'Din tid kan följas under "Mina bokningar", avbokningsvillkor {cancellation_hours}h.'
where template = 'customer_confirmation' and lang = 'sv'
  and note = 'Din tid kan följas under "Mina bokningar", avbokningsvillkor 24h.';
update public.email_templates
set note = 'Follow your appointment under "My appointments". Cancellation policy: {cancellation_hours} hours.'
where template = 'customer_confirmation' and lang = 'en'
  and note = 'Follow your appointment under "My appointments". Cancellation policy: 24 hours.';
update public.email_templates
set note = 'Behöver du avboka? Öppna "Mina bokningar". Avbokningsvillkor {cancellation_hours}h.'
where template = 'customer_reminder' and lang = 'sv'
  and note = 'Behöver du avboka? Öppna "Mina bokningar". Avbokningsvillkor 24h.';
update public.email_templates
set note = 'Need to cancel? Open "My appointments". Cancellation policy: {cancellation_hours} hours.'
where template = 'customer_reminder' and lang = 'en'
  and note = 'Need to cancel? Open "My appointments". Cancellation policy: 24 hours.';

update public.email_templates
set subject = 'Din inbjudan till {business_name}',
    intro = 'Du har blivit inbjuden till barberarpanelen hos {business_name}.'
where template = 'auth_invite' and lang = 'sv'
  and subject = 'Din inbjudan till Blade & Blend Studio'
  and intro = 'Du har blivit inbjuden till barberarpanelen hos Blade & Blend Studio.';
update public.email_templates
set subject = 'Your invitation to {business_name}',
    intro = 'You have been invited to the barber panel at {business_name}.'
where template = 'auth_invite' and lang = 'en'
  and subject = 'Your invitation to Blade & Blend Studio'
  and intro = 'You have been invited to the barber panel at Blade & Blend Studio.';
