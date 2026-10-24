begin;
select no_plan();

insert into auth.users(id,email) values
 ('97000000-0000-4000-8000-000000000001','cms-conflict-owner@example.invalid');
insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values
 ('97000000-0000-4000-8000-000000000001','owner',null,true,false);

insert into public.cms_assets(id,bucket,path,name,mime,bytes,archived) values
 ('97000000-0000-4000-8000-0000000000a1','cms-library','images/it-shifted.webp','skiftad.webp','image/webp',100,false),
 ('97000000-0000-4000-8000-0000000000a2','cms-library','images/it-active.webp','aktiv.webp','image/webp',100,false),
 ('97000000-0000-4000-8000-0000000000a3','gallery','salon/it-row.webp','galleri.webp','image/webp',100,false),
 ('97000000-0000-4000-8000-0000000000a4','cms-library','images/it-unknown.webp','okand.webp','image/webp',100,true),
 ('97000000-0000-4000-8000-0000000000a5','cms-library','images/it-trashed.webp','slangd.webp','image/webp',100,true);
update public.cms_assets set trashed_at=now() where id='97000000-0000-4000-8000-0000000000a5';

create function pg_temp.head() returns jsonb language sql as $$
  select public.internal_cms_state('97000000-0000-4000-8000-000000000001')->'document'
$$;
create function pg_temp.publish(p_document jsonb, p_request uuid default gen_random_uuid()) returns jsonb language sql as $$
  select public.internal_cms_publish('97000000-0000-4000-8000-000000000001',p_document,
    (s.value->>'revision')::bigint,s.value->>'fingerprint',p_request)
  from (select public.internal_cms_state('97000000-0000-4000-8000-000000000001') as value) s
$$;
create function pg_temp.image(p_path text) returns text language sql as $$
  select '<img src="http://127.0.0.1:54321/storage/v1/object/public/' || p_path || '">'
$$;
create function pg_temp.with_page(p_document jsonb, p_id text, p_html text) returns jsonb language sql as $$
  select jsonb_set(p_document,'{presentation,pages}',
    coalesce((select jsonb_agg(page) from jsonb_array_elements(p_document#>'{presentation,pages}') page where page->>'id'<>p_id),'[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('id',p_id,'kind','page','path','/it-'||left(p_id,8),'inMenu',false,
      'name',jsonb_build_object('sv','Test','en','Test'),'title',jsonb_build_object('sv','Test','en','Test'),
      'description',jsonb_build_object('sv','','en',''),
      'content',jsonb_build_object(
        'sv',jsonb_build_object('html','<main>'||p_html||'</main>','css',jsonb_build_object('light','','dark','')),
        'en',jsonb_build_object('html','<main>'||p_html||'</main>','css',jsonb_build_object('light','','dark',''))))))
$$;

-- The head shows `skiftad` in markup and on a structured key, and `galleri` only as a gallery row.
select lives_ok($$select pg_temp.publish(
  jsonb_set(jsonb_set(
    pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000001',pg_temp.image('cms-library/images/it-shifted.webp')),
    '{presentation,images,it.hero}','{"ref":{"bucket":"cms-library","path":"images/it-shifted.webp"},"alt":{"sv":"","en":""}}'),
    '{gallery}',(pg_temp.head()->'gallery') || '[{"id":"a0000000-0000-4000-8000-0000000000c1","kind":"salon","storage_path":"salon/it-row.webp","alt":"","sort_order":900}]'))$$,
  'Fixture head publishes with active media');
update public.cms_assets set archived=true where id in ('97000000-0000-4000-8000-0000000000a1','97000000-0000-4000-8000-0000000000a3');

select lives_ok($$select pg_temp.publish(pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000001',
  pg_temp.image('cms-library/images/it-active.webp') || pg_temp.image('cms-library/images/it-shifted.webp')))$$,
  'An archived markup image whose ordinal shifted is not a new placement');
select lives_ok($$select pg_temp.publish(pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000002',
  pg_temp.image('cms-library/images/it-shifted.webp')))$$,
  'A duplicated page may repeat archived images the head already shows');
select lives_ok($$select pg_temp.publish(pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000002',
  pg_temp.image('gallery/salon/it-row.webp')))$$,
  'Markup may show an archived image the head references only as a gallery row');
select throws_ok($$select pg_temp.publish(pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000002',
  pg_temp.image('cms-library/images/it-unknown.webp')))$$,
  'PT422','Bilden okand.webp är arkiverad och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
  'An archived image the head never references is rejected in Swedish, naming the file');
select throws_ok($$select pg_temp.publish(pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000002',
  pg_temp.image('cms-library/images/it-trashed.webp')))$$,
  'PT422','Bilden slangd.webp ligger i papperskorgen och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
  'A trashed image is named as being in the trash');
select throws_ok($$select pg_temp.publish(pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000002',
  pg_temp.image('cms-library/images/it-missing.webp')))$$,
  'PT422','Filen images/it-missing.webp finns inte i biblioteket. Välj den på nytt under Resurser.',
  'An unregistered new reference is still rejected');
select lives_ok($$select pg_temp.publish(pg_temp.head())$$,
  'An archived image may stay on its existing structured key');
select throws_ok($$select pg_temp.publish(
  jsonb_set(pg_temp.head() #- '{presentation,images,it.hero}','{presentation,images,it.moved}',pg_temp.head()#>'{presentation,images,it.hero}'))$$,
  'PT422','Bilden skiftad.webp är arkiverad och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
  'The same archived image moved to a new structured key is rejected');

-- Validation applies the identical rule without publishing.
select throws_ok($$select public.internal_cms_check_media(null,pg_temp.head())$$,'42501',null,
  'Media validation requires the CMS owner');
select lives_ok($$select public.internal_cms_check_media('97000000-0000-4000-8000-000000000001',pg_temp.head())$$,
  'Validation accepts the head as it is');
select throws_ok($$select public.internal_cms_check_media('97000000-0000-4000-8000-000000000001',
  pg_temp.with_page(pg_temp.head(),'a0000000-0000-4000-8000-000000000002',pg_temp.image('cms-library/images/it-unknown.webp')))$$,
  'PT422','Bilden okand.webp är arkiverad och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
  'Validation rejects what publication rejects');
select ok(has_function_privilege('service_role','public.internal_cms_check_media(uuid,jsonb)','execute'),
  'cms-studio may run media validation');
select ok(not has_function_privilege('authenticated','public.internal_cms_check_media(uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.internal_cms_check_media(uuid,jsonb)','execute'),
  'Browsers cannot call media validation directly');
select ok(not has_function_privilege('service_role','public.internal_cms_newly_placed_media(jsonb,jsonb)','execute')
  and not has_function_privilege('service_role','public.internal_cms_assert_media_publishable(jsonb,jsonb)','execute'),
  'The rule helpers are internal');

-- Every optimistic-concurrency conflict is PT409, which PostgREST answers without retrying.
select throws_ok($$select public.internal_cms_publish('97000000-0000-4000-8000-000000000001',pg_temp.head(),0,md5('stale'),gen_random_uuid())$$,
  'PT409',null,'A stale base raises PT409');
select throws_ok($$select public.internal_cms_publish_unchecked('97000000-0000-4000-8000-000000000001',pg_temp.head(),0,md5('stale'),gen_random_uuid())$$,
  'PT409',null,'The unchecked writer raises PT409 for a stale base');
select throws_ok($$select pg_temp.publish(jsonb_set(pg_temp.head(),'{barbers}','[]'))$$,
  'PT409',null,'A staff membership change raises PT409');
select throws_ok($$select public.internal_cms_asset_update('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-0000000000a2',99,'x','',false)$$,
  'PT409',null,'Stale asset metadata raises PT409');
select throws_ok($$select public.internal_cms_asset_transition('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-0000000000a2',99,'archive')$$,
  'PT409',null,'A stale asset lifecycle version raises PT409');
select throws_ok($$select public.internal_cms_asset_delete_abort('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-0000000000a2',0)$$,
  'PT409',null,'Aborting a deletion that holds no claim raises PT409');
select throws_ok($$select public.internal_cms_asset_delete_finalize('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-0000000000a2',0)$$,
  'PT409',null,'Finalizing a deletion that holds no claim raises PT409');

-- A revision stores one document copy; the request is identified by its fingerprint.
select hasnt_column('public','cms_revisions','request_document','Revisions no longer keep the request document');
create temporary table it_request as select pg_temp.head() as document, gen_random_uuid() as id;
create temporary table it_result as select pg_temp.publish(r.document,r.id) as value from it_request r;
select is((select request_fingerprint from public.cms_revisions c join it_request r on c.request_id=r.id),
  (select md5(document::text) from it_request),'The request fingerprint is md5 of the canonical request');
select is((select pg_temp.publish(r.document,r.id) from it_request r),(select value from it_result),
  'The same request identity and document replay the committed revision');
select throws_ok($$select pg_temp.publish(jsonb_set(r.document,'{settings,business_name}','"Annat"'),r.id) from it_request r$$,
  '22023',null,'The same request identity with a different document is rejected');

select * from finish();
rollback;
