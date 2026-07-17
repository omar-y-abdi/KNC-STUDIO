-- pgTAP — bookings duration/price bounds aligned with the services menu (migration 20260717120100).
-- A service is configurable up to 600 min / 100000 kr; the booking insert previously capped duration
-- at 480 and price below 100000, so those services produced a "Något gick fel" on booking. This pins
-- the widened bounds accept everything a valid service offers, while the floors still guard.

begin;
select plan(4);

-- A 600-min service (the services ceiling) is now bookable.
select lives_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan','manual','Lång behandling',500,600,
             '2099-04-01 06:00+00','2099-04-01 16:00+00','Long Dur','walkin', null, null, 'sv') $$,
  'a 600-min booking is accepted');

-- A 100000-kr service (the services ceiling, previously excluded by price < 100000) is now bookable.
select lives_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan','manual','Dyr behandling',100000,45,
             '2099-04-02 09:00+00','2099-04-02 09:45+00','Max Price','walkin', null, null, 'sv') $$,
  'a 100000-kr booking is accepted');

-- The new duration ceiling still guards: 601 min is rejected.
select throws_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan','manual','För lång',0,601,
             '2099-04-03 09:00+00','2099-04-03 09:45+00','Over Dur','walkin', null, null, 'sv') $$,
  '23514', null, 'a 601-min booking is rejected (duration ceiling still enforced)');

-- The new price ceiling still guards: 100001 kr is rejected.
select throws_ok(
  $$ insert into public.bookings
       (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
        customer_name, method, phone, email, lang)
     values ('hassan','manual','För dyr',100001,45,
             '2099-04-04 09:00+00','2099-04-04 09:45+00','Over Price','walkin', null, null, 'sv') $$,
  '23514', null, 'a 100001-kr booking is rejected (price ceiling still enforced)');

select * from finish();
rollback;
