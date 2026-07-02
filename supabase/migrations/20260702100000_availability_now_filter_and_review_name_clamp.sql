-- Migration 0016 — read/write agreement on "today" + create_review display-name clamp.
--
-- (1) available_slots offered slots whose start had ALREADY PASSED on the current day: it filtered by
--     schedule, time-off and overlap, but never by "the slot is still in the future" — while
--     create_booking rejects any past start with `invalid_time`. A customer opening the site at 15:00
--     saw the whole morning as bookable and every submit dead-ended in a generic error. Add the one
--     missing condition: the slot's Europe/Stockholm instant must be after now(). Same signature, so
--     CREATE OR REPLACE keeps the 0006 grants (anon + authenticated).
--
-- (2) create_review derived the display name ("First L.") from the booking's customer_name and
--     inserted it with no guard against the reviews.name CHECK (1..80 chars). Two legal booking names
--     broke it: a whitespace-only name (-> '' , length 0) and a two-word name totalling 80 chars
--     (-> 81 with the ' X.' suffix). Either raised check_violation out of an anon entry point as a raw
--     PostgREST 500 instead of a clean Result. Clamp: btrim the source, cap at 80, fall back to 'Kund'
--     when empty. Same signature -> grants (anon) preserved.

-- ---------------------------------------------------------------------------------------------
-- (1) available_slots — only slots that are still in the future.
-- ---------------------------------------------------------------------------------------------
create or replace function public.available_slots(
  p_barber_id    text,
  p_date         date,
  p_duration_min int
)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with sched as (
    -- the working schedule row for this barber on this weekday (if any)
    select s.start_min, s.end_min
    from public.barber_schedules s
    where s.barber_id = p_barber_id
      and s.working = true
      and s.weekday = pg_catalog.date_part('dow', p_date)::int
  ),
  off as (
    -- is the date blocked by time off?
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and p_date between t.start_date and t.end_date
  ),
  slot(label, slot_min) as (
    values
      ('09:00', 540), ('09:45', 585), ('10:30', 630), ('11:15', 675),
      ('12:00', 720), ('12:45', 765), ('13:30', 810), ('14:15', 855),
      ('15:00', 900), ('15:45', 945), ('16:30', 990), ('17:15', 1035)
  )
  select slot.label
  from slot, sched
  where not exists (select 1 from off)
    -- (a) the [slot, slot+duration] window fits within working hours
    and slot.slot_min >= sched.start_min
    and slot.slot_min + p_duration_min <= sched.end_min
    -- (b) the slot has not already started — create_booking rejects past starts (`invalid_time`),
    --     so the read path must not advertise them (same Europe/Stockholm instant math).
    and ((p_date + pg_catalog.make_time(slot.slot_min / 60, slot.slot_min % 60, 0))
           at time zone 'Europe/Stockholm') > pg_catalog.now()
    -- (c) no overlap with a confirmed booking that day (instants in Europe/Stockholm)
    and not exists (
      select 1
      from public.bookings b
      where b.barber_id = p_barber_id
        and b.status = 'confirmed'
        and b.start_at < ((p_date + pg_catalog.make_time(slot.slot_min / 60, slot.slot_min % 60, 0)
                            + pg_catalog.make_interval(mins => p_duration_min)) at time zone 'Europe/Stockholm')
        and b.end_at   > ((p_date + pg_catalog.make_time(slot.slot_min / 60, slot.slot_min % 60, 0))
                            at time zone 'Europe/Stockholm')
    )
  order by slot.slot_min;
$$;

-- ---------------------------------------------------------------------------------------------
-- (2) create_review — clamp the derived display name into the reviews.name CHECK (1..80).
-- ---------------------------------------------------------------------------------------------
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

  -- 3. Derive "First L." from customer_name, CLAMPED into the reviews.name CHECK (1..80): btrim the
  --    source (a legal customer_name can be all whitespace), cap the result at 80 (a legal 80-char
  --    two-word name would otherwise grow to 81 with the ' X.' suffix), and fall back to a neutral
  --    'Kund' when nothing printable remains — so a valid review can never trip check_violation.
  v_customer := pg_catalog.btrim(v_customer);
  v_first  := pg_catalog.split_part(v_customer, ' ', 1);
  v_second := pg_catalog.split_part(v_customer, ' ', 2);
  v_display := v_first
    || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;
  v_display := pg_catalog.left(v_display, 80);
  if v_display = '' then
    v_display := 'Kund';
  end if;

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
