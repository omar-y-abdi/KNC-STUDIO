-- Permanent, email-scoped customer links. Only the current high-entropy token hash remains valid;
-- rotating a link replaces that hash in-place, so previous links become unusable without retaining
-- a credential history. The encrypted token is needed only so later booking-confirmation emails can
-- reuse the current link instead of rotating it behind the customer's back.

create table public.customer_booking_access_tokens (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  phone            text not null,
  token_hash       text not null unique,
  token_ciphertext text not null,
  generation       bigint not null default 1,
  created_at       timestamptz not null default pg_catalog.now(),
  updated_at       timestamptz not null default pg_catalog.now(),
  constraint customer_booking_access_tokens_email_check check (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    and pg_catalog.char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint customer_booking_access_tokens_phone_check check (phone ~ '^07[0-9]{8}$'),
  constraint customer_booking_access_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_booking_access_tokens_ciphertext_check check (
    pg_catalog.char_length(token_ciphertext) between 40 and 700
    and token_ciphertext ~ '^v1\.[A-Za-z0-9_-]+$'
  ),
  constraint customer_booking_access_tokens_generation_check check (generation > 0)
);

alter table public.customer_booking_access_tokens enable row level security;
revoke all on table public.customer_booking_access_tokens
  from public, anon, authenticated, service_role;

-- Booking mail asks for the email's existing encrypted token. Candidate credentials are inserted
-- only for the first confirmed booking; later confirmations update the remembered phone but never
-- rotate the link.
create or replace function public.ensure_customer_booking_access_token(
  p_email text,
  p_phone text,
  p_token_hash text,
  p_token_ciphertext text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_row public.customer_booking_access_tokens;
begin
  if p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$' then
    return null;
  end if;

  if not exists (
    select 1
    from public.bookings b
    where b.phone = p_phone
      and pg_catalog.lower(b.email) = v_email
      and b.status = 'confirmed'
  ) then
    return null;
  end if;

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, p_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        updated_at = pg_catalog.now()
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'token_ciphertext', v_row.token_ciphertext,
    'generation', v_row.generation
  );
end;
$$;

-- Recovery path for a deliberately rotated encryption salt or corrupted ciphertext. Ordinary
-- confirmation delivery uses ensure_customer_booking_access_token() and never reaches this path.
create or replace function public.replace_customer_booking_access_token(
  p_email text,
  p_phone text,
  p_token_hash text,
  p_token_ciphertext text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or not exists (
       select 1 from public.bookings b
       where b.phone = p_phone
         and pg_catalog.lower(b.email) = v_email
         and b.status = 'confirmed'
     ) then
    return false;
  end if;

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, p_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        token_hash = excluded.token_hash,
        token_ciphertext = excluded.token_ciphertext,
        generation = public.customer_booking_access_tokens.generation + 1,
        updated_at = pg_catalog.now();

  return true;
end;
$$;

-- Email-only fresh-link request. The response remains enumeration-safe: callers receive the same
-- public success response whether a matching confirmed booking exists or not. A matching request
-- atomically rotates the permanent token and queues its durable email delivery.
create or replace function public.rotate_customer_booking_access_token(
  p_email text,
  p_token_hash text,
  p_token_ciphertext text,
  p_access_code text,
  p_lang text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_phone text;
  v_row public.customer_booking_access_tokens;
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
        updated_at = pg_catalog.now()
  returning * into v_row;

  -- Existing durable worker contract uses a short-lived challenge only to authorize email dispatch.
  -- It does not authorize booking access; the permanent table above does.
  update public.customer_booking_access_challenges c
  set used_at = pg_catalog.now()
  where c.email = v_email
    and c.used_at is null;

  insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_token_hash, pg_catalog.now() + interval '15 minutes')
  returning id into v_challenge_id;

  perform public.queue_external_action(
    'customer_access_email_send',
    v_challenge_id::text,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_challenge_id,
      'access_code', p_access_code,
      'lang', p_lang
    )
  );

  return true;
end;
$$;

-- Keep legacy 20-minute sessions valid for already-sent fragment links while adding the permanent
-- token hash. New links call list/cancel directly with their permanent token.
create or replace function public.customer_booking_access_scope(p_session_hash text)
returns table(phone text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select scope.phone, scope.email
  from (
    select t.phone, t.email, 0 as priority
    from public.customer_booking_access_tokens t
    where t.token_hash = p_session_hash
      and p_session_hash ~ '^[0-9a-f]{64}$'
    union all
    select s.phone, s.email, 1 as priority
    from public.customer_booking_access_sessions s
    where s.token_hash = p_session_hash
      and s.expires_at > pg_catalog.now()
      and p_session_hash ~ '^[0-9a-f]{64}$'
  ) scope
  order by scope.priority
  limit 1;
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
begin
  select s.phone, s.email into v_phone, v_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'phone', v_phone,
    'bookings', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'barber_id', b.barber_id,
        'service_name', b.service_name,
        'price', b.price,
        'duration_min', b.duration_min,
        'start_at', b.start_at
      ) order by b.start_at desc)
      from public.bookings b
      where pg_catalog.lower(b.email) = v_email
        and b.status = 'confirmed'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.cancel_customer_booking_with_access(
  p_booking_id uuid,
  p_session_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
  v_cutoff_hours integer;
begin
  select s.phone, s.email into v_phone, v_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;

  select case
           when s.value ~ '^[0-9]{1,3}$' then least(s.value::integer, 168)
           else 24
         end
    into v_cutoff_hours
  from public.site_settings s
  where s.key = 'cancellation_policy_hours';

  update public.bookings b
  set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id
    and b.status = 'confirmed'
    and b.start_at > pg_catalog.now() + pg_catalog.make_interval(hours => coalesce(v_cutoff_hours, 24))
    and pg_catalog.lower(b.email) = v_email;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.ensure_customer_booking_access_token(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.replace_customer_booking_access_token(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.rotate_customer_booking_access_token(text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.customer_booking_access_scope(text)
  from public, anon, authenticated;
revoke execute on function public.list_customer_bookings_with_access(text)
  from public, anon, authenticated;
revoke execute on function public.cancel_customer_booking_with_access(uuid, text)
  from public, anon, authenticated;

grant execute on function public.ensure_customer_booking_access_token(text, text, text, text)
  to service_role;
grant execute on function public.replace_customer_booking_access_token(text, text, text, text)
  to service_role;
grant execute on function public.rotate_customer_booking_access_token(text, text, text, text, text)
  to service_role;
grant execute on function public.customer_booking_access_scope(text) to service_role;
grant execute on function public.list_customer_bookings_with_access(text) to service_role;
grant execute on function public.cancel_customer_booking_with_access(uuid, text) to service_role;

update public.email_templates
set note = case lang
  when 'sv' then 'Länken gäller tills du begär en ny. Då slutar den tidigare länken att fungera.'
  else 'This link remains valid until you request a new one. The previous link then stops working.'
end
where template = 'customer_booking_access';
