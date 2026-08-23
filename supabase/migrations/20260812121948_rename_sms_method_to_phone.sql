-- Retire the last SMS-era data-model label. `method` describes which contact field a booking has;
-- no SMS delivery exists. Public bookings use email while manually reserved customers may use a
-- phone number or no contact (`walkin`).

alter table public.bookings drop constraint if exists bookings_method_valid;
alter table public.bookings drop constraint if exists bookings_method_check;
alter table public.bookings drop constraint if exists bookings_contact_matches_method;

update public.bookings
set method = 'phone'
where method = 'sms';

alter table public.bookings
  add constraint bookings_method_valid check (method in ('phone', 'email', 'walkin'));

alter table public.bookings
  add constraint bookings_contact_matches_method check (
    (method = 'phone' and phone is not null) or
    (method = 'email' and email is not null) or
    (method = 'walkin' and phone is null and email is null)
  );

create or replace function public.admin_create_booking(
  p_barber_id     text,
  p_start_at      timestamptz,
  p_duration_min  int,
  p_service_name  text,
  p_price         int,
  p_customer_name text,
  p_phone         text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end_at   timestamptz;
  v_method   text;
  v_phone    text;
  v_row      public.bookings;
begin
  if not (
    public.is_owner()
    or (public.current_barber_id() is not null and p_barber_id = public.current_barber_id())
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_phone  := nullif(pg_catalog.btrim(coalesce(p_phone, '')), '');
  v_method := case when v_phone is null then 'walkin' else 'phone' end;
  v_end_at := p_start_at + pg_catalog.make_interval(mins => p_duration_min);

  begin
    insert into public.bookings (
      barber_id, service_id, service_name, price, duration_min,
      start_at, end_at, customer_name, method, phone, email, lang
    ) values (
      p_barber_id, 'manual', p_service_name, p_price, p_duration_min,
      p_start_at, v_end_at, p_customer_name, v_method, v_phone, null, 'sv'
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation or foreign_key_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',            v_row.id,
      'barber_id',     v_row.barber_id,
      'service_name',  v_row.service_name,
      'price',         v_row.price,
      'duration_min',  v_row.duration_min,
      'start_at',      v_row.start_at,
      'end_at',        v_row.end_at,
      'customer_name', v_row.customer_name,
      'method',        v_row.method,
      'phone',         v_row.phone
    )
  );
end;
$$;

revoke execute on function public.admin_create_booking(
  text, timestamptz, int, text, int, text, text
) from public, anon;
grant execute on function public.admin_create_booking(
  text, timestamptz, int, text, int, text, text
) to authenticated;
