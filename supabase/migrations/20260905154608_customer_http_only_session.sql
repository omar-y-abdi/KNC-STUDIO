-- Return-session contract: the browser receives only an HttpOnly opaque session id. Contact fields
-- are resolved from the server-side email-scoped session and returned only in the authenticated body.
create or replace function public.exchange_customer_booking_access(
  p_challenge_hash text,
  p_session_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
begin
  if p_challenge_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  update public.customer_booking_access_challenges c
  set used_at = pg_catalog.now()
  where c.token_hash = p_challenge_hash
    and c.used_at is null
    and c.expires_at > pg_catalog.now()
  returning c.phone, c.email into v_phone, v_email;
  if not found then return false; end if;
  insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');
  return true;
end;
$$;

revoke execute on function public.exchange_customer_booking_access(text, text)
  from public, anon, authenticated;
grant execute on function public.exchange_customer_booking_access(text, text) to service_role;

create or replace function public.list_customer_bookings_with_access(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
  v_name text;
begin
  select s.phone, s.email into v_phone, v_email
  from public.customer_booking_access_scope(p_session_hash) s;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  select b.customer_name into v_name
  from public.bookings b
  where pg_catalog.lower(b.email) = v_email
  order by b.created_at desc
  limit 1;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'name', coalesce(v_name, ''),
    'phone', v_phone,
    'email', v_email,
    'bookings', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'barber_id', b.barber_id, 'service_name', b.service_name,
      'price', b.price, 'duration_min', b.duration_min, 'start_at', b.start_at
    ) order by b.start_at desc) from public.bookings b
      where pg_catalog.lower(b.email) = v_email and b.status = 'confirmed'), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.list_customer_bookings_with_access(text) from public, anon, authenticated;
grant execute on function public.list_customer_bookings_with_access(text) to service_role;

create or replace function public.establish_customer_booking_session(
  p_access_token text,
  p_session_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
begin
  if p_access_token !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select scope.phone, scope.email into v_phone, v_email
  from public.customer_booking_access_scope(p_access_token) scope;
  if not found then return false; end if;
  insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');
  return true;
end;
$$;

revoke execute on function public.establish_customer_booking_session(text, text)
  from public, anon, authenticated;
grant execute on function public.establish_customer_booking_session(text, text) to service_role;
