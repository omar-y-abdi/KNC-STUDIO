-- Migration 0012 — phone-gated reviews (PLAN §2): "Förnamn E.", one review per finished haircut.
--
-- WHY: reviews were free-text name + rating + text with no proof the reviewer was ever a customer.
-- We gate review creation on a REAL, FINISHED booking: the reviewer proves a phone that has a
-- confirmed booking whose end_at is in the past, and each such booking can back at most one review.
-- The display name is DERIVED server-side from the booking's customer_name ("Hassan Ahmed" -> "Hassan A.")
-- so the reviewer never types (or spoofs) the shown name.
--
-- The booking requirement IS the anti-spam gate (no Turnstile needed): a bot with no booking only ever
-- gets `no_booking` and creates nothing.

-- ---------------------------------------------------------------------------------------------
-- Schema: tie a review to the booking it came from, one review per booking.
-- ---------------------------------------------------------------------------------------------
-- ON DELETE SET NULL: if a booking is ever hard-deleted, its review survives (anonymized link), it is
-- not cascaded away. Postgres treats multiple NULLs as distinct under a UNIQUE constraint, so the seed
-- reviews (and any legacy rows) with booking_id = NULL are all allowed; the unique only binds REAL
-- booking ids -> exactly one review per finished cut.
alter table public.reviews
  add column booking_id uuid references public.bookings(id) on delete set null;

alter table public.reviews
  add constraint reviews_one_per_booking unique (booking_id);

-- ---------------------------------------------------------------------------------------------
-- create_review — phone-gated. Replaces the 0003 (p_name, p_rating, p_text) name-based version.
-- ---------------------------------------------------------------------------------------------
-- The reviewer no longer supplies a name; they supply the phone that booked. We:
--   1. validate rating (1..5), text (1..1000), phone (^07[0-9]{8}$)              -> invalid
--   2. find the eligible booking: confirmed, this phone, FINISHED (end_at < now), and not already
--      reviewed; newest finished first                                          -> none -> no_booking
--   3. derive the display name from the booking's customer_name ("First L.")
--   4. insert the review tied to that booking; a concurrent double-submit trips the unique constraint
--      (reviews_one_per_booking) -> caught as no_booking (the second submitter has no fresh booking)
--   5. return the stored review (id, name, rating, text)
drop function if exists public.create_review(text, int, text);

create or replace function public.create_review(
  p_phone  text,
  p_rating int,
  p_text   text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id   uuid;
  v_customer     text;
  v_first        text;
  v_second       text;
  v_display      text;
  v_row          public.reviews;
begin
  -- 1. Validate inputs at the boundary. Phone must match the Swedish mobile shape the bookings table
  --    itself enforces (^07[0-9]{8}$); rating 1..5; text 1..1000.
  if p_rating is null or p_rating < 1 or p_rating > 5
     or p_text is null
     or pg_catalog.char_length(p_text) < 1 or pg_catalog.char_length(p_text) > 1000
     or p_phone is null
     or p_phone !~ '^07[0-9]{8}$'
  then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- 2. Find the most recently FINISHED, not-yet-reviewed confirmed booking for this phone.
  select b.id, b.customer_name
    into v_booking_id, v_customer
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = p_phone
    and b.end_at < pg_catalog.now()
    and b.id not in (
      select r.booking_id from public.reviews r where r.booking_id is not null
    )
  order by b.end_at desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  -- 3. Derive "First L." from customer_name. split_part returns '' for a missing second word, in which
  --    case we show the first name alone (no trailing initial).
  v_first  := pg_catalog.split_part(v_customer, ' ', 1);
  v_second := pg_catalog.split_part(v_customer, ' ', 2);
  v_display := v_first
    || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;

  -- 4. Insert tied to the booking. A race (two submits for the same finished booking) trips the
  --    one-per-booking unique constraint on the second insert -> treat as no_booking (no fresh cut).
  begin
    insert into public.reviews (name, rating, text, booking_id, published)
    values (v_display, p_rating::smallint, p_text, v_booking_id, true)
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end;

  -- 5. Return the stored review.
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

-- The (text, int, text) signature is unchanged from 0003, so a CREATE OR REPLACE would have kept the
-- old grants — but we DROPped + CREATEd (the body's contract changed materially), so PUBLIC has the
-- default EXECUTE again. Re-lock: strip PUBLIC, grant only anon (the public About form). The booking
-- requirement is the gate, so anon-callable is safe.
revoke execute on function public.create_review(text, int, text) from public;
grant  execute on function public.create_review(text, int, text) to anon;
