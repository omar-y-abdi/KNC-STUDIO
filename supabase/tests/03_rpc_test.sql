-- pgTAP — the SECURITY DEFINER RPCs, exercised AS ANON (the real boundary).
-- Source: BACKEND_SPEC.md §6 (RPCs). Each RPC returns a JSONB Result object.
--
-- We thread the created booking id between statements via a transaction-local custom GUC
-- (set_config('test.*', v, true)) — allowed for the unprivileged anon role.

begin;
select plan(26);

-- Seed a time-off day for victor BEFORE dropping to anon (anon has no write grant on the admin
-- tables): 2040-03-20 is blocked, so a create_booking that day must return outside_hours below.
-- Transaction-local; rolled back with everything else at the end.
insert into public.barber_time_off (barber_id, start_date, end_date, reason)
values ('victor', date '2040-03-20', date '2040-03-20', 'pgtap');

set local role anon;

-- =============================================================================================
-- create_booking
-- =============================================================================================
-- NOTE: create_booking now enforces working hours server-side (migration 0010): the start must be a
-- WORKING weekday, inside the barber's 09:00–18:00 (Europe/Stockholm), and not on time-off. So the
-- happy path uses a FIXED, far-future, in-hours instant: 2040-03-14 is a Wednesday (a working day);
-- 12:30:00Z = 13:30 Europe/Stockholm (CET, +01:00), well within 09:00–18:00.

-- Happy path: a future, in-working-hours booking succeeds and echoes an id (but NO phone/email).
select set_config(
  'test.created',
  public.create_booking(
    'hassan','h','Hår',350,45,
    timestamptz '2040-03-14T12:30:00Z',
    'sms','0701234567', null, 'sv', 'Test Kund'
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
    'sms','0707654321', null, 'sv', 'Krock Kund'
  ) ->> 'error',
  'slot_taken', 'overlapping create_booking returns error:slot_taken'
);

-- Past start time -> invalid_time.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    now() - interval '1 day',
    'sms','0701234567', null, 'sv', 'Dåtid Kund'
  ) ->> 'error',
  'invalid_time', 'past start_at returns error:invalid_time'
);

-- ---------------------------------------------------------------------------------------------
-- create_booking — server-side schedule enforcement (migration 0010, finding H1) + FK handling (M1).
-- ---------------------------------------------------------------------------------------------
-- Off-HOURS on a working day: 2040-03-15 (Thursday) 06:00:00Z = 07:00 Europe/Stockholm, before the
-- 09:00 open -> outside_hours.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-15T06:00:00Z',
    'sms','0701234567', null, 'sv', 'Tidig Kund'
  ) ->> 'error',
  'outside_hours', 'before-opening start returns error:outside_hours'
);

-- OFF DAY: 2040-03-18 is a Sunday (weekday 0, not working in the seed) -> outside_hours, even at a
-- time that would be in-hours on a working day (12:30:00Z = 13:30 Stockholm).
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-18T12:30:00Z',
    'sms','0701234567', null, 'sv', 'Söndag Kund'
  ) ->> 'error',
  'outside_hours', 'a non-working weekday (Sunday) returns error:outside_hours'
);

-- TIME-OFF day: victor is blocked on 2040-03-20 (seeded above), so a booking that day (in-hours,
-- 12:30:00Z = 13:30 Stockholm) -> outside_hours.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    timestamptz '2040-03-20T12:30:00Z',
    'sms','0701234567', null, 'sv', 'Ledig Kund'
  ) ->> 'error',
  'outside_hours', 'a day inside a barber_time_off range returns error:outside_hours'
);

-- FK / unknown barber -> invalid (M1: 0009 swapped the CHECK for an FK; 0010 maps the violation back
-- to the clean `invalid` Result the CHECK used to produce). Uses an in-hours instant so the rejection
-- is unambiguously the barber check, not the schedule gate.
select is(
  public.create_booking(
    'ghost','h','Hår',350,45,
    timestamptz '2040-03-14T12:30:00Z',
    'sms','0701234567', null, 'sv', 'Spöke Kund'
  ) ->> 'error',
  'invalid', 'an unknown barber_id returns error:invalid (FK hardening)'
);

-- Method/contact mismatch (sms but no phone) -> invalid_contact.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    now() + interval '11 days',
    'sms', null, null, 'sv', 'Ingen Telefon'
  ) ->> 'error',
  'invalid_contact', 'sms without phone returns error:invalid_contact'
);
-- Method/contact mismatch (email but no email) -> invalid_contact.
select is(
  public.create_booking(
    'victor','h','Hår',350,45,
    now() + interval '11 days',
    'email', '0701234567', null, 'sv', 'Ingen Mejl'
  ) ->> 'error',
  'invalid_contact', 'email without email returns error:invalid_contact'
);

-- NOTE: taken_slots is no longer granted to anon (migration 0010, finding L2 — it is dead on the
-- public path, superseded by available_slots). Its range-correctness assertions therefore moved
-- BELOW `reset role`, exercised as the owner (its remaining, admin-only reachability).

-- =============================================================================================
-- lookup_booking — right contact finds it; wrong contact / wrong method -> not_found.
-- =============================================================================================
select set_config(
  'test.looked',
  public.lookup_booking('0701234567','sms')::text,
  true
);
select is(
  (current_setting('test.looked')::jsonb) ->> 'ok',
  'true', 'lookup_booking with the right contact returns ok:true'
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
  public.lookup_booking('0700000000','sms') ->> 'error',
  'not_found', 'lookup_booking with a WRONG contact returns not_found (no enumeration)'
);
select is(
  public.lookup_booking('0701234567','email') ->> 'error',
  'not_found', 'lookup_booking with mismatched method returns not_found'
);

-- =============================================================================================
-- cancel_booking — wrong contact denied; right contact cancels; second call idempotent not_found.
-- =============================================================================================
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

-- =============================================================================================
-- create_review — valid inserts + becomes visible to anon; invalid rating rejected.
-- =============================================================================================
select is(
  public.create_review('Ny Kund', 5, 'Toppenklippning, kommer åter.') ->> 'ok',
  'true', 'create_review valid returns ok:true'
);
select is(
  (select count(*)::int from public.reviews
     where name = 'Ny Kund' and text = 'Toppenklippning, kommer åter.'),
  1, 'the new review is visible to anon via the published select policy'
);
select is(
  public.create_review('Bad', 7, 'rating out of range') ->> 'error',
  'invalid', 'create_review with rating 7 returns error:invalid'
);

-- L2: anon must NOT be able to execute taken_slots anymore (grant revoked in 0010). Verify the
-- privilege was actually dropped (defense against a future re-grant regression).
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.taken_slots(text, timestamptz, timestamptz)',
    'execute'
  ),
  'anon EXECUTE on taken_slots is revoked (L2: dead on the public path)'
);

reset role;

-- taken_slots range correctness — now exercised as the OWNER (its remaining admin-only reach after
-- L2 revoked anon). The hassan booking created at the top was CANCELLED by the cancel flow above, so
-- taken_slots must now return NOTHING for hassan in that window (cancellation frees the range — the
-- same partial-index semantics the exclusion constraint uses). Salman never had a booking.
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

-- Regression guard (as owner — anon cannot read bookings): the happy-path booking must have
-- persisted the CUSTOMER name 'Test Kund', NOT the service name 'Hår'. Reading via the id stashed
-- from lookup_booking (test.bid). This locks down the create_booking customer_name mapping.
select is(
  (select customer_name from public.bookings where id = current_setting('test.bid')::uuid),
  'Test Kund', 'create_booking persists the customer name (not the service name) into customer_name'
);

select * from finish();
rollback;
