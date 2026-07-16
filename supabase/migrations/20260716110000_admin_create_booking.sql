-- admin_create_booking — "Reservera kund" (Task 2 §4). Lets the owner (any barber) or a barber (their
-- own schedule) write a booking straight into the schedule from the panel, the way a walk-in / phoned-in
-- customer is handled — no Turnstile, no public gateway. Name / price / phone are all OPTIONAL.
--
-- A manual reservation may have NO contact, so we widen the bookings schema with a 'walkin' method
-- that needs no phone/email (existing 'sms'/'email' rows still satisfy the relaxed checks — a pure
-- widening). A reservation WITH a phone is stored as 'sms', so that customer sees it under
-- "Mina bokningar" exactly like an online booking. The no-double-booking exclusion constraint still
-- applies: you cannot reserve over an existing confirmed booking.

-- --- widen the method + contact constraints ------------------------------------------------------
alter table public.bookings drop constraint bookings_method_check;
alter table public.bookings
  add constraint bookings_method_valid check (method in ('sms', 'email', 'walkin'));

alter table public.bookings drop constraint bookings_contact_matches_method;
alter table public.bookings
  add constraint bookings_contact_matches_method check (
    (method = 'sms'    and phone is not null) or
    (method = 'email'  and email is not null) or
    (method = 'walkin')
  );

-- --- the RPC -------------------------------------------------------------------------------------
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
  -- Authorize: owner may reserve for any barber; a barber only for their own schedule.
  if not (
    public.is_owner()
    or (public.current_barber_id() is not null and p_barber_id = public.current_barber_id())
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- A blank phone → a contact-less 'walkin'; a present phone → 'sms' (so it shows in Mina bokningar).
  v_phone  := nullif(pg_catalog.btrim(coalesce(p_phone, '')), '');
  v_method := case when v_phone is null then 'walkin' else 'sms' end;
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
    when check_violation then
      -- Bad phone shape / name length / duration out of range → a clean Result, not a raw error.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
    when foreign_key_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'duration_min', v_row.duration_min,
      'start_at',     v_row.start_at,
      'end_at',       v_row.end_at,
      'customer_name',v_row.customer_name,
      'method',       v_row.method,
      'phone',        v_row.phone
    )
  );
end;
$$;

-- Callable by signed-in staff (owner/barber); the RPC re-derives authority from the session. Not anon.
revoke execute on function public.admin_create_booking(text, timestamptz, int, text, int, text, text) from public;
grant  execute on function public.admin_create_booking(text, timestamptz, int, text, int, text, text) to authenticated;
