-- pgTAP — the SECURITY DEFINER RPCs, exercised AS ANON (the real boundary).
-- Source: BACKEND_SPEC.md §6 (RPCs). Each RPC returns a JSONB Result object.
--
-- We thread the created booking id between statements via a transaction-local custom GUC
-- (set_config('test.*', v, true)) — allowed for the unprivileged anon role.

begin;
select plan(21);

set local role anon;

-- =============================================================================================
-- create_booking
-- =============================================================================================

-- Happy path: a future booking succeeds and echoes an id (but NO phone/email).
select set_config(
  'test.created',
  public.create_booking(
    'hassan','h','Hår',350,45,
    now() + interval '10 days',
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

-- Second OVERLAPPING booking for the same barber/time -> slot_taken.
select is(
  public.create_booking(
    'hassan','b','Skägg',200,30,
    now() + interval '10 days',
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

-- =============================================================================================
-- taken_slots — returns the confirmed range we created above, and nothing for an empty window.
-- =============================================================================================
select is(
  (select count(*)::int from public.taken_slots(
     'hassan', now() + interval '9 days', now() + interval '11 days')),
  1, 'taken_slots returns the one confirmed hassan booking in the window'
);
select is(
  (select count(*)::int from public.taken_slots(
     'salman', now() + interval '9 days', now() + interval '11 days')),
  0, 'taken_slots returns nothing for a barber with no bookings'
);

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

reset role;

-- Regression guard (as owner — anon cannot read bookings): the happy-path booking must have
-- persisted the CUSTOMER name 'Test Kund', NOT the service name 'Hår'. Reading via the id stashed
-- from lookup_booking (test.bid). This locks down the create_booking customer_name mapping.
select is(
  (select customer_name from public.bookings where id = current_setting('test.bid')::uuid),
  'Test Kund', 'create_booking persists the customer name (not the service name) into customer_name'
);

select * from finish();
rollback;
