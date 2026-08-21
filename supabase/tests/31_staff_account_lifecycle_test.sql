begin;
select plan(14);

insert into public.barbers (id, name) values ('access-test', 'Access Test');
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
values ('access-test', 1, true, 540, 1080);

insert into auth.users (id, email) values
  ('31000000-0000-0000-0000-000000000001', 'owner@access.local'),
  ('31000000-0000-0000-0000-000000000002', 'barber@access.local');
insert into public.profiles (id, role, barber_id) values
  ('31000000-0000-0000-0000-000000000001', 'owner', null),
  ('31000000-0000-0000-0000-000000000002', 'barber', 'access-test');

insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, lang, status)
values
  ('access-test', 'h', 'Hår', 350, 45, '2099-07-05 09:00+00', '2099-07-05 09:45+00',
   'Access Kund', 'phone', '0703100000', 'sv', 'confirmed');

select ok(
  not has_function_privilege('anon', 'public.admin_set_barber_account_enabled(text, boolean)', 'EXECUTE'),
  'anon cannot change staff account state'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','31000000-0000-0000-0000-000000000002')::text, true);
select is(public.current_role(), 'barber', 'enabled staff JWT resolves its role');
select is(public.current_barber_id(), 'access-test', 'enabled staff JWT resolves its barber');
select is((select count(*)::int from public.bookings), 1, 'enabled staff JWT reads own booking');
select is(
  public.admin_set_barber_account_enabled('access-test', false) ->> 'error',
  'forbidden', 'barber cannot change account state'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','31000000-0000-0000-0000-000000000001')::text, true);
select is(
  public.admin_set_barber_account_enabled('access-test', null) ->> 'error',
  'invalid', 'owner must provide explicit account state'
);
select is(
  public.admin_set_barber_account_enabled('access-test', false) ->> 'account_enabled',
  'false', 'owner disables staff account in database'
);

-- Same already-issued JWT claims: database authorization must fail immediately.
select set_config('request.jwt.claims', json_build_object('sub','31000000-0000-0000-0000-000000000002')::text, true);
select is(public.current_role(), null, 'disabled staff JWT no longer resolves a role');
select is(public.current_barber_id(), null, 'disabled staff JWT no longer resolves a barber');
select is((select count(*)::int from public.bookings), 0, 'disabled staff JWT cannot read bookings');
select is(
  public.admin_save_barber_week('access-test', jsonb_build_array(
    jsonb_build_object('weekday',0,'working',false,'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',1,'working',true, 'start_min',600,'end_min',960),
    jsonb_build_object('weekday',2,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',3,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',4,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',5,'working',true, 'start_min',540,'end_min',1080),
    jsonb_build_object('weekday',6,'working',true, 'start_min',540,'end_min',1080)
  )) ->> 'error',
  'forbidden', 'disabled staff JWT cannot mutate availability'
);

select set_config('request.jwt.claims', json_build_object('sub','31000000-0000-0000-0000-000000000001')::text, true);
select is(
  public.admin_set_barber_account_enabled('access-test', true) ->> 'account_enabled',
  'true', 'owner explicitly re-enables staff account'
);

select set_config('request.jwt.claims', json_build_object('sub','31000000-0000-0000-0000-000000000002')::text, true);
select is(public.current_barber_id(), 'access-test', 're-enabled staff JWT resolves its barber again');
select is((select count(*)::int from public.bookings), 1, 're-enabled staff JWT reads own booking again');

select * from finish();
rollback;
