-- pgTAP — schema presence + every CHECK / column constraint on `bookings` and `reviews`.
-- Run by `supabase test db`. Each file runs in its own transaction; we roll back at the end.
-- Source: BACKEND_SPEC.md §6 (Constraints).

begin;
select plan(23);

-- ---- objects exist --------------------------------------------------------------------------
select has_extension('btree_gist',                         'btree_gist extension is installed');
select has_table('public', 'bookings',                     'table public.bookings exists');
select has_table('public', 'reviews',                      'table public.reviews exists');
select has_index('public', 'bookings', 'bookings_phone_idx',        'bookings_phone_idx exists');
select has_index('public', 'bookings', 'bookings_email_idx',        'bookings_email_idx exists');
select has_index('public', 'bookings', 'bookings_barber_time_idx',  'bookings_barber_time_idx exists');
select has_index('public', 'reviews',  'reviews_published_idx',     'reviews_published_idx exists');

-- ---- a fully valid booking inserts ----------------------------------------------------------
select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values
      ('hassan','h','Hår',350,45,
       '2099-01-01 09:00+00','2099-01-01 09:45+00',
       'Test Kund','phone','0701234567',null,'sv')$$,
  'valid phone booking inserts'
);

select lives_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values
      ('victor','b','Skägg',200,30,
       '2099-01-01 09:00+00','2099-01-01 09:30+00',
       'Mejl Kund','email',null,'kund@example.com','en')$$,
  'valid email booking inserts'
);

-- ---- CHECK rejections (each should raise check_violation 23514) ------------------------------
select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('nope','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone','0701234567',null,'sv')$$,
  -- Was a CHECK (23514) in 0001; migration 0009 replaced the hardcoded barber list with a FK to
  -- public.barbers, so an unknown barber now raises foreign_key_violation (23503). Still rejected.
  '23503', null, 'barber_id ''nope'' rejected (now by the FK to barbers)'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','carrier-pigeon','0701234567',null,'sv')$$,
  '23514', null, 'method ''carrier-pigeon'' rejected'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:45+00','2099-02-01 09:00+00',
            'X','phone','0701234567',null,'sv')$$,
  '23514', null, 'end_at <= start_at rejected (bookings_time_order)'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:00+00',
            'X','phone','0701234567',null,'sv')$$,
  '23514', null, 'end_at == start_at rejected (range must be non-empty)'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone',null,null,'sv')$$,
  '23514', null, 'sms with NULL phone rejected (bookings_contact_matches_method)'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','email',null,null,'sv')$$,
  '23514', null, 'email with NULL email rejected (bookings_contact_matches_method)'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang, status, cancelled_at)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone','0701234567',null,'sv','cancelled',null)$$,
  '23514', null, 'cancelled status with NULL cancelled_at rejected (bookings_cancel_consistency)'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone','070123',null,'sv')$$,
  '23514', null, 'phone failing ^07[0-9]{8}$ rejected'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',-1,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone','0701234567',null,'sv')$$,
  '23514', null, 'negative price rejected'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,0,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone','0701234567',null,'sv')$$,
  '23514', null, 'duration_min = 0 rejected'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            '','phone','0701234567',null,'sv')$$,
  '23514', null, 'empty customer_name rejected'
);

select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-02-01 09:00+00','2099-02-01 09:45+00',
            'X','phone','0701234567',null,'de')$$,
  '23514', null, 'lang ''de'' rejected'
);

-- ---- reviews CHECK rejections ---------------------------------------------------------------
select throws_ok(
  $$insert into public.reviews (name, rating, text) values ('A', 0, 'hej')$$,
  '23514', null, 'review rating 0 rejected'
);

select throws_ok(
  $$insert into public.reviews (name, rating, text) values ('A', 6, 'hej')$$,
  '23514', null, 'review rating 6 rejected'
);

select * from finish();
rollback;
