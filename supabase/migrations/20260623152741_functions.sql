-- Migration 0003 — RPC functions. Source of truth: BACKEND_SPEC.md §4.
--
-- ALL functions are `security definer` + `set search_path = ''` (so every object is schema-
-- qualified — public.* for our tables, pg_catalog.* for built-ins). They are the ONLY way anon
-- touches `bookings`. Each returns a JSONB Result object mirroring the frontend Result unions and
-- NEVER leaks another customer's row (lookup/cancel only ever match the EXACT proven contact).
-- `grant execute ... to anon` exposes them to the public anon key.

-- ---------------------------------------------------------------------------------------------
-- 1. create_booking — insert a confirmed booking. Catches the exclusion constraint (slot taken),
--    rejects past start times, and validates the method/contact pairing. Echoes NO phone/email.
--
--    DEVIATION from BACKEND_SPEC.md §4.1: the spec's listed signature has 10 params and omits the
--    customer name, yet §2 makes `customer_name` NOT NULL and §1 defines `Booking.customerName`.
--    The documented call path therefore cannot populate the real name. We add a trailing
--    `p_customer_name text` (11th param) and insert it into `customer_name`. The TypeScript adapter
--    (§7.2) MUST pass `booking.customerName` as this extra argument. The success payload still
--    echoes NO name (matches §4.1 exactly).
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_booking(
  p_barber_id     text,
  p_service_id    text,
  p_service_name  text,
  p_price         int,
  p_duration_min  int,
  p_start_at      timestamptz,
  p_method        text,
  p_phone         text,
  p_email         text,
  p_lang          text,
  p_customer_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end_at timestamptz;
  v_row    public.bookings;
begin
  -- Reject past (or now) start times.
  if p_start_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  -- Method/contact pairing: sms needs phone, email needs email.
  if not (
    (p_method = 'sms'   and p_phone is not null and p_phone <> '') or
    (p_method = 'email' and p_email is not null and p_email <> '')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  v_end_at := p_start_at + pg_catalog.make_interval(mins => p_duration_min);

  begin
    insert into public.bookings (
      barber_id, service_id, service_name, price, duration_min,
      start_at, end_at, customer_name, method, phone, email, lang
    ) values (
      p_barber_id, p_service_id, p_service_name, p_price, p_duration_min,
      p_start_at, v_end_at, p_customer_name, p_method,
      -- only persist the contact for the chosen channel
      case when p_method = 'sms'   then p_phone else null end,
      case when p_method = 'email' then p_email else null end,
      p_lang
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      -- SQLSTATE 23P01: another CONFIRMED booking already overlaps this barber+time.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation then
      -- SQLSTATE 23514: a column CHECK failed (e.g. a malformed phone/email/length from a direct
      -- anon caller bypassing the frontend's own validation). Return a clean Result, not a raw
      -- DB error. The frontend pre-validates, so this is defense in depth.
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_id',   v_row.service_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'duration_min', v_row.duration_min,
      'start_at',     v_row.start_at,
      'end_at',       v_row.end_at,
      'method',       v_row.method,
      'lang',         v_row.lang
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. taken_slots — time ranges of CONFIRMED bookings for a barber overlapping [p_from, p_to).
--    Returns ONLY time ranges (no PII) so it is safe for anon; the client greys overlapping slots.
-- ---------------------------------------------------------------------------------------------
create or replace function public.taken_slots(
  p_barber_id text,
  p_from      timestamptz,
  p_to        timestamptz
) returns table (start_at timestamptz, end_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select b.start_at, b.end_at
  from public.bookings b
  where b.barber_id = p_barber_id
    and b.status = 'confirmed'
    and b.start_at < p_to
    and b.end_at   > p_from
  order by b.start_at asc;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. lookup_booking — find the caller's NEXT upcoming confirmed booking by proven contact.
--    Only ever returns a row whose contact EXACTLY matches the input -> no enumeration of others.
-- ---------------------------------------------------------------------------------------------
create or replace function public.lookup_booking(
  p_contact text,
  p_method  text
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
    and (
      (p_method = 'sms'   and b.phone = p_contact) or
      (p_method = 'email' and pg_catalog.lower(b.email) = pg_catalog.lower(p_contact))
    )
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
      'method',       p_method,
      'contact',      p_contact
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. cancel_booking — cancel a confirmed booking by id AND proven contact. The contact guard
--    means a guessed id alone cannot cancel someone else's booking. Idempotent: a second call
--    finds nothing (already cancelled) -> not_found.
-- ---------------------------------------------------------------------------------------------
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
    and (b.phone = p_contact or pg_catalog.lower(b.email) = pg_catalog.lower(p_contact))
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

-- ---------------------------------------------------------------------------------------------
-- 5. create_review — validate + insert a published review, returning the stored row.
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_review(
  p_name   text,
  p_rating int,
  p_text   text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.reviews;
begin
  if p_name is null
     or pg_catalog.char_length(p_name) < 1 or pg_catalog.char_length(p_name) > 80
     or p_rating is null or p_rating < 1 or p_rating > 5
     or p_text is null
     or pg_catalog.char_length(p_text) < 1 or pg_catalog.char_length(p_text) > 1000
  then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.reviews (name, rating, text, published)
  values (p_name, p_rating::smallint, p_text, true)
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'review', pg_catalog.jsonb_build_object(
      'id',     v_row.id,
      'name',   v_row.name,
      'rating', v_row.rating,
      'text',   v_row.text
    )
  );
end;
$$;

-- Least privilege: a SECURITY DEFINER function runs as the table OWNER, so its EXECUTE grant is a
-- privilege boundary. Strip the default PUBLIC execute, then grant ONLY the anon role (the browser's
-- single credential). There are no authenticated end-users in this static app; service_role is
-- server-only and never calls these. This keeps the owner-powered functions reachable solely by anon.
revoke execute on function public.create_booking(text, text, text, int, int, timestamptz, text, text, text, text, text) from public;
revoke execute on function public.taken_slots(text, timestamptz, timestamptz)                                       from public;
revoke execute on function public.lookup_booking(text, text)                                                        from public;
revoke execute on function public.cancel_booking(uuid, text)                                                        from public;
revoke execute on function public.create_review(text, int, text)                                                    from public;

-- Expose the RPCs to the public anon key (the browser's only credential). These are the sole
-- entry points to `bookings`; each self-validates and only ever touches the caller's own contact.
grant execute on function public.create_booking(text, text, text, int, int, timestamptz, text, text, text, text, text) to anon;
grant execute on function public.taken_slots(text, timestamptz, timestamptz)                                       to anon;
grant execute on function public.lookup_booking(text, text)                                                        to anon;
grant execute on function public.cancel_booking(uuid, text)                                                        to anon;
grant execute on function public.create_review(text, int, text)                                                    to anon;
