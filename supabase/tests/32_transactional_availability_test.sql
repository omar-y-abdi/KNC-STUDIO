begin;
select plan(46);

insert into public.barbers (id, name) values ('availability-test', 'Availability Test');
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
select 'availability-test', weekday, weekday between 1 and 6, 540, 1080
from generate_series(0, 6) weekday;

insert into auth.users (id, email) values
  ('32000000-0000-0000-0000-000000000001', 'owner@availability.local');
insert into public.profiles (id, role, barber_id) values
  ('32000000-0000-0000-0000-000000000001', 'owner', null);

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, lang, status)
values
  ('32000000-0000-0000-0000-000000000010', 'availability-test', 'h', 'Hår', 350, 45,
   '2099-07-06 09:00+00', '2099-07-06 09:45+00', 'Conflict Kund', 'phone', '0703200000', 'sv', 'confirmed');

select ok(
  not has_table_privilege('authenticated', 'public.barber_schedules', 'UPDATE'),
  'authenticated cannot bypass schedule mutation RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.barber_time_off', 'INSERT'),
  'authenticated cannot bypass time-off mutation RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.barber_slot_blocks', 'INSERT'),
  'authenticated cannot bypass slot-block mutation RPC'
);
select ok(
  not has_function_privilege('anon', 'public.admin_save_barber_week(text, jsonb, boolean)', 'EXECUTE'),
  'anon cannot mutate schedules'
);
select ok(
  pg_catalog.pg_get_functiondef('public.create_booking(text,text,timestamptz,text,text,text,text)'::regprocedure)
    like '%availability:%',
  'core booking writer owns the shared availability lock'
);
select ok(
  pg_catalog.pg_get_functiondef('public.admin_create_booking(text,timestamptz,integer,text,numeric,text,text)'::regprocedure)
    like '%availability:%',
  'manual booking writer owns the shared availability lock'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','32000000-0000-0000-0000-000000000001')::text, true);

select set_config(
  'test.closed_week',
  jsonb_build_array(
    jsonb_build_object('weekday',0,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',1,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',2,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',3,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',4,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',5,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',6,'working',false,'start_min',540,'end_min',1080)
  )::text,
  true
);

select set_config('test.week_conflict', public.admin_save_barber_week(
  'availability-test', current_setting('test.closed_week')::jsonb
)::text, true);
select is((current_setting('test.week_conflict')::jsonb) ->> 'error', 'booking_conflict',
  'schedule mutation detects future booking conflict');
select is((current_setting('test.week_conflict')::jsonb) -> 'booking_ids' ->> 0,
  '32000000-0000-0000-0000-000000000010', 'schedule conflict identifies booking');
select is((select working::text from public.barber_schedules where barber_id='availability-test' and weekday=1),
  'true', 'conflicting schedule mutation is atomic and changes nothing');
select is(public.admin_save_barber_week(
  'availability-test', current_setting('test.closed_week')::jsonb, null
) ->> 'error', 'booking_conflict', 'null schedule override cannot bypass booking conflict');
select is(public.admin_save_barber_week(
  'availability-test', current_setting('test.closed_week')::jsonb, true
) ->> 'ok', 'true', 'explicit override saves schedule');
select is((select working::text from public.barber_schedules where barber_id='availability-test' and weekday=1),
  'false', 'overridden schedule mutation persisted');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, 'Manuell', 350, 'Manual Kund', '0703200001'
) ->> 'error', 'outside_hours', 'manual reservation cannot bypass the closed schedule');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', null, 'Manuell', 350, 'Manual Kund', '0703200001'
) ->> 'error', 'invalid', 'manual reservation rejects null duration without raising');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, null, 350, 'Manual Kund', '0703200001'
) ->> 'error', 'invalid', 'manual reservation rejects null service name without raising');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, 'Manuell', null, 'Manual Kund', '0703200001'
) ->> 'error', 'invalid', 'manual reservation rejects null price without raising');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, 'Manuell', 350, null, '0703200001'
) ->> 'error', 'invalid', 'manual reservation rejects null customer name without raising');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, repeat('x', 81), 350, 'Manual Kund', '0703200001'
) ->> 'error', 'invalid', 'manual reservation rejects oversized service name');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, 'Manuell', 100001, 'Manual Kund', '0703200001'
) ->> 'error', 'invalid', 'manual reservation rejects oversized price');
select is(public.admin_create_booking(
  'availability-test', '2099-07-06 09:00+00', 45, 'Manuell', 350, 'Manual Kund', '123'
) ->> 'error', 'invalid', 'manual reservation rejects malformed phone');

select set_config('test.off_conflict', public.admin_add_time_off(
  'availability-test', '2099-07-06', '2099-07-06', 'Stängt'
)::text, true);
select is((current_setting('test.off_conflict')::jsonb) ->> 'error', 'booking_conflict',
  'time-off mutation detects future booking conflict');
select is((select count(*)::int from public.barber_time_off where barber_id='availability-test'), 0,
  'conflicting time-off mutation inserts nothing');
select is(public.admin_add_time_off(
  'availability-test', '2099-07-06', '2099-07-06', 'Stängt', null
) ->> 'error', 'booking_conflict', 'null time-off override cannot bypass booking conflict');
select is(public.admin_add_time_off(
  'availability-test', '2099-07-06', '2099-07-06', 'Stängt', true
) ->> 'ok', 'true', 'explicit override adds time off');
select is((select count(*)::int from public.barber_time_off where barber_id='availability-test'), 1,
  'overridden time off persisted');

select set_config('test.slot_conflict', public.admin_add_slot_block(
  'availability-test', '2099-07-06', 660, 705
)::text, true);
select is((current_setting('test.slot_conflict')::jsonb) ->> 'error', 'booking_conflict',
  'slot-block mutation detects overlapping booking');
select is((select count(*)::int from public.barber_slot_blocks where barber_id='availability-test'), 0,
  'conflicting slot block inserts nothing');
select is(public.admin_add_slot_block(
  'availability-test', '2099-07-06', 660, 705, null
) ->> 'error', 'booking_conflict', 'null slot override cannot bypass booking conflict');
select is(public.admin_add_slot_block(
  'availability-test', '2099-07-06', 660, 705, true
) ->> 'ok', 'true', 'explicit override adds slot block');
select is((select count(*)::int from public.barber_slot_blocks where barber_id='availability-test'), 1,
  'overridden slot block persisted');

select is(
  public.admin_add_time_off('missing-barber', '2099-07-06', '2099-07-06', '') ->> 'error',
  'not_found', 'time-off RPC rejects missing barber'
);
select is(
  public.admin_add_time_off('availability-test', '2099-07-07', '2099-07-07', repeat('x', 121)) ->> 'error',
  'invalid', 'time-off RPC enforces table reason length before insert'
);
select is(
  public.admin_add_slot_block('availability-test', '2099-07-06', 585, 540) ->> 'error',
  'invalid', 'slot-block RPC rejects invalid interval'
);
select is(
  public.admin_add_slot_block('availability-test', '2099-07-06', null, 585) ->> 'error',
  'invalid', 'slot-block RPC rejects null bounds without raising'
);
select is(
  public.admin_save_barber_week('availability-test', '[]'::jsonb) ->> 'error',
  'invalid', 'schedule RPC rejects incomplete week'
);

-- A confirmed booking is a conflict while end_at > now(): one that started 10 minutes ago still blocks
-- the change, one that already ended does not. A dedicated barber keeps these rows out of the lists
-- asserted above (they are ordered by start_at), and every call below is scoped to cover BOTH
-- bookings, so "the finished booking is not reported" can only come from the end_at predicate and
-- never from an out-of-scope date. Dates come from the rows (salon-local), so the block is correct at
-- any time of day, including just after midnight.
reset role;

insert into public.barbers (id, name) values ('availability-live', 'Availability Live');
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
select 'availability-live', weekday, true, 540, 1080
from generate_series(0, 6) weekday;

-- The slot-overlap arithmetic compares minutes-of-day and cannot see a booking that ends inside the
-- 00:00 minute, so the in-progress booking is one minute longer when "now + 35 min" would land there.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, lang, status)
select '32000000-0000-0000-0000-000000000021', 'availability-live', 'h', 'Hår', 350, d.mins,
  pg_catalog.now() - interval '10 minutes',
  pg_catalog.now() - interval '10 minutes' + pg_catalog.make_interval(mins => d.mins),
  'In Progress Kund', 'phone', '0703200021', 'sv', 'confirmed'
from (
  select case
    when ((pg_catalog.now() + interval '35 minutes') at time zone 'Europe/Stockholm')::time < time '00:01'
      then 46
    else 45
  end as mins
) d;
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, lang, status)
values
  ('32000000-0000-0000-0000-000000000022', 'availability-live', 'h', 'Hår', 350, 45,
   pg_catalog.now() - interval '3 hours', pg_catalog.now() - interval '135 minutes',
   'Finished Kund', 'phone', '0703200022', 'sv', 'confirmed');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','32000000-0000-0000-0000-000000000001')::text, true);

-- Week save (a closed week strands every booking that has not ended).
select set_config('test.live_week', public.admin_save_barber_week(
  'availability-live', current_setting('test.closed_week')::jsonb
)::text, true);
select is((current_setting('test.live_week')::jsonb) ->> 'error', 'booking_conflict',
  'week save: an in-progress booking is a conflict');
select ok((current_setting('test.live_week')::jsonb -> 'booking_ids') ? '32000000-0000-0000-0000-000000000021',
  'week save reports the in-progress booking');
select ok(not ((current_setting('test.live_week')::jsonb -> 'booking_ids') ? '32000000-0000-0000-0000-000000000022'),
  'week save does not report the finished booking');

-- Time off over every salon-local date that holds one of the two bookings.
select set_config('test.live_off', public.admin_add_time_off(
  'availability-live',
  (select min((start_at at time zone 'Europe/Stockholm')::date)
     from public.bookings where barber_id = 'availability-live'),
  (select max((start_at at time zone 'Europe/Stockholm')::date)
     from public.bookings where barber_id = 'availability-live'),
  'Live'
)::text, true);
select is((current_setting('test.live_off')::jsonb) ->> 'error', 'booking_conflict',
  'time off: an in-progress booking is a conflict');
select ok((current_setting('test.live_off')::jsonb -> 'booking_ids') ? '32000000-0000-0000-0000-000000000021',
  'time off reports the in-progress booking');
select ok(not ((current_setting('test.live_off')::jsonb -> 'booking_ids') ? '32000000-0000-0000-0000-000000000022'),
  'time off does not report the finished booking');
select is((select count(*)::int from public.barber_time_off where barber_id='availability-live'), 0,
  'conflicting time off inserts nothing');

-- Slot block over the whole salon-local day of each booking (0-1440 minutes), one call per booking.
select set_config('test.live_slot', public.admin_add_slot_block(
  'availability-live',
  (select (start_at at time zone 'Europe/Stockholm')::date
     from public.bookings where id = '32000000-0000-0000-0000-000000000021'),
  0, 1440
)::text, true);
select is((current_setting('test.live_slot')::jsonb) ->> 'error', 'booking_conflict',
  'slot block: an in-progress booking is a conflict');
select ok((current_setting('test.live_slot')::jsonb -> 'booking_ids') ? '32000000-0000-0000-0000-000000000021',
  'slot block reports the in-progress booking');
select is((select count(*)::int from public.barber_slot_blocks where barber_id='availability-live'), 0,
  'conflicting slot block inserts nothing');
select set_config('test.live_slot_finished', public.admin_add_slot_block(
  'availability-live',
  (select (start_at at time zone 'Europe/Stockholm')::date
     from public.bookings where id = '32000000-0000-0000-0000-000000000022'),
  0, 1440
)::text, true);
select ok(not coalesce(
  (current_setting('test.live_slot_finished')::jsonb -> 'booking_ids') ? '32000000-0000-0000-0000-000000000022',
  false
), 'slot block does not report the finished booking');

select * from finish();
rollback;
