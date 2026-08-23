-- pgTAP — the no-double-booking EXCLUDE constraint matrix. Source: BACKEND_SPEC.md §6.
-- exclusion_violation = SQLSTATE 23P01.

begin;
select plan(6);

-- Anchor confirmed booking: hassan 09:00–10:00 on 2099-03-01.
select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','hs','Hår & Skägg',450,60,
            '2099-03-01 09:00+00','2099-03-01 10:00+00',
            'Anchor','phone','0701112233',null,'sv')$$,
  'anchor booking (hassan 09:00–10:00) inserts'
);

-- Overlapping confirmed booking for the SAME barber (09:30–10:30) -> exclusion_violation.
select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,
            '2099-03-01 09:30+00','2099-03-01 10:30+00',
            'Overlap','phone','0702223344',null,'sv')$$,
  '23P01', null, 'overlapping confirmed booking (same barber) rejected'
);

-- Adjacent, non-overlapping booking for the same barber (10:00–11:00) -> OK (ranges are
-- [start,end): touching endpoints do not overlap).
select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,60,
            '2099-03-01 10:00+00','2099-03-01 11:00+00',
            'Adjacent','phone','0703334455',null,'sv')$$,
  'adjacent (10:00–11:00) booking for same barber inserts'
);

-- Same time, DIFFERENT barber (victor 09:00–10:00) -> OK (constraint keys on barber_id).
select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('victor','hs','Hår & Skägg',450,60,
            '2099-03-01 09:00+00','2099-03-01 10:00+00',
            'OtherBarber','phone','0704445566',null,'sv')$$,
  'same time, different barber inserts'
);

-- Cancelling the anchor frees its slot: cancel hassan 09:00–10:00, then an overlapping
-- confirmed insert that previously failed now succeeds (cancelled rows are out of the index).
select lives_ok(
  $$update public.bookings
      set status = 'cancelled', cancelled_at = now()
    where barber_id = 'hassan' and start_at = '2099-03-01 09:00+00' and status = 'confirmed'$$,
  'cancel the anchor booking'
);

select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,
            '2099-03-01 09:30+00','2099-03-01 10:00+00',
            'AfterCancel','phone','0705556677',null,'sv')$$,
  'after cancelling, an overlapping slot can be re-booked (slot freed)'
);

select * from finish();
rollback;
