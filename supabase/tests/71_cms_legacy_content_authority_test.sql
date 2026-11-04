begin;
select no_plan();

insert into auth.users(id,email) values
 ('71000000-0000-4000-8000-000000000001','legacy-content-owner@example.invalid');
insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values
 ('71000000-0000-4000-8000-000000000001','owner',null,true,false);

-- Rows the retired authenticated writers accepted before the authority migration revoked them:
-- site_content took any key, the mail editor any text within the column limits. The superuser
-- stands in for those writers; the authority migration changes privileges, not stored rows.
insert into public.site_content(key,lang,value) values
 ('retired_banner','sv','Gammal banner'),('retired_banner','en','Old banner'),
 ('kicker','sv','Behållen rubrik'),('kicker','en','Kept heading')
on conflict(key,lang) do update set value=excluded.value;
update public.email_templates set subject='Hej {first_name}'
where template='auth_recovery' and lang='sv';

select set_config('test.state',public.internal_cms_state(
 '71000000-0000-4000-8000-000000000001')::text,true);

select ok(not ((current_setting('test.state')::jsonb#>'{document,site}') ? 'retired_banner'),
 'Studio state omits a site key that neither Studio nor the public site reads');
select is(current_setting('test.state')::jsonb#>'{document,site,kicker}',
 '{"en":"Kept heading","sv":"Behållen rubrik"}'::jsonb,
 'Studio state keeps supported site copy');
select is((select e.value->>'subject'
 from jsonb_array_elements(current_setting('test.state')::jsonb#>'{document,emails}') e(value)
 where e.value->>'template'='auth_recovery' and e.value->>'lang'='sv'),'Hej {first_name}',
 'Studio state offers the persisted email copy unchanged');

set local role service_role;
select lives_ok($$select public.internal_cms_publish('71000000-0000-4000-8000-000000000001',
 current_setting('test.state')::jsonb->'document',
 (current_setting('test.state')::jsonb->>'revision')::bigint,
 current_setting('test.state')::jsonb->>'fingerprint','71000000-0000-4000-8000-000000000002')$$,
 'The unchanged Studio document publishes');
reset role;

select is((select count(*) from public.site_content where key='retired_banner'),0::bigint,
 'Publication removes the unread site key in both languages');
select is((select count(*) from public.site_content where key='kicker'),2::bigint,
 'Publication keeps supported site copy in both languages');
select is((select subject from public.email_templates where template='auth_recovery' and lang='sv'),
 'Hej {first_name}','Publication keeps the persisted email copy unchanged');

select * from finish();
rollback;
