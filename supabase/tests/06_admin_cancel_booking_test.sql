-- pgTAP — admin_cancel_booking RPC (ADMIN_SPEC §2 + §7). The RPC is SECURITY DEFINER and derives
-- the caller's authority from auth.uid() via the helper functions. Proves:
--   owner            -> can cancel ANY booking
--   owning barber    -> can cancel their OWN booking
--   other barber     -> DENIED (forbidden), and the booking stays confirmed
--   idempotency      -> a second cancel of the same booking returns not_found
--   unknown id       -> not_found
-- The RPC returns a JSONB Result object: {ok:true, booking:{...}} or {ok:false, error:...}.

begin;
select plan(13);

-- ---- identities -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001','owner@knc.local'),
  ('20000000-0000-0000-0000-000000000002','victor@knc.local'),
  ('20000000-0000-0000-0000-000000000003','salman@knc.local');
insert into public.profiles (id, role, barber_id) values
  ('20000000-0000-0000-0000-000000000001','owner', null),
  ('20000000-0000-0000-0000-000000000002','barber','victor'),
  ('20000000-0000-0000-0000-000000000003','barber','salman');

-- ---- bookings: one for victor, one for salman (future, confirmed) ----------------------------
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('2b000000-0000-0000-0000-0000000000a1','victor','h','Hår',350,45,
   '2099-05-01 09:00+00','2099-05-01 09:45+00','V Kund','sms','0701110001',null,'sv'),
  ('2b000000-0000-0000-0000-0000000000a2','salman','h','Hår',350,45,
   '2099-05-01 10:00+00','2099-05-01 10:45+00','S Kund','sms','0701110002',null,'sv');

-- =============================================================================================
-- OTHER barber (salman) tries to cancel victor's booking -> forbidden; victor's booking stays.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','20000000-0000-0000-0000-000000000003')::text, true);

select is(
  public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a1') ->> 'ok',
  'false', 'salman canceling victor''s booking returns ok:false'
);
select is(
  public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a1') ->> 'error',
  'forbidden', 'salman canceling victor''s booking returns error:forbidden'
);

reset role;
-- The booking must STILL be confirmed after the denied attempt (check as owner/superuser).
select is(
  (select status from public.bookings where id = '2b000000-0000-0000-0000-0000000000a1'),
  'confirmed', 'victor''s booking is still confirmed after salman''s denied cancel'
);

-- =============================================================================================
-- OWNING barber (victor) cancels HIS OWN booking -> ok; status flips; idempotent second call.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','20000000-0000-0000-0000-000000000002')::text, true);

-- Capture the FIRST cancel's result once (only the first call mutates), then assert on it — a
-- second call would already be cancelled (covered by the idempotency assertion below).
select set_config(
  'test.cancel1',
  public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a1')::text,
  true
);
select is(
  (current_setting('test.cancel1')::jsonb) ->> 'ok',
  'true', 'victor canceling HIS OWN booking returns ok:true'
);
select is(
  (current_setting('test.cancel1')::jsonb) -> 'booking' ->> 'status',
  'cancelled', 'the returned booking status is cancelled'
);
-- Idempotency: a second cancel finds it already cancelled -> not_found.
select is(
  public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a1') ->> 'error',
  'not_found', 'second cancel of the same booking returns not_found (idempotent)'
);

reset role;
-- Confirm the cancel actually persisted with a cancelled_at timestamp.
select is(
  (select status from public.bookings where id = '2b000000-0000-0000-0000-0000000000a1'),
  'cancelled', 'victor''s booking is persisted as cancelled'
);
select isnt(
  (select cancelled_at from public.bookings where id = '2b000000-0000-0000-0000-0000000000a1')::text,
  null, 'cancelled_at is set on the cancelled booking'
);

-- =============================================================================================
-- OWNER cancels salman's booking (a DIFFERENT barber's) -> ok.
-- =============================================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','20000000-0000-0000-0000-000000000001')::text, true);

select is(
  public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a2') ->> 'ok',
  'true', 'owner canceling salman''s booking returns ok:true'
);
select is(
  public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a2') ->> 'error',
  'not_found', 'owner''s second cancel of salman''s booking is idempotent not_found'
);

-- Unknown booking id -> not_found (even for the owner).
select is(
  public.admin_cancel_booking('00000000-0000-0000-0000-0000deadbeef') ->> 'error',
  'not_found', 'canceling a non-existent booking returns not_found'
);

reset role;
select is(
  (select status from public.bookings where id = '2b000000-0000-0000-0000-0000000000a2'),
  'cancelled', 'salman''s booking is persisted as cancelled by the owner'
);

-- =============================================================================================
-- UNAUTHENTICATED (anon) — has no EXECUTE grant on admin_cancel_booking -> 42501.
-- =============================================================================================
set local role anon;
select throws_ok(
  $$select public.admin_cancel_booking('2b000000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'anon CANNOT execute admin_cancel_booking (no grant)'
);
reset role;

select * from finish();
rollback;
