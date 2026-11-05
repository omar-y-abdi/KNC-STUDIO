begin;
select plan(14);
insert into public.barbers (id, name) values ('durable-invite-test', 'Invitation Test');
insert into auth.users (id, email) values
  ('75000000-0000-0000-0000-000000000001', 'invite@example.invalid');
insert into public.profiles (id, role, barber_id) values
  ('75000000-0000-0000-0000-000000000001', 'barber', 'durable-invite-test');
insert into public.staff_invitations (user_id, token_hash, created_at) values
  ('75000000-0000-0000-0000-000000000001', repeat('a', 64), '2000-01-01');

select ok(not has_table_privilege('anon','public.staff_invitations','SELECT'), 'anonymous cannot read invitation hashes');
select ok(not has_table_privilege('authenticated','public.staff_invitations','INSERT'), 'staff cannot create invitation capabilities');
select ok(not has_function_privilege('anon','public.consume_staff_invitation(text)','EXECUTE'), 'anonymous cannot consume hashes directly');
select ok(not has_function_privilege('authenticated','public.consume_staff_invitation(text)','EXECUTE'), 'staff cannot consume hashes directly');
select ok(has_function_privilege('service_role','public.consume_staff_invitation(text)','EXECUTE'), 'only trusted exchange can claim');
select is(public.consume_staff_invitation(repeat('b',64)), null::uuid, 'wrong token is rejected');
select is(public.consume_staff_invitation(repeat('a',64)), '75000000-0000-0000-0000-000000000001'::uuid, 'decades-old invitation still works');
select is(public.consume_staff_invitation(repeat('a',64)), null::uuid, 'second use is rejected');

insert into public.staff_invitations (user_id, token_hash) values
  ('75000000-0000-0000-0000-000000000001', repeat('c',64));
update public.profiles set account_enabled=false where barber_id='durable-invite-test';
select is(public.consume_staff_invitation(repeat('c',64)), null::uuid, 'disabled account cannot redeem');
update public.profiles set account_enabled=true where barber_id='durable-invite-test';
select is(public.consume_staff_invitation(repeat('c',64)), null::uuid, 're-enabling cannot restore a revoked invitation');

insert into public.staff_invitations (user_id, token_hash) values
  ('75000000-0000-0000-0000-000000000001', repeat('d',64));
update public.staff_invitations set token_hash=repeat('e',64) where user_id='75000000-0000-0000-0000-000000000001';
select is(public.consume_staff_invitation(repeat('d',64)), null::uuid, 'replacement invalidates the previous link');
update auth.users set email_confirmed_at=now() where id='75000000-0000-0000-0000-000000000001';
select is(public.consume_staff_invitation(repeat('e',64)), null::uuid, 'activated account cannot be enrolled again');
delete from public.profiles where id='75000000-0000-0000-0000-000000000001';
select is((select count(*) from public.staff_invitations where user_id='75000000-0000-0000-0000-000000000001'), 0::bigint, 'removing staff also removes the invitation');
select is((select note from public.email_templates where template='auth_invite' and lang='sv'), 'Länken kan bara användas en gång.', 'invite copy promises one use without a time limit');
select * from finish();
rollback;
