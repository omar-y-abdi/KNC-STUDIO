-- An email worker may read old ciphertext while a fresh-link request rotates the token.
-- Repair only that observed generation; a concurrent winner must remain authoritative.
-- Old callers omit the generation and fail closed until send-confirmation is updated.
drop function public.replace_customer_booking_access_token(text, text, text, text);

create function public.replace_customer_booking_access_token(
  p_email text,
  p_phone text,
  p_token_hash text,
  p_token_ciphertext text,
  p_expected_generation bigint default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if v_email is null or p_phone is null or p_token_hash is null
     or p_token_ciphertext is null or p_expected_generation is null
     or p_expected_generation < 1
     or p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or not exists (
       select 1 from public.bookings b
       where b.phone = p_phone and pg_catalog.lower(b.email) = v_email
         and b.status = 'confirmed'
     ) then
    return false;
  end if;

  update public.customer_booking_access_tokens t
  set phone = p_phone, token_hash = p_token_hash, token_ciphertext = p_token_ciphertext,
      generation = t.generation + 1, updated_at = pg_catalog.now()
  where t.email = v_email and t.generation = p_expected_generation;
  if not found then return false; end if;

  -- Same lock order as fresh-link rotation: token, challenges, sessions.
  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;
  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;
  return true;
end;
$$;

revoke execute on function public.replace_customer_booking_access_token(text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.replace_customer_booking_access_token(text, text, text, text, bigint)
  to service_role;
