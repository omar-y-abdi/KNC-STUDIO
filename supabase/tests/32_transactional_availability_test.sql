begin;
select plan(35);

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
  pg_catalog.pg_get_functiondef('public.admin_create_booking(text,timestamptz,integer,text,integer,text,text)'::regprocedure)
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

select * from finish();
rollback;
