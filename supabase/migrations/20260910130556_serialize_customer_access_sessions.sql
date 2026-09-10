-- Preserve permanent links while making session minting and revocation serializable per customer.
-- No stored data is changed. Existing sessions retain their original expiry.
-- Forward rollback: restore prior function bodies; do not restore the known revocation race.

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
  if p_access_token is null or p_session_hash is null or p_access_token !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  -- p_access_token is the lookup hash, never the raw email credential. Only permanent links
  -- mint a new session; existing sessions keep their original server-side expiry.
  -- SHARE conflicts with token rotation/replacement until this session insertion commits.
  select t.phone, t.email into v_phone, v_email
  from public.customer_booking_access_tokens t
  where t.token_hash = p_access_token
  for share;
  if not found then return false; end if;
  insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');
  return true;
end;
$$;

create or replace function public.rotate_customer_booking_access_token(
  p_email text,
  p_token_hash text,
  p_token_ciphertext text,
  p_access_code text,
  p_lang text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_phone text;
  v_challenge_id uuid;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or p_access_code !~ '^[0-9a-f]{64}$'
     or p_lang not in ('sv', 'en') then
    return false;
  end if;

  select b.phone into v_phone
  from public.bookings b
  where pg_catalog.lower(b.email) = v_email
    and b.status = 'confirmed'
    and b.phone ~ '^07[0-9]{8}$'
  order by b.created_at desc, b.id desc
  limit 1;

  if not found then
    return false;
  end if;

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, v_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        token_hash = excluded.token_hash,
        token_ciphertext = excluded.token_ciphertext,
        generation = public.customer_booking_access_tokens.generation + 1,
        updated_at = pg_catalog.now();

  -- Wait for any in-flight legacy exchange before taking the session-deletion snapshot.
  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;

  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;

  insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_token_hash, 'infinity'::timestamptz)
  returning id into v_challenge_id;

  perform public.queue_external_action(
    'customer_access_email_send',
    v_challenge_id::text,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_challenge_id,
      'lang', p_lang
    )
  );

  return true;
end;
$$;

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
      'id', b.id, 'barber_id', b.barber_id, 'barber_name', barber.name,
      'service_name', b.service_name,
      'price', b.price, 'duration_min', b.duration_min, 'start_at', b.start_at
    ) order by b.start_at desc) from public.bookings b
      join public.barbers barber on barber.id = b.barber_id
      where pg_catalog.lower(b.email) = v_email and b.status = 'confirmed'), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.establish_customer_booking_session(text, text) from public, anon, authenticated;
grant execute on function public.establish_customer_booking_session(text, text) to service_role;
revoke execute on function public.rotate_customer_booking_access_token(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rotate_customer_booking_access_token(text, text, text, text, text) to service_role;
revoke execute on function public.list_customer_bookings_with_access(text) from public, anon, authenticated;
grant execute on function public.list_customer_bookings_with_access(text) to service_role;
