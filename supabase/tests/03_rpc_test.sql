-- pgTAP — the SECURITY DEFINER booking RPCs, after the phone-only migration (0011).
-- Source: BACKEND_SPEC.md §6 + PLAN §1. Each RPC returns a JSONB Result object.
--
-- WHAT CHANGED vs the pre-0011 version of this file (adapted, not deleted — see comments):
--   * create_booking is now 9-arg (no p_method/p_email) and is REVOKED from anon (gateway-only): the
--     `submit-booking` edge fn calls it via service_role. So its happy/error paths are exercised AS
--     service_role here, and two new assertions prove anon canNOT execute it while service_role can.
--   * the two method/contact-mismatch cases collapse to a single `null phone -> invalid_contact`.
--   * lookup_booking is 1-arg (phone only); its mismatched-method case is gone.
--   * cancel_booking matches phone only (the email arm is dropped).
--   * create_review changed signature + semantics (phone-gated, finished-booking required), which needs
--     a finished-booking fixture — that coverage MOVED to (and EXPANDED in) 10_phone_only_reviews_gating_test.sql.
--
-- We thread the created booking id between statements via a transaction-local custom GUC
-- (set_config('test.*', v, true)) — allowed for the unprivileged anon role.

begin;
select plan(23);

-- Seed a time-off day for victor BEFORE switching roles (anon/service_role have no write grant on the
-- admin tables): 2040-03-20 is blocked, so a create_booking that day must return outside_hours below.
-- Transaction-local; rolled back with everything else at the end.
insert into public.barber_time_off (barber_id, start_date, end_date, reason)
values ('victor', date '2040-03-20', date '2040-03-20', 'pgtap');

-- create_booking is REVOKED from anon (0011): only service_role (the edge fn's credential) may call it.
-- Exercise its happy/error paths as service_role.
set local role service_role;

-- =============================================================================================
-- create_booking (9-arg, phone-only)
-- =============================================================================================
-- NOTE: create_booking enforces working hours server-side (migration 0010, preserved in 0011): the
-- start must be a WORKING weekday, inside the barber's 09:00–18:00 (Europe/Stockholm), and not on
-- time-off. The happy path uses a FIXED, far-future, in-hours instant: 2040-03-14 is a Wednesday (a
-- working day); 12:30:00Z = 13:30 Europe/Stockholm (CET, +01:00), well within 09:00–18:00.

-- Happy path: a future, in-working-hours booking succeeds and echoes an id (but NO phone/email).
select set_config(
  'test.created',
  public.create_booking(
    'hassan','h','Hår',350,45,
    timestamptz '2040-03-14T12:30:00Z',
    '0701234567', 'sv', 'Test Kund'
  )::text,
  true
);

select is(
  (current_setting('test.created')::jsonb) ->> 'ok',
  'true', 'create_booking happy path returns ok:true'
);
select isnt(
  (current_setting('test.created')::jsonb) -> 'booking' ->> 'id',
  null, 'create_booking returns a booking id'
);
select is(
  (current_setting('test.created')::jsonb) -> 'booking' ->> 'barber_id',
  'hassan', 'create_booking echoes barber_id'
);
select ok(
  not ((current_setting('test.created')::jsonb -> 'booking') ? 'phone')
  and not ((current_setting('test.created')::jsonb -> 'booking') ? 'email'),
  'create_booking NEVER echoes phone/email'
);

-- Second OVERLAPPING booking for the same barber/time -> slot_taken (same in-hours instant).
select is(
  public.create_booking(
    'hassan','b','Skägg',200,30,
    timestamptz '2040-03-14T12:30:00Z',
    '0707654321', 'sv', 'Krock Kund'
  ) ->> 'error',
  'slot_taken', 'overlapping create_booking returns error:slot_taken'
);

-- Past start time -> invalid_time.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    now() - interval '1 day',
    '0701234567', 'sv', 'Dåtid Kund'
  ) ->> 'error',
  'invalid_time', 'past start_at returns error:invalid_time'
);

-- ---------------------------------------------------------------------------------------------
-- create_booking — server-side schedule enforcement (migration 0010, finding H1) + FK handling (M1),
-- both preserved unchanged by 0011.
-- ---------------------------------------------------------------------------------------------
-- Off-HOURS on a working day: 2040-03-15 (Thursday) 06:00:00Z = 07:00 Europe/Stockholm, before the
-- 09:00 open -> outside_hours.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-15T06:00:00Z',
    '0701234567', 'sv', 'Tidig Kund'
  ) ->> 'error',
  'outside_hours', 'before-opening start returns error:outside_hours'
);

-- OFF DAY: 2040-03-18 is a Sunday (weekday 0, not working in the seed) -> outside_hours, even at a
-- time that would be in-hours on a working day (12:30:00Z = 13:30 Stockholm).
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-18T12:30:00Z',
    '0701234567', 'sv', 'Söndag Kund'
  ) ->> 'error',
  'outside_hours', 'a non-working weekday (Sunday) returns error:outside_hours'
);

-- TIME-OFF day: victor is blocked on 2040-03-20 (seeded above), so a booking that day (in-hours,
-- 12:30:00Z = 13:30 Stockholm) -> outside_hours.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-20T12:30:00Z',
    '0701234567', 'sv', 'Ledig Kund'
  ) ->> 'error',
  'outside_hours', 'a day inside a barber_time_off range returns error:outside_hours'
);

-- FK / unknown barber -> invalid (M1). Uses an in-hours instant so the rejection is unambiguously the
-- barber check, not the schedule gate.
select is(
  public.create_booking(
    'ghost','h','Hår',350,45,
    timestamptz '2040-03-14T12:30:00Z',
    '0701234567', 'sv', 'Spöke Kund'
  ) ->> 'error',
  'invalid', 'an unknown barber_id returns error:invalid (FK hardening)'
);

-- Contact guard: a null phone -> invalid_contact (the only contact path now; email is gone). Uses a
-- valid in-hours future instant so the rejection is unambiguously the contact guard.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-14T12:30:00Z',
    null, 'sv', 'Ingen Telefon'
  ) ->> 'error',
  'invalid_contact', 'a null phone returns error:invalid_contact'
);

reset role;

-- =============================================================================================
-- create_booking is gateway-only: anon canNOT execute it (revoked in 0011), service_role can.
-- =============================================================================================
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.create_booking(text, text, text, int, int, timestamptz, text, text, text)',
    'execute'
  ),
  'anon EXECUTE on create_booking is revoked (gateway-only — submit-booking calls it via service_role)'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_booking(text, text, text, int, int, timestamptz, text, text, text)',
    'execute'
  ),
  'service_role CAN execute create_booking (the edge fn credential)'
);

-- =============================================================================================
-- lookup_booking (1-arg, phone) + cancel_booking (phone-only) — both still anon-callable.
-- =============================================================================================
set local role anon;

select set_config(
  'test.looked',
  public.lookup_booking('0701234567')::text,
  true
);
select is(
  (current_setting('test.looked')::jsonb) ->> 'ok',
  'true', 'lookup_booking with the right phone returns ok:true'
);
select is(
  (current_setting('test.looked')::jsonb) -> 'booking' ->> 'barber_id',
  'hassan', 'lookup_booking returns the matching booking'
);
-- stash the id for the cancel flow
select set_config(
  'test.bid',
  (current_setting('test.looked')::jsonb) -> 'booking' ->> 'id',
  true
);

select is(
  public.lookup_booking('0700000000') ->> 'error',
  'not_found', 'lookup_booking with a WRONG phone returns not_found (no enumeration)'
);

-- cancel_booking — wrong contact denied; right contact cancels; second call idempotent not_found.
select is(
  public.cancel_booking(current_setting('test.bid')::uuid, '0700000000') ->> 'error',
  'not_found', 'cancel_booking with WRONG contact returns not_found'
);
select is(
  public.cancel_booking(current_setting('test.bid')::uuid, '0701234567') ->> 'ok',
  'true', 'cancel_booking with the right contact returns ok:true'
);
select is(
  public.cancel_booking(current_setting('test.bid')::uuid, '0701234567') ->> 'error',
  'not_found', 'cancel_booking is idempotent: second call returns not_found'
);

-- L2 (migration 0010): anon must NOT be able to execute taken_slots (grant revoked). Verify it still
-- holds after 0011 (defense against a future re-grant regression).
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.taken_slots(text, timestamptz, timestamptz)',
    'execute'
  ),
  'anon EXECUTE on taken_slots is revoked (L2: dead on the public path)'
);

reset role;

-- taken_slots range correctness — exercised as the OWNER (its remaining admin-only reach after L2). The
-- hassan booking created at the top was CANCELLED by the cancel flow above, so taken_slots must now
-- return NOTHING for hassan in that window (cancellation frees the range). Salman never had a booking.
select is(
  (select count(*)::int from public.taken_slots(
     'hassan', timestamptz '2040-03-13T00:00:00Z', timestamptz '2040-03-15T00:00:00Z')),
  0, 'taken_slots excludes the now-CANCELLED hassan booking (cancellation frees the range)'
);
select is(
  (select count(*)::int from public.taken_slots(
     'salman', timestamptz '2040-03-13T00:00:00Z', timestamptz '2040-03-15T00:00:00Z')),
  0, 'taken_slots returns nothing for a barber with no bookings'
);

-- Regression guard (as owner — anon cannot read bookings): the happy-path booking must have persisted
-- the CUSTOMER name 'Test Kund', NOT the service name 'Hår'. Reading via the id stashed from
-- lookup_booking (test.bid). This locks down the create_booking customer_name mapping.
select is(
  (select customer_name from public.bookings where id = current_setting('test.bid')::uuid),
  'Test Kund', 'create_booking persists the customer name (not the service name) into customer_name'
);

select * from finish();
rollback;
