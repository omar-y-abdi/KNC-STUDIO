-- Returning-device contact is a form hint only; existing session/receipt authority is unchanged.
create or replace function public.list_customer_bookings_for_browser(p_session_hash text, p_receipt_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_phone text;
  v_booking_phone text;
  v_name text;
  v_receipt boolean;
  v_booking_contact jsonb;
begin
  select s.email, s.phone into v_email, v_phone
  from public.customer_booking_access_scope(p_session_hash) s;
  select exists(select 1 from public.customer_booking_receipts r
    where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()) into v_receipt;
  if v_email is null and not v_receipt then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  if v_email is not null then
    select b.customer_name, b.phone into v_name, v_booking_phone from public.bookings b
    where pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email)) order by b.created_at desc, b.id desc limit 1;
  else
    -- A form hint is scoped to an exact booking created with this receipt. It is never a
    -- verified profile, and must not expand through a shared phone or email address.
    select pg_catalog.jsonb_build_object('name', b.customer_name, 'phone', b.phone, 'email', b.email)
      into v_booking_contact
    from public.bookings b
    where b.id in (select public.customer_device_booking_ids(p_receipt_hash, null))
    order by b.created_at desc, b.id desc limit 1;
  end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', true, 'authority', case when v_email is null then 'device' else 'verified' end,
    'email', v_email, 'phone', coalesce(v_booking_phone, v_phone), 'name', v_name, 'receipt_active', v_receipt,
    'booking_contact', v_booking_contact,
    'emails', case when v_email is not null then (select jsonb_agg(e order by e)
      from public.customer_profile_emails_for_email(v_email) e) end,
    'phones', case when v_email is not null then (select jsonb_agg(distinct b.phone order by b.phone)
      from public.bookings b where lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
        and b.phone ~ '^07[0-9]{8}$') end,
    'bookings', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'barber_id', b.barber_id, 'barber_name', barber.name,
      'service_name', b.service_name, 'price', b.price, 'duration_min', b.duration_min,
      'start_at', b.start_at
    ) order by b.start_at desc) from public.bookings b
      join public.barbers barber on barber.id = b.barber_id
      where b.status = 'confirmed' and (
        pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
        or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email))
      )), '[]'::jsonb)
  ));
end;
$$;

revoke execute on function public.list_customer_bookings_for_browser(text,text) from public, anon, authenticated;
grant execute on function public.list_customer_bookings_for_browser(text,text) to service_role;
