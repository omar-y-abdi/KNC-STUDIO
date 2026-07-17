-- pgTAP — bookings.service_id length widening (migration 20260717120000). The public menu switched to
-- UUID-keyed services, so service_id now carries a 36-char UUID; the original 1..16 check rejected it
-- and broke every online booking. This pins the widened bound: a UUID is accepted, 'manual' (admin
-- "Reservera kund") still is, and the upper bound still guards. Runs as table owner (bypasses RLS).

begin;
select plan(3);

-- A 36-char services.id UUID is accepted (the fix — this is exactly what create_booking now inserts).
select lives_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan','8e4f6dae-2648-4934-856c-d4de2015e274','Hårklippning + skägg',450,60,
             '2099-03-01 09:00+00','2099-03-01 10:00+00','UUID Kund','walkin', null, null, 'sv') $$,
  'a 36-char UUID service_id is accepted');

-- The literal 'manual' (admin Reservera kund) is still valid — the fix must not regress the admin path.
select lives_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan','manual','Reserverad',0,45,
             '2099-03-02 09:00+00','2099-03-02 09:45+00','Manual Kund','walkin', null, null, 'sv') $$,
  'a manual reservation service_id is still accepted');

-- The upper bound still guards: a 65-char service_id is rejected (SQLSTATE 23514).
select throws_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan', repeat('a',65),'Too Long',0,45,
             '2099-03-03 09:00+00','2099-03-03 09:45+00','Long Kund','walkin', null, null, 'sv') $$,
  '23514', null, 'a 65-char service_id is rejected (upper bound still enforced)');

select * from finish();
rollback;
