begin;
select no_plan();
-- A clean installation may intentionally contain no CMS overrides yet.
insert into public.site_content(key,lang,value) values
 ('kicker','sv','Ursprunglig text'),('kicker','en','Original text'),
 ('hours','sv','Öppet enligt bokning'),('hours','en','Open by appointment')
on conflict(key,lang) do update set value=excluded.value;

insert into auth.users(id,email) values
 ('99000000-0000-4000-8000-000000000001','cms-owner@example.invalid'),
 ('99000000-0000-4000-8000-000000000002','cms-barber@example.invalid'),
 ('99000000-0000-4000-8000-000000000003','cms-disabled@example.invalid'),
 ('99000000-0000-4000-8000-000000000004','cms-forced@example.invalid');
insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values
 ('99000000-0000-4000-8000-000000000001','owner',null,true,false),
 ('99000000-0000-4000-8000-000000000002','barber','victor',true,false),
 ('99000000-0000-4000-8000-000000000003','owner',null,false,false),
 ('99000000-0000-4000-8000-000000000004','owner',null,true,true);

select ok((select relrowsecurity from pg_class where oid='public.cms_site'::regclass),'CMS presentation has RLS');
select ok((select relrowsecurity from pg_class where oid='public.cms_revisions'::regclass),'CMS revisions have RLS');
select ok((select relrowsecurity from pg_class where oid='public.cms_assets'::regclass),'CMS assets have RLS');
select ok((select relrowsecurity from pg_class where oid='public.cms_email_designs'::regclass),'Email designs have RLS');
select throws_ok($$select public.internal_cms_state(null)$$,'42501',null,'Missing owner is rejected');
select throws_ok($$select public.internal_cms_state('99000000-0000-4000-8000-000000000002')$$,'42501',null,'Barber cannot acquire owner state');
select throws_ok($$select public.internal_cms_state('99000000-0000-4000-8000-000000000003')$$,'42501',null,'Disabled owner is rejected');
select throws_ok($$select public.internal_cms_state('99000000-0000-4000-8000-000000000004')$$,'42501',null,'Forced password gate is enforced on the server');

set local role anon;
select lives_ok($$select public.public_cms_presentation()$$,'Anonymous visitors may read only the public projection');
select throws_ok($$select public.internal_cms_state('99000000-0000-4000-8000-000000000001')$$,'42501',null,'Anonymous caller cannot forge a valid owner ID');
select throws_ok($$select * from public.cms_revisions$$,'42501',null,'Anonymous caller cannot read revision identities or drafts');
select throws_ok($$select * from public.cms_assets$$,'42501',null,'Anonymous caller cannot enumerate the owner asset inventory');
select throws_ok($$update public.cms_site set revision=999$$,'42501',null,'Anonymous caller cannot publish a projection directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.internal_cms_state('99000000-0000-4000-8000-000000000001')$$,'42501',null,'Even owner browser sessions must use the validated Edge boundary');
select throws_ok($$update public.cms_site set presentation='{}'$$,'42501',null,'Owner browser cannot bypass content validation');
reset role;

create temporary table cms_test_state as select public.internal_cms_state('99000000-0000-4000-8000-000000000001') as value;
select is((select value->>'revision' from cms_test_state),'0','Initial state is revision zero');
select is((select jsonb_typeof(value->'document'->'barbers') from cms_test_state),'array','Native roster is captured');
select ok((select value->'document'->'site' ? 'kicker' from cms_test_state),'Existing bilingual site copy is captured');
select is((select jsonb_typeof(value->'document'->'emails') from cms_test_state),'array','All stored email templates are captured');
select ok(not ((select value->'document'->'settings' from cms_test_state) ? 'cancellation_policy_hours'),'Cancellation enforcement is not part of the reversible CMS document');
select ok(not exists(select 1 from cms_test_state s cross join lateral jsonb_array_elements(s.value->'document'->'barbers') as b(value) where b.value ? 'active'),'Barber bookability is not part of the reversible CMS document');

create temporary table cms_test_request as select jsonb_set(value->'document','{site,kicker}','{"sv":"Publicerat på svenska","en":"Published in English"}') as document from cms_test_state;
create temporary table cms_test_result as select public.internal_cms_publish(
 '99000000-0000-4000-8000-000000000001',r.document,0,s.value->>'fingerprint','99000000-0000-4000-8000-000000000010') as value from cms_test_request r,cms_test_state s;
select is((select value->>'revision' from cms_test_result),'1','One publication advances exactly one revision');
select is((select value from public.site_content where key='kicker' and lang='sv'),'Publicerat på svenska','Swedish copy reaches the actual public table');
select is((select value from public.site_content where key='kicker' and lang='en'),'Published in English','English copy is published independently');
select is((select count(*)::int from public.cms_revisions),2,'Initial and published snapshots are retained');
select is((select value->>'fingerprint' from cms_test_result),md5(public.internal_cms_document()::text),'Returned fingerprint describes the committed document');
select is((select value->'document' from cms_test_result),public.internal_cms_document(),'Acknowledged document matches all actual persisted tables');
select is((select public.internal_cms_publish('99000000-0000-4000-8000-000000000001',r.document,0,s.value->>'fingerprint','99000000-0000-4000-8000-000000000010') from cms_test_request r,cms_test_state s),(select value from cms_test_result),'An exact request replay returns the original acknowledgement');
select is((select count(*)::int from public.cms_revisions),2,'Replay does not create another revision');
select throws_ok($$select public.internal_cms_publish('99000000-0000-4000-8000-000000000001',jsonb_set(r.document,'{site,kicker,sv}','"Changed payload"'),0,s.value->>'fingerprint','99000000-0000-4000-8000-000000000010') from cms_test_request r,cms_test_state s$$,'22023',null,'Request-ID reuse with different content is rejected');
select throws_ok($$select public.internal_cms_publish('99000000-0000-4000-8000-000000000001',r.document,0,s.value->>'fingerprint','99000000-0000-4000-8000-000000000011') from cms_test_request r,cms_test_state s$$,'40001',null,'A stale tab cannot overwrite a newer publication');

update cms_test_state set value=public.internal_cms_state('99000000-0000-4000-8000-000000000001');
update public.site_content set value='Changed outside the studio' where key='hours' and lang='sv';
select throws_ok($$select public.internal_cms_publish('99000000-0000-4000-8000-000000000001',s.value->'document',1,s.value->>'fingerprint','99000000-0000-4000-8000-000000000012') from cms_test_state s$$,'40001',null,'Edits through old management tools invalidate the content fingerprint');
update cms_test_state set value=public.internal_cms_state('99000000-0000-4000-8000-000000000001');
select throws_ok($$select public.internal_cms_publish('99000000-0000-4000-8000-000000000001',jsonb_set(s.value->'document','{barbers}','[]'),1,s.value->>'fingerprint','99000000-0000-4000-8000-000000000013') from cms_test_state s$$,'40001',null,'Publication cannot remove or resurrect a staff account');
-- Violate an existing content constraint after earlier writes have begun; all writes must roll back.
select throws_ok($$select public.internal_cms_publish('99000000-0000-4000-8000-000000000001',jsonb_set(jsonb_set(s.value->'document','{site,kicker,sv}','"Must roll back"'),'{barbers,0,name}','""'),1,s.value->>'fingerprint','99000000-0000-4000-8000-000000000014') from cms_test_state s$$,null,null,'A late content constraint aborts the whole transaction');
select is((select value from public.site_content where key='kicker' and lang='sv'),'Publicerat på svenska','Earlier copy writes rolled back with the failed transaction');
select is((select revision::int from public.cms_site where id),1,'Failed publication did not advance the head');
select is((select count(*)::int from public.cms_revisions),2,'Failed publication did not retain a partial revision');
select is(public.internal_cms_revision('99000000-0000-4000-8000-000000000001',0)->'document'->'site',(select document->'site' from public.cms_revisions where revision=0),'History preserves the original bilingual copy');
select is(jsonb_array_length(public.internal_cms_history('99000000-0000-4000-8000-000000000001')),2,'History exposes both committed versions');
select is(jsonb_array_length(public.internal_cms_history('99000000-0000-4000-8000-000000000001',1)),1,'History cursor is exclusive');

savepoint cms_operational_boundary;
update public.barbers set active=false where id='victor';
update public.site_settings set value='48' where key='cancellation_policy_hours';
update cms_test_state set value=public.internal_cms_state('99000000-0000-4000-8000-000000000001');

savepoint cms_policy_injection;
select throws_ok(
  $$select public.internal_cms_publish(
    '99000000-0000-4000-8000-000000000001',
    jsonb_set(s.value->'document','{settings,cancellation_policy_hours}','"1"',true),
    (s.value->>'revision')::bigint,s.value->>'fingerprint','99000000-0000-4000-8000-000000000015'
  ) from cms_test_state s$$,
  '22023',null,'Direct CMS publication rejects cancellation enforcement fields'
);
rollback to savepoint cms_policy_injection;

savepoint cms_bookability_injection;
select throws_ok(
  $$select public.internal_cms_publish(
    '99000000-0000-4000-8000-000000000001',
    jsonb_set(s.value->'document','{barbers,0,active}','true',true),
    (s.value->>'revision')::bigint,s.value->>'fingerprint','99000000-0000-4000-8000-000000000016'
  ) from cms_test_state s$$,
  '22023',null,'Direct CMS publication rejects barber bookability fields'
);
rollback to savepoint cms_bookability_injection;

select lives_ok(
  $$select public.internal_cms_publish(
    '99000000-0000-4000-8000-000000000001',
    public.internal_cms_revision('99000000-0000-4000-8000-000000000001',0)->'document',
    (s.value->>'revision')::bigint,s.value->>'fingerprint','99000000-0000-4000-8000-000000000017'
  ) from cms_test_state s$$,
  'Publishing historical presentation content does not require operational fields'
);
select ok(not (select active from public.barbers where id='victor'),'Historical CMS publication preserves current barber bookability');
select is((select value from public.site_settings where key='cancellation_policy_hours'),'48','Historical CMS publication preserves current cancellation enforcement');
select ok(not exists(select 1 from jsonb_array_elements(public.public_business_discovery()->'barbers') as b(value) where b.value->>'id'='victor'),'Historical CMS publication cannot make an inactive barber bookable');
rollback to savepoint cms_operational_boundary;

insert into public.cms_assets(id,bucket,path,name,mime) values('99000000-0000-4000-8000-000000000020','cms-library','test/photo.webp','Photo','image/webp');
select is(public.internal_cms_asset_update('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000020',0,'New name','Useful alt',true)->>'version','1','Asset metadata uses a real version counter');
select throws_ok($$select public.internal_cms_asset_update('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000020',0,'Stale','',false)$$,'40001',null,'A stale metadata editor cannot undo another tab archive');
select ok((select archived from public.cms_assets where id='99000000-0000-4000-8000-000000000020'),'Archive state survives a stale update');
select is(public.public_cms_presentation()->>'revision','1','Public projection exposes the committed head');
select ok(not public.public_cms_presentation() ? 'assets' and not public.public_cms_presentation() ? 'actor_id' and not public.public_cms_presentation() ? 'emails','Public projection does not disclose private editor state');

select * from finish();
rollback;
