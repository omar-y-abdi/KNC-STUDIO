begin;

select plan(25);

insert into public.barbers (id, name) values ('recurring-availability', 'Recurring Availability');
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
select 'recurring-availability', weekday, weekday = 1, 540, 1080
from generate_series(0, 6) as weekday;

insert into public.services (id, barber_id, name, price, duration_min, active, sort_order)
values (
  '36000000-0000-0000-0000-000000000001',
  'recurring-availability', 'Every day service', 350, 30, true, 1
);

select is(
  (select available_weekdays from public.services where id = '36000000-0000-0000-0000-000000000001'),
  array[0, 1, 2, 3, 4, 5, 6]::smallint[],
  'existing/new services default to every weekday'
);
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min, available_weekdays)
     values ('recurring-availability', 'No day', 350, 30, '{}'::smallint[]) $$,
  '23514', null, 'service rejects an empty weekday set'
);
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min, available_weekdays)
     values ('recurring-availability', 'Bad day', 350, 30, array[7]::smallint[]) $$,
  '23514', null, 'service rejects an out-of-range weekday'
);
select throws_ok(
  $$ insert into public.services (barber_id, name, price, duration_min, available_weekdays)
     values ('recurring-availability', 'Duplicate day', 350, 30, array[1, 1, 2, 3, 4, 5, 6]::smallint[]) $$,
  '23514', null, 'service rejects duplicate weekday values'
);

select ok(
  not has_table_privilege('anon', 'public.barber_recurring_breaks', 'SELECT'),
  'anon cannot read recurring breaks directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.barber_recurring_breaks', 'INSERT'),
  'authenticated cannot bypass recurring-break RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.admin_add_recurring_break(text,integer,integer,integer,boolean)', 'EXECUTE'
  ),
  'anon cannot add a recurring break'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.admin_add_recurring_break(text,integer,integer,integer,boolean)', 'EXECUTE'
  ),
  'authenticated staff can use recurring-break mutation RPC'
);

insert into auth.users (id, email) values
  ('36000000-0000-0000-0000-000000000010', 'owner@recurring-availability.test');
insert into public.profiles (id, role, barber_id) values
  ('36000000-0000-0000-0000-000000000010', 'owner', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '36000000-0000-0000-0000-000000000010')::text,
  true
);
select is(
  public.admin_add_recurring_break('recurring-availability', 1, 720, 780) ->> 'ok',
  'true', 'owner creates Monday 12:00–13:00 recurring break through RPC'
);
select is(
  public.admin_add_recurring_break('recurring-availability', 1, 720, 780) ->> 'error',
  'duplicate', 'overlapping recurring break is rejected'
);
reset role;

select is(
  (select count(*)::integer from public.available_slots('recurring-availability', date '2099-01-05', 30)),
  30, 'recurring break removes every overlapping 30-minute slot from generic available_slots'
);
select is(
  (select count(*)::integer
   from public.available_slots('recurring-availability', date '2099-01-05', 30) slot
   where slot in ('11:45', '12:00', '12:15', '12:30', '12:45')),
  0, 'slot ending after or starting inside recurring break is unavailable'
);
select is(
  (select count(*)::integer
   from public.available_slots('recurring-availability', date '2099-01-05', 30) slot
   where slot = '13:00'),
  1, 'half-open break allows a slot starting exactly at break end'
);
select is(
  (select count(*)::integer
   from public.available_slots_for_service(
     'recurring-availability', date '2099-01-05', '36000000-0000-0000-0000-000000000001'
   )),
  30, 'service-aware public availability includes recurring-break enforcement'
);

set local role service_role;
select is(
  public.create_booking(
    'recurring-availability', '36000000-0000-0000-0000-000000000001',
    (date '2099-01-05' + time '12:00') at time zone 'Europe/Stockholm',
    '0703600000', 'break@example.test', 'sv', 'Break Customer'
  ) ->> 'error',
  'outside_hours', 'create_booking rejects a recurring-break overlap'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '36000000-0000-0000-0000-000000000010')::text,
  true
);
select is(
  public.admin_create_booking(
    'recurring-availability',
    (date '2099-01-05' + time '12:00') at time zone 'Europe/Stockholm',
    30, 'Manual', 350, 'Manual Customer', null
  ) ->> 'error',
  'outside_hours', 'manual booking writer also rejects a recurring-break overlap'
);
reset role;

update public.services
set available_weekdays = array[2]::smallint[]
where id = '36000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer
   from public.available_slots_for_service(
     'recurring-availability', date '2099-01-05', '36000000-0000-0000-0000-000000000001'
   )),
  0, 'service is absent from client availability on an unconfigured weekday'
);
set local role service_role;
select is(
  public.create_booking(
    'recurring-availability', '36000000-0000-0000-0000-000000000001',
    (date '2099-01-05' + time '14:00') at time zone 'Europe/Stockholm',
    '0703600001', 'weekday@example.test', 'sv', 'Weekday Customer'
  ) ->> 'error',
  'outside_hours', 'create_booking enforces configured service weekday'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '36000000-0000-0000-0000-000000000010')::text,
  true
);
select is(
  public.admin_save_barber_week(
    'recurring-availability',
    jsonb_build_array(
      jsonb_build_object('weekday', 0, 'working', false, 'start_min', 540, 'end_min', 1080),
      jsonb_build_object('weekday', 1, 'working', true, 'start_min', 545, 'end_min', 1080),
      jsonb_build_object('weekday', 2, 'working', false, 'start_min', 540, 'end_min', 1080),
      jsonb_build_object('weekday', 3, 'working', false, 'start_min', 540, 'end_min', 1080),
      jsonb_build_object('weekday', 4, 'working', false, 'start_min', 540, 'end_min', 1080),
      jsonb_build_object('weekday', 5, 'working', false, 'start_min', 540, 'end_min', 1080),
      jsonb_build_object('weekday', 6, 'working', false, 'start_min', 540, 'end_min', 1080)
    )
  ) ->> 'error',
  'invalid', 'schedule RPC rejects a non-15-minute weekly schedule value'
);
reset role;

-- A recurring break over a confirmed booking is a booking_conflict until the owner overrides it. The
-- bookings use fixed dates because a break must lie inside 09:00-18:00, which an "in progress"
-- booking cannot do at every time of day. This block pins the weekday/overlap logic and that a
-- booking that ended long ago is not reported; the in-progress boundary of the end_at predicate
-- (end_at vs start_at) is pinned for week save, time off and slot block in
-- 32_transactional_availability_test.sql.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, lang, status)
values
  ('36000000-0000-0000-0000-000000000021', 'recurring-availability', 'h', 'Hår', 350, 45,
   (date '2099-01-12' + time '14:00') at time zone 'Europe/Stockholm',
   (date '2099-01-12' + time '14:45') at time zone 'Europe/Stockholm',
   'Upcoming Kund', 'phone', '0703600021', 'sv', 'confirmed'),
  ('36000000-0000-0000-0000-000000000022', 'recurring-availability', 'h', 'Hår', 350, 45,
   (date '2020-01-06' + time '14:00') at time zone 'Europe/Stockholm',
   (date '2020-01-06' + time '14:45') at time zone 'Europe/Stockholm',
   'Finished Kund', 'phone', '0703600022', 'sv', 'confirmed');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '36000000-0000-0000-0000-000000000010')::text,
  true
);
select set_config('test.break_conflict', public.admin_add_recurring_break(
  'recurring-availability', 1, 840, 900
)::text, true);
select is((current_setting('test.break_conflict')::jsonb) ->> 'error', 'booking_conflict',
  'recurring break over a confirmed upcoming booking is a booking_conflict');
select ok((current_setting('test.break_conflict')::jsonb -> 'booking_ids') ? '36000000-0000-0000-0000-000000000021',
  'recurring-break conflict identifies the upcoming booking');
select ok(not ((current_setting('test.break_conflict')::jsonb -> 'booking_ids') ? '36000000-0000-0000-0000-000000000022'),
  'recurring-break conflict does not report a booking that ended long ago');
select is(public.admin_add_recurring_break(
  'recurring-availability', 1, 840, 900, null
) ->> 'error', 'booking_conflict', 'null recurring-break override cannot bypass booking conflict');
select is(public.admin_add_recurring_break(
  'recurring-availability', 1, 840, 900, true
) ->> 'ok', 'true', 'explicit override adds the recurring break');
reset role;

select is(
  (select count(*)::integer from public.barber_recurring_breaks
   where barber_id = 'recurring-availability' and weekday = 1 and start_min = 840 and end_min = 900),
  1, 'the conflicting call inserted nothing and the override inserted exactly one break'
);

select * from finish();
rollback;
