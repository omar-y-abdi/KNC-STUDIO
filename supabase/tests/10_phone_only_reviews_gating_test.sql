-- pgTAP — NEW behaviors from the phone-only + phone-gated-reviews migrations (0011, 0012).
-- Source: PLAN §1 (email removal) + §2 (phone-gated reviews). Complements 03_rpc_test.sql, which
-- carries the adapted create_booking/lookup/cancel coverage; this file adds what is NET-NEW:
--   * the old 11-arg create_booking signature is GONE (only the 9-arg remains),
--   * cancel_booking no longer matches on email (phone-only),
--   * create_review is phone-gated: no finished booking -> no_booking; a finished booking -> ok with a
--     server-derived "First L." name; one review per booking (unique); bad rating/phone -> invalid.
--
-- Fixtures are inserted DIRECTLY (as owner) so we can stage rows create_booking would reject — a
-- legacy email-method row, and bookings whose end_at is already in the PAST (a "finished" cut).

begin;
select plan(15);

-- ---- fixtures (as owner) --------------------------------------------------------------------
-- A legacy/dormant EMAIL booking (method='email', phone null) in the FUTURE. Proves the lookup/cancel
-- email arms are gone: even a perfectly valid email row is now unreachable by email.
with ins as (
  insert into public.bookings
    (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
     customer_name, method, phone, email, lang)
  values
    ('hassan','h','Hår',350,45,
     now() + interval '10 days', now() + interval '10 days' + interval '45 minutes',
     'Mejl Kund','email', null, 'mejl@example.com','sv')
  returning id
)
select set_config('test.email_bid', (select id::text from ins), true);

-- Two FINISHED confirmed bookings (end_at in the past) for the review-gating tests: one two-word name
-- ("Hassan Ahmed" -> "Hassan A."), one single-word name ("Madonna" -> "Madonna"). Distinct phones.
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('hassan','h','Hår',350,45,
   now() - interval '2 hours', now() - interval '75 minutes',
   'Hassan Ahmed','phone','0709999999', null,'sv'),
  ('hassan','h','Hår',350,45,
   now() - interval '3 hours', now() - interval '135 minutes',
   'Madonna','phone','0708888888', null,'sv');

-- =============================================================================================
-- create_booking signature: only the current 7-arg server-authoritative version exists.
-- =============================================================================================
select is(
  (select count(*)::int from pg_catalog.pg_proc
     where proname = 'create_booking'
       and pronamespace = 'public'::regnamespace
       and pronargs = 11),
  0, 'the old 11-arg create_booking signature no longer exists'
);
select is(
  (select count(*)::int from pg_catalog.pg_proc
     where proname = 'create_booking'
       and pronamespace = 'public'::regnamespace
       and pronargs = 7),
  1, 'exactly one 7-arg create_booking exists'
);
-- Gateway-only privilege (also asserted in 03; kept here so this file is self-contained on the change).
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.create_booking(text, text, timestamptz, text, text, text, text)', 'execute'),
  'anon canNOT execute create_booking (gateway-only)'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.create_booking(text, text, timestamptz, text, text, text, text)', 'execute'),
  'service_role CAN execute create_booking'
);

-- the email fixture is genuinely a confirmed booking (so the not_found below is the phone-only match,
-- not a missing/cancelled row).
select is(
  (select status from public.bookings where id = current_setting('test.email_bid')::uuid),
  'confirmed', 'the email fixture booking is seeded as confirmed'
);

-- =============================================================================================
-- cancel_booking is phone-only: email no longer matches.
-- =============================================================================================
set local role service_role;

select is(
  public.cancel_booking(current_setting('test.email_bid')::uuid, 'mejl@example.com') ->> 'error',
  'not_found', 'cancel_booking by email returns not_found (email arm removed)'
);

reset role;

-- the failed email-cancel must have been a no-op: the booking is still confirmed.
select is(
  (select status from public.bookings where id = current_setting('test.email_bid')::uuid),
  'confirmed', 'cancel-by-email left the booking confirmed (no-op)'
);

-- =============================================================================================
-- create_review is phone-gated and called by the public gateway as service_role.
-- =============================================================================================
set local role service_role;

-- No finished booking for this phone -> no_booking (the anti-spam gate; a bot with no cut gets nothing).
select is(
  public.create_review('0700000000', 5, 'Ingen genomförd bokning') ->> 'error',
  'no_booking', 'create_review with no finished booking -> no_booking'
);

-- A finished booking -> ok, with the name DERIVED "First L." from customer_name.
select set_config(
  'test.rev',
  public.create_review('0709999999', 5, 'Bra klippning, kommer åter.')::text,
  true
);
select is(
  (current_setting('test.rev')::jsonb) ->> 'ok',
  'true', 'create_review with a finished booking -> ok:true'
);
select is(
  (current_setting('test.rev')::jsonb) -> 'review' ->> 'name',
  'Hassan A.', 'review name is derived "First L." from customer_name ("Hassan Ahmed" -> "Hassan A.")'
);

-- Second review for the SAME booking -> no_booking (one review per cut; the booking is now excluded).
select is(
  public.create_review('0709999999', 4, 'En gång till') ->> 'error',
  'no_booking', 'a second review for the same booking -> no_booking (one per cut)'
);

-- Single-word customer_name -> just the first name, no trailing initial.
select is(
  (public.create_review('0708888888', 4, 'Toppen service')::jsonb) -> 'review' ->> 'name',
  'Madonna', 'a single-word customer_name yields just the first name (no initial)'
);

-- Bad rating (out of 1..5) -> invalid (validated before the booking lookup).
select is(
  public.create_review('0709999999', 7, 'rating fel') ->> 'error',
  'invalid', 'rating out of range -> invalid'
);

-- Malformed phone (fails ^07[0-9]{8}$) -> invalid.
select is(
  public.create_review('123', 5, 'fel nummer') ->> 'error',
  'invalid', 'a malformed phone -> invalid'
);

reset role;

-- The created review is stored + published (visible via the published-select path).
select is(
  (select count(*)::int from public.reviews
     where name = 'Hassan A.' and text = 'Bra klippning, kommer åter.'),
  1, 'the new review is stored and published'
);

select * from finish();
rollback;
