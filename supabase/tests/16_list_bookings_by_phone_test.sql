-- pgTAP — list_bookings_by_phone (Mina bokningar self-service RPC, migration 0016).
-- Verifies the NET-NEW behavior vs lookup_booking (which is next-only): this RPC enumerates EVERY
-- confirmed booking for a phone (past + future), excludes cancelled rows, and never leaks another
-- phone's bookings. Fixtures are inserted directly as owner (bypassing the submit gateway) so we can
-- stage past + cancelled rows create_booking would reject.

begin;
select plan(7);

-- ---- fixtures --------------------------------------------------------------------------------
-- Phone A (0701234567): 2 upcoming + 1 past CONFIRMED + 1 CANCELLED (must be excluded).
-- Phone B (0709999999): 1 upcoming CONFIRMED (isolation check).
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('hassan','h', 'Hår',        350, 45, now() + interval '3 days',  now() + interval '3 days'  + interval '45 minutes', 'A Upcoming1','sms','0701234567', null,'sv','confirmed'),
  ('victor','hs','Hår + skägg',450, 60, now() + interval '10 days', now() + interval '10 days' + interval '60 minutes', 'A Upcoming2','sms','0701234567', null,'sv','confirmed'),
  ('hassan','h', 'Hår',        350, 45, now() - interval '20 days', now() - interval '20 days' + interval '45 minutes', 'A Past',     'sms','0701234567', null,'sv','confirmed'),
  ('hassan','h', 'Hår',        350, 45, now() + interval '5 days',  now() + interval '5 days'  + interval '45 minutes', 'A Cancelled','sms','0701234567', null,'sv','cancelled'),
  ('victor','h', 'Hår',        350, 45, now() + interval '2 days',  now() + interval '2 days'  + interval '45 minutes', 'B Upcoming', 'sms','0709999999', null,'sv','confirmed');

-- ---- assertions ------------------------------------------------------------------------------
select is(
  (public.list_bookings_by_phone('0701234567')->>'ok')::boolean, true,
  'returns ok:true for a known phone');

select is(
  pg_catalog.jsonb_array_length(public.list_bookings_by_phone('0701234567')->'bookings'), 3,
  'enumerates all 3 confirmed (past + future), excludes the cancelled row');

select is(
  pg_catalog.jsonb_array_length(public.list_bookings_by_phone('0709999999')->'bookings'), 1,
  'phone B sees only its own booking (no cross-phone leak)');

select is(
  pg_catalog.jsonb_array_length(public.list_bookings_by_phone('0700000000')->'bookings'), 0,
  'unknown phone yields an empty list');

select is(
  (public.list_bookings_by_phone('0709999999')->'bookings'->0->>'service_name'), 'Hår',
  'row carries service_name');

select is(
  (public.list_bookings_by_phone('0709999999')->'bookings'->0->>'duration_min'), '45',
  'row carries duration_min');

select is(
  (public.list_bookings_by_phone('0709999999')->'bookings'->0->>'barber_id'), 'victor',
  'row carries barber_id');

select * from finish();
rollback;
