-- pgTAP — NEW behaviors from the phone-only + phone-gated-reviews migrations (0011, 0012).
-- Source: PLAN §1 (email removal) + §2 (phone-gated reviews). Complements 03_rpc_test.sql, which
-- carries the adapted create_booking/lookup/cancel coverage; this file adds what is NET-NEW:
--   * the old 11-arg create_booking signature is GONE (only the 9-arg remains),
--   * lookup_booking / cancel_booking no longer match on email (phone-only),
--   * create_review is phone-gated: no finished booking -> no_booking; a finished booking -> ok with a
--     server-derived "First L." name; one review per booking (unique); bad rating/phone -> invalid.
--
-- Fixtures are inserted DIRECTLY (as owner) so we can stage rows create_booking would reject — a
-- legacy email-method row, and bookings whose end_at is already in the PAST (a "finished" cut).

begin;
select plan(16);

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
-- lookup_booking / cancel_booking are phone-only: email no longer matches.
-- =============================================================================================
set local role service_role;

select is(
  public.lookup_booking('mejl@example.com') ->> 'error',
  'not_found', 'lookup_booking by email returns not_found (email arm removed)'
);
select is(
  pg_catalog.to_regprocedure('public.cancel_booking(uuid,text)') is null,
  true,
  'legacy cancel_booking signature is removed'
);

reset role;

-- the failed email-cancel must have been a no-op: the booking is still confirmed.
select is(
  (select status from public.bookings where id = current_setting('test.email_bid')::uuid),
  'confirmed', 'cancel-by-email left the booking confirmed (no-op)'
);

-- =============================================================================================
-- create_review is retired; access-scoped review creation is called by the public gateway as service_role.
-- =============================================================================================
set local role service_role;

select is(
  pg_catalog.to_regprocedure('public.create_review(text,integer,text)') is null,
  true,
  'legacy create_review signature is removed'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.create_review_with_access(text,text,integer,text)', 'execute'
  ),
  'service_role can execute access-scoped review creation'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.create_review_with_access(text,text,integer,text)', 'execute'
  ),
  'anon cannot execute access-scoped review creation directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.create_review_with_access(text,text,integer,text)', 'execute'
  ),
  'authenticated cannot execute access-scoped review creation directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.cancel_customer_booking_with_access(uuid,text)', 'execute'
  ),
  'service_role can execute access-scoped cancellation'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.cancel_customer_booking_with_access(uuid,text)', 'execute'
  ),
  'anon cannot execute access-scoped cancellation directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.cancel_customer_booking_with_access(uuid,text)', 'execute'
  ),
  'authenticated cannot execute access-scoped cancellation directly'
);

reset role;

select is(
  pg_catalog.to_regprocedure('public.cancel_booking(uuid,text)') is null,
  true,
  'legacy cancellation signature remains absent'
);

select * from finish();
rollback;
