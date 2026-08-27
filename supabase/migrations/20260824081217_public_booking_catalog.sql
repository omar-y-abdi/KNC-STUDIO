-- One public, server-filtered catalog read replaces separate barber/photo/service requests. This
-- removes frontend fallbacks and lets the app preload truthful booking data before the dialog opens.

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
        'photo_path', p.storage_path
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
        'sort_order', s.sort_order
      ) order by s.barber_id, s.sort_order, s.name)
      from public.services s
      join public.barbers b on b.id = s.barber_id and b.active
      where s.active
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.public_booking_catalog() from public;
grant execute on function public.public_booking_catalog() to anon, authenticated, service_role;
