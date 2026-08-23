-- pgTAP — admin_create_booking ("Reservera kund", Task 2 §4, migration 0020). Verifies the widened
-- method/contact constraints + the RPC's authorize / walk-in / no-double-book behavior. Runs as the
-- table owner (bypasses RLS) but the RPC's OWN authorization uses is_owner()/current_barber_id(),
-- which are null in this context → 'forbidden' unless we stub the session. We test the constraint
-- widening + the overlap guard directly (the authorize arm is covered by 05_admin_rls patterns).

begin;
select plan(5);

-- The widened method check accepts 'walkin' with no contact.
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at, customer_name, method, phone, email, lang)
values
  ('hassan','manual','Reserverad',0,45, now() + interval '3 days', now() + interval '3 days' + interval '45 min',
   'Walk-in','walkin', null, null, 'sv');
select is(
  (select method from public.bookings where service_id = 'manual' and customer_name = 'Walk-in'),
  'walkin', 'a contact-less walk-in booking is accepted');

-- The old contact-matches-method guard still holds for sms (phone required).
select throws_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at, customer_name, method, phone, email, lang)
     values ('hassan','manual','X',0,45, now() + interval '9 days', now() + interval '9 days' + interval '45 min',
             'No Phone','phone', null, null, 'sv') $$,
  '23514', null, 'a phone booking without a phone is still rejected');

-- A manual reservation with a phone is visible to list_bookings_by_phone (Mina bokningar).
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at, customer_name, method, phone, email, lang)
values
  ('victor','manual','Reserverad',350,45, now() + interval '4 days', now() + interval '4 days' + interval '45 min',
   'Phoned Kund','phone', '0705550000', null, 'sv');
select is(
  pg_catalog.jsonb_array_length(public.list_bookings_by_phone('0705550000')->'bookings'), 1,
  'a manual booking with a phone shows under Mina bokningar');

-- The exclusion constraint still blocks a second confirmed booking overlapping the same barber+time.
select throws_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at, customer_name, method, phone, email, lang)
     values ('hassan','manual','Overlap',0,45, now() + interval '3 days', now() + interval '3 days' + interval '30 min',
             'Clash','walkin', null, null, 'sv') $$,
  '23P01', null, 'an overlapping manual booking is rejected (no double-book)');

-- The RPC exists and, with no staff session, refuses (authorize arm).
select is(
  (public.admin_create_booking('hassan', now() + interval '30 days', 45, 'Reserverad', 0, 'X', null)->>'error'),
  'forbidden', 'admin_create_booking refuses a caller with no owner/barber identity');

select * from finish();
rollback;
