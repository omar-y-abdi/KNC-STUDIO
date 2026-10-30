begin;
select no_plan();

insert into auth.users(id,email) values
 ('70000000-0000-4000-8000-000000000001','single-writer-owner@example.invalid'),
 ('70000000-0000-4000-8000-000000000002','single-writer-barber@example.invalid');
insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values
 ('70000000-0000-4000-8000-000000000001','owner',null,true,false),
 ('70000000-0000-4000-8000-000000000002','barber','victor',true,false);
insert into public.site_content(key,lang,value) values
 ('kicker','sv','Före publicering'),('kicker','en','Before publication')
on conflict(key,lang) do update set value=excluded.value;
update public.site_settings set value='24' where key='cancellation_policy_hours';
select set_config('test.cms_before',public.internal_cms_state(
 '70000000-0000-4000-8000-000000000001')::text,true);
select set_config('test.business_before',(select value from public.site_settings where key='business_name'),true);
select set_config('test.read_counts',jsonb_build_object(
 'site',(select count(*) from public.site_content),
 'about',(select count(*) from public.about_content),
 'emails',(select count(*) from public.email_templates),
 'settings',(select count(*) from public.site_settings))::text,true);

select results_eq($$
 select t.name || ':' || p.privilege
 from unnest(array['site_content','about_content','email_templates']) t(name)
 cross join unnest(array['INSERT','UPDATE','DELETE']) p(privilege)
 where has_table_privilege('authenticated','public.' || t.name,p.privilege)
 order by 1
$$,$$select null::text where false$$,'Browser roles have no direct content DML capability');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.site_content),(current_setting('test.read_counts')::jsonb->>'site')::bigint,
 'The owner still reads every public site-copy row');
select is((select count(*) from public.about_content),(current_setting('test.read_counts')::jsonb->>'about')::bigint,
 'The owner still reads every About-copy row');
select is((select count(*) from public.email_templates),(current_setting('test.read_counts')::jsonb->>'emails')::bigint,
 'The owner still reads every email template');
select is((select count(*) from public.site_settings),(current_setting('test.read_counts')::jsonb->>'settings')::bigint,
 'The owner still reads CMS settings as well as cancellation enforcement');

select throws_ok($$insert into public.site_content(key,lang,value) values('hours','sv','Bypass')$$,
 '42501',null,'Owner REST cannot insert site copy');
select throws_ok($$update public.site_content set value='Bypass' where key='kicker' and lang='sv'$$,
 '42501',null,'Owner REST cannot update site copy');
select throws_ok($$delete from public.site_content where key='kicker' and lang='sv'$$,
 '42501',null,'Owner REST cannot delete site copy');
select throws_ok($$insert into public.site_content(key,lang,value) values('kicker','sv','Bypass')
 on conflict(key,lang) do update set value=excluded.value$$,
 '42501',null,'Owner REST cannot upsert site copy');
select throws_ok($$insert into public.about_content(key,lang,value) values('intro','sv','Bypass')$$,
 '42501',null,'Owner REST cannot insert About copy');
select throws_ok($$update public.about_content set value='Bypass' where key='intro' and lang='sv'$$,
 '42501',null,'Owner REST cannot update About copy');
select throws_ok($$delete from public.about_content where key='intro' and lang='sv'$$,
 '42501',null,'Owner REST cannot delete About copy');
select throws_ok($$insert into public.about_content(key,lang,value) values('intro','sv','Bypass')
 on conflict(key,lang) do update set value=excluded.value$$,
 '42501',null,'Owner REST cannot upsert About copy');
select throws_ok($$insert into public.email_templates(template,lang,subject,preheader,title,intro,note,cta_label)
 values('customer_confirmation','sv','Bypass','Preheader','Title','Intro','Note','Open')$$,
 '42501',null,'Owner REST cannot insert email copy');
select throws_ok($$update public.email_templates set subject='Bypass' where template='customer_confirmation' and lang='sv'$$,
 '42501',null,'Owner REST cannot update email copy');
select throws_ok($$delete from public.email_templates where template='customer_confirmation' and lang='sv'$$,
 '42501',null,'Owner REST cannot delete email copy');
select throws_ok($$insert into public.email_templates(template,lang,subject,preheader,title,intro,note,cta_label)
 values('customer_confirmation','sv','Bypass','Preheader','Title','Intro','Note','Open')
 on conflict(template,lang) do update set subject=excluded.subject$$,
 '42501',null,'Owner REST cannot upsert email copy');

select throws_ok($$insert into public.site_settings(key,value) values('test_setting','Bypass')$$,
 '42501',null,'Owner REST cannot insert a non-operational setting');
select lives_ok($$update public.site_settings set value='Bypass' where key='business_name'$$,
 'The CMS-setting update is filtered by RLS');
select is((select value from public.site_settings where key='business_name'),current_setting('test.business_before'),
 'Owner REST cannot update an existing CMS setting');
select lives_ok($$delete from public.site_settings where key='business_name'$$,
 'The CMS-setting delete is filtered by RLS');
select is((select value from public.site_settings where key='business_name'),current_setting('test.business_before'),
 'Owner REST cannot delete a CMS setting');
select throws_ok($$insert into public.site_settings(key,value) values('business_name','Bypass')
 on conflict(key) do update set value=excluded.value$$,
 '42501',null,'Owner REST cannot upsert a CMS setting');
select throws_ok($$update public.site_settings set key='test_escape' where key='cancellation_policy_hours'$$,
 '42501',null,'UPDATE WITH CHECK prevents renaming cancellation enforcement into a CMS key');
select lives_ok($$update public.site_settings set key='cancellation_policy_hours' where key='business_name'$$,
 'A CMS-key rename is filtered before it can target cancellation enforcement');
select is((select value from public.site_settings where key='business_name'),current_setting('test.business_before'),
 'UPDATE USING preserves the CMS row during a key-rename attempt');
select throws_ok($$insert into public.site_settings(key,value) values('cancellation_policy_hours','48')
 on conflict(key) do update set key='test_escape',value=excluded.value$$,
 '42501',null,'An allowed insert key cannot escape its scope through ON CONFLICT UPDATE');
select throws_ok($$insert into public.site_settings(key,value) values
 ('cancellation_policy_hours','48'),('business_name','Bypass')
 on conflict(key) do update set value=excluded.value$$,
 '42501',null,'A mixed operational/CMS upsert fails atomically');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'24',
 'The rejected mixed upsert did not partially change cancellation enforcement');

select lives_ok($$update public.site_settings set value='48' where key='cancellation_policy_hours'$$,
 'The owner can update cancellation enforcement');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'48',
 'The allowed cancellation update persisted');
select lives_ok($$delete from public.site_settings where key='cancellation_policy_hours'$$,
 'The owner can delete only the operational cancellation setting');
select is((select count(*) from public.site_settings where key='cancellation_policy_hours'),0::bigint,
 'The allowed cancellation delete persisted');
select lives_ok($$insert into public.site_settings(key,value) values('cancellation_policy_hours','72')$$,
 'The owner can insert cancellation enforcement');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'72',
 'The allowed cancellation insert persisted');
select lives_ok($$insert into public.site_settings(key,value) values('cancellation_policy_hours','96')
 on conflict(key) do update set value=excluded.value$$,
 'The Settings adapter can upsert cancellation enforcement');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'96',
 'The allowed cancellation upsert persisted');
select throws_ok($$update public.site_settings set value='0' where key='cancellation_policy_hours'$$,
 '22023',null,'Cancellation enforcement retains its authoritative value validation');
reset role;
select is(public.internal_cms_state('70000000-0000-4000-8000-000000000001')->>'fingerprint',
 current_setting('test.cms_before')::jsonb->>'fingerprint',
 'Rejected content writes and allowed cancellation changes preserve the CMS fingerprint');
select is(public.internal_cms_state('70000000-0000-4000-8000-000000000001')->>'revision',
 current_setting('test.cms_before')::jsonb->>'revision','Operational changes do not advance a CMS revision');

set local role anon;
select is((select count(*) from public.site_content),(current_setting('test.read_counts')::jsonb->>'site')::bigint,
 'Anonymous site-copy reads are preserved');
select is((select count(*) from public.about_content),(current_setting('test.read_counts')::jsonb->>'about')::bigint,
 'Anonymous About-copy reads are preserved');
select is((select count(*) from public.site_settings),(current_setting('test.read_counts')::jsonb->>'settings')::bigint,
 'Anonymous settings reads are preserved');
select throws_ok($$select * from public.email_templates$$,'42501',null,
 'Anonymous callers still cannot read email templates');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.site_content),(current_setting('test.read_counts')::jsonb->>'site')::bigint,
 'Barber site-copy reads are preserved');
select is((select count(*) from public.about_content),(current_setting('test.read_counts')::jsonb->>'about')::bigint,
 'Barber About-copy reads are preserved');
select is((select count(*) from public.site_settings),(current_setting('test.read_counts')::jsonb->>'settings')::bigint,
 'Barber settings reads are preserved');
select is((select count(*) from public.email_templates),0::bigint,'Email template rows remain owner-only');
select lives_ok($$update public.site_settings set value='48' where key='cancellation_policy_hours'$$,
 'A barber cancellation update is filtered by RLS');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'96',
 'A barber cannot update cancellation enforcement');
select lives_ok($$delete from public.site_settings where key='cancellation_policy_hours'$$,
 'A barber cancellation delete is filtered by RLS');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'96',
 'A barber cannot delete cancellation enforcement');
select throws_ok($$insert into public.site_settings(key,value) values('cancellation_policy_hours','48')$$,
 '42501',null,'A barber cannot insert cancellation enforcement');
select throws_ok($$insert into public.site_settings(key,value) values('cancellation_policy_hours','48')
 on conflict(key) do update set value=excluded.value$$,
 '42501',null,'A barber cannot upsert cancellation enforcement');
reset role;

-- The existing SECURITY DEFINER writer retains authority over every content table and CMS key.
select set_config('test.cms_draft',jsonb_set(jsonb_set(jsonb_set(jsonb_set(
 current_setting('test.cms_before')::jsonb->'document',
 '{site,kicker,sv}','"Publicerat genom CMS"'),
 '{about,intro,sv}','"CMS intro"'),
 '{settings}',(current_setting('test.cms_before')::jsonb->'document'->'settings') ||
   jsonb_build_object('business_name','CMS Studio','business_phone_display','','business_phone_tel','','business_maps_href','')),
 '{emails}',(select jsonb_agg(case when e.value->>'template'='customer_confirmation' and e.value->>'lang'='sv'
   then e.value || jsonb_build_object('subject','CMS confirmation') else e.value end order by e.ordinality)
   from jsonb_array_elements(current_setting('test.cms_before')::jsonb->'document'->'emails')
     with ordinality e(value,ordinality)))::text,true);
set local role service_role;
select lives_ok($$select public.internal_cms_publish('70000000-0000-4000-8000-000000000001',
 current_setting('test.cms_draft')::jsonb,(current_setting('test.cms_before')::jsonb->>'revision')::bigint,
 current_setting('test.cms_before')::jsonb->>'fingerprint','70000000-0000-4000-8000-000000000003')$$,
 'The service-role CMS gateway can still publish the validated owner draft');
select is(public.email_template_for_delivery('customer_confirmation','sv')->>'subject','CMS confirmation',
 'Service-role email delivery still reads the published template');
reset role;
select is((select value from public.site_content where key='kicker' and lang='sv'),'Publicerat genom CMS',
 'CMS publication writes public site copy');
select is((select value from public.about_content where key='intro' and lang='sv'),'CMS intro',
 'CMS publication writes About copy');
select is((select subject from public.email_templates where template='customer_confirmation' and lang='sv'),
 'CMS confirmation','CMS publication writes email copy');
select is((select value from public.site_settings where key='business_name'),'CMS Studio',
 'CMS publication writes business settings');
select is((select count(*) from public.site_settings
 where key in ('business_phone_display','business_phone_tel','business_maps_href') and value=''),3::bigint,
 'CMS publication can still omit phone and maps contacts');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'96',
 'CMS publication preserves current operational cancellation enforcement');
select is((select revision from public.cms_site where id),
 (current_setting('test.cms_before')::jsonb->>'revision')::bigint+1,'Publication advances exactly one revision');
select throws_ok($$select public.internal_cms_publish('70000000-0000-4000-8000-000000000001',
 current_setting('test.cms_draft')::jsonb,(current_setting('test.cms_before')::jsonb->>'revision')::bigint,
 current_setting('test.cms_before')::jsonb->>'fingerprint','70000000-0000-4000-8000-000000000004')$$,
 'PT409',null,'A stale CMS draft still fails the revision/fingerprint compare-and-swap');

select * from finish();
rollback;
