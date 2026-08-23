begin;
select plan(9);

select is((select count(*)::int from public.email_templates), 16, 'all email template variants are seeded');
select is(
  (select subject from public.email_templates where template = 'customer_confirmation' and lang = 'sv'),
  'Bokningsbekräftelse', 'customer confirmation subject is clean'
);
select is(
  (select intro from public.email_templates where template = 'customer_confirmation' and lang = 'sv'),
  E'Hej {customer_name},\nTack för din bokning, du är varmt välkommen till oss!',
  'customer confirmation intro matches approved copy'
);
select ok(
  has_table_privilege('authenticated', 'public.email_templates', 'select'),
  'authenticated role has table-level select grant'
);
select ok(
  not has_table_privilege('anon', 'public.email_templates', 'select'),
  'anon cannot read editable email copy'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.email_template_for_delivery(text,text)', 'execute'),
  'anon cannot call delivery RPC'
);
select ok(
  pg_catalog.has_function_privilege('service_role', 'public.email_template_for_delivery(text,text)', 'execute'),
  'service role can call delivery RPC'
);
select is(
  (select cta_label from public.email_templates where template = 'auth_invite' and lang = 'sv'),
  'Skapa mitt lösenord', 'staff invite copy is owner-editable and seeded'
);
select throws_ok(
  $$ insert into public.email_templates (template, lang, subject, preheader, title, intro, note, cta_label)
     values ('unknown', 'sv', 'x', 'x', 'x', 'x', 'x', 'x') $$,
  '23514', null, 'unknown template type is rejected'
);

select * from finish();
rollback;
