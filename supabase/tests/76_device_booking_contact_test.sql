begin;
select plan(13);
insert into public.barbers(id,name) values('device-contact','Device Contact');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, created_at)
values
('76000000-0000-4000-8000-000000000001','device-contact','s','Cut',100,30,'2099-04-01 10:00Z','2099-04-01 10:30Z','Receipt A','email','0707600001','a-contact@example.test','sv','confirmed','2098-01-01'),
('76000000-0000-4000-8000-000000000002','device-contact','s','Cut',100,30,'2099-04-02 10:00Z','2099-04-02 10:30Z','Other B','email','0707600001','b-contact@example.test','sv','confirmed','2098-01-03'),
('76000000-0000-4000-8000-000000000003','device-contact','s','Cut',100,30,'2099-04-03 10:00Z','2099-04-03 10:30Z','New A','email','0707600003','a-contact@example.test','sv','confirmed','2098-01-02');
select public.append_customer_booking_receipt('76000000-0000-4000-8000-000000000001',null,repeat('76',32),null);
select public.append_customer_booking_receipt('76000000-0000-4000-8000-000000000002',null,repeat('77',32),null);
select is(public.list_customer_bookings_for_browser(null,repeat('76',32))->'booking_contact',
  '{"name":"Receipt A","phone":"0707600001","email":"a-contact@example.test"}'::jsonb,
  'receipt A prefills only its exact booking, not newer history or shared-phone B');
select is(public.list_customer_bookings_for_browser(null,repeat('77',32))->'booking_contact'->>'name','Other B','receipt B has its own contact');
select is(public.list_customer_bookings_for_browser(null,repeat('76',32))->>'authority','device','prefill never promotes authority');
select ok(not(public.list_customer_bookings_for_browser(null,repeat('76',32)) ? 'email'),'prefill never exposes a verified profile');
select ok(not(public.list_customer_bookings_for_browser(null,null) ? 'booking_contact'),'missing receipt has no contact');
select ok(not(public.list_customer_bookings_for_browser(null,repeat('78',32)) ? 'booking_contact'),'unknown receipt has no contact');
select public.append_customer_booking_receipt('76000000-0000-4000-8000-000000000003',repeat('76',32),repeat('79',32),null);
select is(public.list_customer_bookings_for_browser(null,repeat('76',32))->'booking_contact'->>'name','New A','most recently created owned booking supplies complete contact');
insert into public.customer_booking_access_sessions(phone,email,token_hash,expires_at)
values('0707600001','b-contact@example.test',repeat('7a',32),now()+interval '1 day');
select ok(not(public.list_customer_bookings_for_browser(repeat('7a',32),repeat('76',32)) ? 'booking_contact'),'verified B does not inherit A device prefill');
select is(public.list_customer_bookings_for_browser(repeat('7a',32),repeat('76',32))->>'name','Other B','verified profile retains precedence');
update public.customer_booking_receipts set expires_at=now()-interval '1 second' where token_hash=repeat('76',32);
select ok(not(public.list_customer_bookings_for_browser(null,repeat('76',32)) ? 'booking_contact'),'expired receipt has no contact');
select public.forget_customer_booking_receipt(repeat('77',32));
select ok(not(public.list_customer_bookings_for_browser(null,repeat('77',32)) ? 'booking_contact'),'revoked receipt has no contact');
select ok(not has_function_privilege('anon','public.list_customer_bookings_for_browser(text,text)','execute'),'anonymous callers cannot query contact RPC');
select ok(not has_function_privilege('authenticated','public.list_customer_bookings_for_browser(text,text)','execute'),'staff/browser sessions cannot query contact RPC');
select * from finish();
rollback;
