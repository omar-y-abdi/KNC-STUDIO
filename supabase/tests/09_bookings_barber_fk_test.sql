-- pgTAP — bookings.barber_id is now a FK to the barbers roster (migration 0009): a booking for a
-- barber that is not in the roster is rejected; one for a seeded barber is accepted. This proves the
-- admin "add barbers" path can receive bookings while orphan barber_ids cannot be inserted.

begin;
select plan(2);

-- foreign_key_violation = SQLSTATE 23503.
select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('nonexistent-barber','h','Hår',350,45,'2099-01-01 09:00+00','2099-01-01 09:45+00',
            'Test','phone','0701234567',null,'sv')$$,
  '23503', null, 'a booking for a barber NOT in the roster is rejected by the FK'
);

select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-01-02 09:00+00','2099-01-02 09:45+00',
            'Test','phone','0701234567',null,'sv')$$,
  'a booking for a seeded barber (hassan) is accepted'
);

select * from finish();
rollback;
