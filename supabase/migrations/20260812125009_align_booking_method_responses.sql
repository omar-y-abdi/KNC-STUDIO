create or replace function public.lookup_booking(
  p_contact text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bookings;
begin
  select * into v_row
  from public.bookings b
  where b.status = 'confirmed'
    and b.start_at > pg_catalog.now()
    and b.phone = p_contact
  order by b.start_at asc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'start_at',     v_row.start_at,
      'method',       v_row.method,
      'contact',      p_contact
    )
  );
end;
$$;

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_contact    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bookings;
begin
  update public.bookings b
  set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id
    and b.status = 'confirmed'
    and b.phone = p_contact
  returning * into v_row;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'start_at',     v_row.start_at,
      'method',       v_row.method,
      'contact',      p_contact
    )
  );
end;
$$;

revoke execute on function public.lookup_booking(text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.lookup_booking(text) to service_role;
grant execute on function public.cancel_booking(uuid, text) to service_role;
