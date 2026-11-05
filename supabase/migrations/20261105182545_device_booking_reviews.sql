-- Additive browser RPC: deploy this migration before the updated public-booking-actions Edge.
-- Keep create_review_with_access(text,text,int,text) for existing/rolling Edge deployments.
create function public.create_review_for_browser(
  p_session_hash text,
  p_receipt_hash text,
  p_phone text,
  p_rating int,
  p_text text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_email text;
  v_booking_id uuid;
  v_customer text;
  v_first text;
  v_second text;
  v_display text;
  v_row public.reviews;
begin
  if p_phone is null
     or p_phone !~ '^07[0-9]{8}$'
     or p_rating is null or p_rating < 1 or p_rating > 5
     or p_text is null
     or pg_catalog.char_length(p_text) < 1
     or pg_catalog.char_length(p_text) > 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.email into v_scope_email
  from public.customer_booking_access_scope(p_session_hash) s;

  -- Use the same verified-profile/receipt scope as list and cancellation. A receipt
  -- never proves ownership of an email or phone, including on a shared browser.
  select b.id, b.customer_name
    into v_booking_id, v_customer
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = p_phone
    and (pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_scope_email))
      or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_scope_email)))
    and b.end_at < pg_catalog.now()
    and not exists (
      select 1 from public.reviews r where r.booking_id = b.id
    )
  order by b.end_at desc, b.id desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  v_customer := pg_catalog.btrim(v_customer);
  v_first := pg_catalog.split_part(v_customer, ' ', 1);
  v_second := pg_catalog.split_part(v_customer, ' ', 2);
  v_display := v_first
    || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;
  v_display := pg_catalog.left(v_display, 80);
  if v_display = '' then
    v_display := 'Kund';
  end if;

  begin
    insert into public.reviews (name, rating, text, booking_id, published)
    values (v_display, p_rating::smallint, p_text, v_booking_id, true)
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'review', pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'rating', v_row.rating,
      'text', v_row.text
    )
  );
end;
$$;

revoke execute on function public.create_review_for_browser(text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.create_review_for_browser(text, text, text, int, text) to service_role;
