begin;
select plan(32);

insert into public.barbers(id,name) values('device-review','Device Review');
insert into public.bookings
  (id,barber_id,service_id,service_name,price,duration_min,start_at,end_at,
   customer_name,method,phone,email,lang,status)
values
('77000000-0000-4000-8000-000000000001','device-review','s','Cut',100,30,now()-interval '10 days',now()-interval '10 days'+interval '30 minutes','Receipt Customer','email','0707700001','receipt-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000002','device-review','s','Cut',100,30,now()-interval '9 days',now()-interval '9 days'+interval '30 minutes','Older History','email','0707700001','receipt-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000003','device-review','s','Cut',100,30,now()-interval '8 days',now()-interval '8 days'+interval '30 minutes','Other Device','email','0707700001','other-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000004','device-review','s','Cut',100,30,now()+interval '2 days',now()+interval '2 days 30 minutes','Future Customer','email','0707700004','future-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000005','device-review','s','Cut',100,30,now()-interval '15 minutes',now()+interval '15 minutes','Ongoing Customer','email','0707700005','ongoing-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000006','device-review','s','Cut',100,30,now()-interval '6 days',now()-interval '6 days'+interval '30 minutes','Cancelled Customer','email','0707700006','cancelled-review@example.test','sv','cancelled'),
('77000000-0000-4000-8000-000000000007','device-review','s','Cut',100,30,now()-interval '5 days',now()-interval '5 days'+interval '30 minutes','Parent Receipt','email','0707700007','child-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000008','device-review','s','Cut',100,30,now()-interval '4 days',now()-interval '4 days'+interval '30 minutes','Wrong Parent','email','0707700008','wrong-parent@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000009','device-review','s','Cut',100,30,now()-interval '3 days',now()-interval '3 days'+interval '30 minutes','Expired Receipt','email','0707700009','expired-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000010','device-review','s','Cut',100,30,now()-interval '2 days',now()-interval '2 days'+interval '30 minutes','Revoked Receipt','email','0707700010','revoked-review@example.test','sv','confirmed'),
('77000000-0000-4000-8000-000000000011','device-review','s','Cut',100,30,now()-interval '1 day',now()-interval '1 day'+interval '30 minutes','Expired Session','email','0707700011','fallback-review@example.test','sv','confirmed');

insert into public.customer_booking_access_sessions(phone,email,token_hash,expires_at) values
('0707700099','receipt-review@example.test',repeat('aa',32),now()+interval '1 day'),
('0707700001','other-review@example.test',repeat('bb',32),now()+interval '1 day'),
('0707700099','receipt-review@example.test',repeat('cc',32),now()-interval '1 second');

select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000001',null,repeat('77',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000004',repeat('77',32),repeat('77',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000005',repeat('77',32),repeat('77',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000006',repeat('77',32),repeat('77',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000003',null,repeat('78',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000007',null,repeat('79',32),repeat('aa',32));
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000008',repeat('79',32),repeat('79',32),repeat('bb',32));
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000009',null,repeat('7a',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000010',null,repeat('7b',32),null);
select public.append_customer_booking_receipt('77000000-0000-4000-8000-000000000011',null,repeat('7c',32),null);
update public.customer_booking_receipts set expires_at=now()-interval '1 second' where token_hash=repeat('7a',32);
select public.forget_customer_booking_receipt(repeat('7b',32));

select ok(not has_function_privilege('anon','public.create_review_for_browser(text,text,text,integer,text)','execute'),'anonymous callers cannot bypass the Edge review gateway');
select ok(not has_function_privilege('authenticated','public.create_review_for_browser(text,text,text,integer,text)','execute'),'staff/browser sessions cannot bypass the Edge review gateway');
select ok(has_function_privilege('service_role','public.create_review_for_browser(text,text,text,integer,text)','execute'),'gateway role can call the browser review RPC');
set local role service_role;
select is(public.create_review_for_browser(null,null,'0707700001',5,'Missing')->>'error','no_booking','phone alone never authorizes a review');
select is(public.create_review_for_browser(null,'malformed','0707700001',5,'Invalid')->>'error','no_booking','malformed receipt cannot authorize');
select is(public.create_review_for_browser(null,repeat('ff',32),'0707700001',5,'Unknown')->>'error','no_booking','unknown receipt cannot authorize');
select is(public.create_review_for_browser(null,repeat('7a',32),'0707700009',5,'Expired')->>'error','no_booking','expired receipt cannot authorize');
select is(public.create_review_for_browser(null,repeat('7b',32),'0707700010',5,'Revoked')->>'error','no_booking','forgotten receipt cannot authorize');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700004',5,'Future')->>'error','no_booking','future owned booking cannot be reviewed');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700005',5,'Ongoing')->>'error','no_booking','ongoing owned booking cannot be reviewed');
reset role;
update public.bookings set start_at=now()-interval '30 minutes',end_at=now() where id='77000000-0000-4000-8000-000000000005';
set local role service_role;
select is(public.create_review_for_browser(null,repeat('77',32),'0707700005',5,'Exact boundary')->>'error','no_booking','booking end must be strictly earlier than database time');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700006',5,'Cancelled')->>'error','no_booking','cancelled owned booking cannot be reviewed');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700007',5,'Wrong phone')->>'error','no_booking','receipt cannot review a different phone');
select is(public.create_review_for_browser(repeat('aa',32),repeat('79',32),'0707700008',5,'Wrong parent')->>'error','no_booking','verified session excludes receipts attached to another parent');
select is(public.create_review_for_browser(repeat('bb',32),repeat('79',32),'0707700007',5,'Other session')->>'error','no_booking','switching verified sessions does not import the former parent receipt');
select is(public.create_review_for_browser(repeat('bb',32),repeat('7c',32),'0707700011',5,'Anonymous receipt')->>'error','no_booking','verified session excludes unrelated anonymous device receipt');
select is(public.create_review_for_browser(null,repeat('77',32),'bad',5,'Phone')->>'error','invalid','phone validation retained');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700001',0,'Rating')->>'error','invalid','rating lower bound retained');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700001',6,'Rating')->>'error','invalid','rating upper bound retained');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700001',5,'')->>'error','invalid','empty text rejected');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700001',5,repeat('x',1001))->>'error','invalid','oversized text rejected');
select is(public.create_review_for_browser(null,repeat('77',32),'0707700001',5,'Receipt only')->'review'->>'name','Receipt C.','device-only completed booking succeeds with a server-derived name');
reset role;
select is((select booking_id from public.reviews where text='Receipt only'),'77000000-0000-4000-8000-000000000001'::uuid,'review selects the exact receipt booking, not newer same-phone or same-email history');
set local role service_role;
select is(public.create_review_for_browser(null,repeat('77',32),'0707700001',5,'Again')->>'error','no_booking','already-reviewed receipt cannot borrow another booking with the same contact');
select is(public.create_review_for_browser(repeat('aa',32),repeat('79',32),'0707700007',5,'Parent')->>'ok','true','verified session may review its parent-bound receipt with different contact');
select is(public.create_review_for_browser(repeat('aa',32),repeat('78',32),'0707700001',5,'Verified')->'review'->>'name','Older H.','verified profile wins over an unrelated receipt sharing its phone');
select is(public.create_review_for_browser(repeat('cc',32),repeat('7c',32),'0707700011',5,'Fallback')->>'ok','true','expired session falls back to exact receipt access, as listing does');
select is(public.create_review_with_access(repeat('bb',32),'0707700001',5,'Compatibility')->'review'->>'name','Other D.','old email-only RPC remains compatible during rolling deployment');
reset role;
select is((select count(*) from public.reviews where booking_id='77000000-0000-4000-8000-000000000001'),1::bigint,'one review persisted for the receipt booking');
select is(public.list_customer_bookings_for_browser(null,repeat('77',32))->>'authority','device','review never promotes receipt authority to verified');
select ok(not(public.list_customer_bookings_for_browser(null,repeat('77',32)) ? 'email'),'review never exposes a verified email profile');
select is((select count(*) from public.reviews where booking_id in ('77000000-0000-4000-8000-000000000004','77000000-0000-4000-8000-000000000005','77000000-0000-4000-8000-000000000006','77000000-0000-4000-8000-000000000008','77000000-0000-4000-8000-000000000009','77000000-0000-4000-8000-000000000010')),0::bigint,'denied bookings remain unreviewed');
select * from finish();
rollback;
