begin;
select plan(50);

insert into auth.users(id,email) values
 ('96000000-0000-4000-8000-000000000001','cms-single-pass-owner@example.invalid');
insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values
 ('96000000-0000-4000-8000-000000000001','owner',null,true,false);

insert into public.cms_assets(id,bucket,path,name,mime,bytes,archived) values
 ('96000000-0000-4000-8000-0000000000a1','cms-library','images/single-pass-kept.webp','behallen.webp','image/webp',100,false),
 ('96000000-0000-4000-8000-0000000000a2','cms-library','images/single-pass-new.webp','ny.webp','image/webp',100,true),
 ('96000000-0000-4000-8000-0000000000a3','cms-library','images/retention-old.webp','gammal.webp','image/webp',100,false),
 ('96000000-0000-4000-8000-0000000000a4','cms-library','images/retention-head.webp','aktuell.webp','image/webp',100,false);

create function pg_temp.state() returns jsonb language sql as $$
  select public.internal_cms_state('96000000-0000-4000-8000-000000000001')
$$;
create function pg_temp.publish(p_document jsonb, p_request uuid default gen_random_uuid()) returns jsonb language sql as $$
  select public.internal_cms_publish('96000000-0000-4000-8000-000000000001',p_document,
    (s.value->>'revision')::bigint,s.value->>'fingerprint',p_request)
  from (select pg_temp.state() as value) s
$$;
create function pg_temp.with_image(p_document jsonb, p_key text, p_path text) returns jsonb language sql as $$
  select jsonb_set(p_document,array['presentation','images',p_key],
    jsonb_build_object('ref',jsonb_build_object('bucket','cms-library','path',p_path),'alt',jsonb_build_object('sv','','en','')))
$$;
create function pg_temp.with_gallery_row(p_document jsonb, p_id text, p_path text) returns jsonb language sql as $$
  select jsonb_set(p_document,'{gallery}',(p_document->'gallery') || jsonb_build_array(
    jsonb_build_object('id',p_id,'kind','salon','storage_path',p_path,'alt','','sort_order',900)))
$$;
create function pg_temp.without_gallery_row(p_document jsonb, p_id text) returns jsonb language sql as $$
  select jsonb_set(p_document,'{gallery}',coalesce((select jsonb_agg(row_data)
    from jsonb_array_elements(p_document->'gallery') row_data where row_data->>'id'<>p_id),'[]'::jsonb))
$$;
create function pg_temp.document_builds() returns bigint language sql as $$
  select coalesce((select calls from pg_stat_xact_user_functions
    where schemaname='public' and funcname='internal_cms_document'),0)
$$;
create function pg_temp.storage_deletions() returns bigint language sql as $$
  select count(*) from public.external_action_jobs where action_type='storage_object_delete'
$$;
create function pg_temp.with_markup(p_document jsonb, p_html text) returns jsonb language sql as $$
  select jsonb_set(p_document,'{presentation,legacyMarkup}',to_jsonb(p_html))
$$;

-- One publication function: the lifecycle wrapper and the unchecked writer are merged.
select hasnt_function('public','internal_cms_publish_unchecked',array['uuid','jsonb','bigint','text','uuid'],
  'The unchecked writer is merged into internal_cms_publish');
select ok(has_function_privilege('service_role','public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)','execute'),
  'cms-studio may still publish');
select ok(not has_function_privilege('authenticated','public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)','execute')
  and not has_function_privilege('anon','public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)','execute'),
  'Browsers cannot publish directly');
select is(obj_description('public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)'::regprocedure,'pg_proc'),
  'Publishes a validated CMS document while serializing asset lifecycle changes. Archived media may stay on structured keys the authoritative head already uses and in markup when the head references the asset anywhere; any other placement requires an active asset.',
  'The publication keeps its documented archived-media contract');

-- The head document is built once before the writes and once after them.
set local track_functions='all';
create temporary table single_pass_base as select pg_temp.state() as value;
select set_config('test.builds',pg_temp.document_builds()::text,true);
create temporary table single_pass_result as
  select public.internal_cms_publish('96000000-0000-4000-8000-000000000001',
    pg_temp.with_image(b.value->'document','single.kept','images/single-pass-kept.webp'),
    (b.value->>'revision')::bigint,b.value->>'fingerprint','96000000-0000-4000-8000-0000000000f1') as value
  from single_pass_base b;
select is(pg_temp.document_builds()-current_setting('test.builds')::bigint,2::bigint,
  'A publication builds the head document once before and once after its writes');
select is((select jsonb_build_object('revision',r.value->'revision','fingerprint',r.value->'fingerprint','document',r.value->'document')
    from single_pass_result r),
  (select jsonb_build_object('revision',s.value->'revision','fingerprint',s.value->'fingerprint','document',s.value->'document')
    from (select pg_temp.state() as value) s),
  'The publication returns the new state the studio would read next');
select is((select value->>'requestId' from single_pass_result),'96000000-0000-4000-8000-0000000000f1',
  'The publication echoes its request identity');

-- The merged function keeps the wrapper's order: replay, stale base, archived-media rule, staff membership.
select lives_ok($$select pg_temp.publish(pg_temp.state()->'document' #- '{presentation,images,single.kept}')$$,
  'The head drops the image the replayed request placed');
update public.cms_assets set archived=true where id='96000000-0000-4000-8000-0000000000a1';
select set_config('test.builds',pg_temp.document_builds()::text,true);
select is((select public.internal_cms_publish('96000000-0000-4000-8000-000000000001',
    pg_temp.with_image(b.value->'document','single.kept','images/single-pass-kept.webp'),
    (b.value->>'revision')::bigint,b.value->>'fingerprint','96000000-0000-4000-8000-0000000000f1') from single_pass_base b),
  (select value from single_pass_result),
  'An exact replay returns the committed revision although its image was archived since and the head no longer shows it');
select is(pg_temp.document_builds()-current_setting('test.builds')::bigint,0::bigint,
  'A replay builds no document');
select throws_ok($$select public.internal_cms_publish('96000000-0000-4000-8000-000000000001',
    pg_temp.with_image(pg_temp.state()->'document','single.new','images/single-pass-new.webp'),0,md5('stale'),gen_random_uuid())$$,
  'PT409',null,'A stale base is answered before the archived-media rule');
select throws_ok($$select pg_temp.publish(jsonb_set(
    pg_temp.with_image(pg_temp.state()->'document','single.new','images/single-pass-new.webp'),'{barbers}','[]'))$$,
  'PT422','Bilden ny.webp är arkiverad och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
  'The archived-media rule is answered before the staff membership check');

-- Revision retention: a daily job deletes revisions older than 30 days, never the head.
select has_function('public','prune_cms_revisions',array[]::text[],'Revisions have a retention function');
insert into storage.objects(bucket_id,name,created_at) values
 ('gallery','salon/legacy old only.webp',now()-interval '60 days'),
 ('gallery','salon/legacy head.webp',now()-interval '60 days'),
 ('gallery','salon/legacy markup.webp',now()-interval '60 days');
select is((select count(*)::int from public.cms_assets
    where path in ('salon/legacy old only.webp','salon/legacy head.webp','salon/legacy markup.webp')),0,
  'precondition: the legacy files are not registered library assets');
select lives_ok($$select pg_temp.publish(pg_temp.with_gallery_row(
    pg_temp.with_image(pg_temp.state()->'document','retention.old','images/retention-old.webp'),
    '96000000-0000-4000-8000-0000000000c1','salon/legacy old only.webp'))$$,
  'An old revision shows a library image and a legacy gallery file');
create temporary table retention_old as select revision from public.cms_site where id;
select lives_ok($$select pg_temp.publish(pg_temp.without_gallery_row(
    pg_temp.state()->'document' #- '{presentation,images,retention.old}','96000000-0000-4000-8000-0000000000c1'))$$,
  'A younger revision no longer shows them');
create temporary table retention_young as select revision from public.cms_site where id;
select lives_ok($$select pg_temp.publish(pg_temp.with_markup(pg_temp.with_gallery_row(
    pg_temp.with_image(pg_temp.state()->'document','retention.head','images/retention-head.webp'),
    '96000000-0000-4000-8000-0000000000c2','salon/legacy head.webp'),
    '<img src="/storage/v1/object/public/gallery/salon/legacy markup.webp">'))$$,
  'The head shows another library image, a legacy gallery file and a legacy file only in markup');
create temporary table retention_head as select revision from public.cms_site where id;

update public.cms_revisions set created_at=now()-interval '60 days' where revision<(select revision from retention_old);
update public.cms_revisions set created_at=now()-interval '30 days 1 minute' where revision=(select revision from retention_old);
update public.cms_revisions set created_at=now()-interval '30 days' where revision=(select revision from retention_young);
update public.cms_revisions set created_at=now()-interval '45 days' where revision=(select revision from retention_head);
insert into public.cms_revisions(revision,created_at,document,fingerprint,summary)
select revision+1000,now()-interval '90 days','{}','newest-test','Newest revision' from retention_head;
select set_config('test.storage_deletions',pg_temp.storage_deletions()::text,true);
select set_config('test.expected_pruned',(select count(*) from public.cms_revisions
  where revision<=(select revision from retention_old))::text,true);
select ok(public.internal_cms_media_retained('gallery','salon/legacy old only.webp'),
  'precondition: an old revision retains its unregistered legacy file');

select is(public.prune_cms_revisions(),current_setting('test.expected_pruned')::integer,
  'The prune reports every revision it deleted');
select ok(not exists(select 1 from public.cms_revisions where revision<=(select revision from retention_old)),
  'Every revision older than 30 days is deleted, one that is 30 days and 1 minute old included');
select ok(exists(select 1 from public.cms_revisions where revision=(select revision from retention_young)),
  'A revision exactly 30 days old survives');
select ok(exists(select 1 from public.cms_revisions r join public.cms_site s on s.id and r.revision=s.revision),
  'The head, which is the published revision, survives although older than 30 days');
select ok(exists(select 1 from public.cms_revisions where revision=(select revision+1000 from retention_head)),
  'The newest revision survives although older than 30 days');
select is((select count(*)::int from public.cms_revision_media where revision<=(select revision from retention_old)),0,
  'Pruned revisions leave no media index rows');
select is(pg_temp.storage_deletions(),current_setting('test.storage_deletions')::bigint,
  'Pruning queues no Storage deletion');
-- The reconciler reads no revision, so it may queue a file the head shows only in markup: queueing
-- can happen, deletion cannot, because the dispatch deletes only bytes internal_cms_media_retained releases.
select ok(not exists(select 1 from public.gallery_images where storage_path='salon/legacy markup.webp'),
  'precondition: no gallery row keeps the file the head shows only in markup');
create temporary table reconcile_run as select public.queue_orphaned_storage_objects() as queued;
select is((select count(*)::int from public.external_action_jobs
    where action_type='storage_object_delete' and dedupe_key='gallery:salon/legacy markup.webp'),1,
  'The nightly reconcile queues the unregistered file the head shows only in markup');
select ok(public.internal_cms_media_retained('gallery','salon/legacy markup.webp'),
  'After the prune the dispatch retention check still keeps the file the head shows only in markup, so its bytes are not removed');
select ok((select bool_and(public.internal_cms_media_retained(m.bucket,m.path)) from public.cms_revision_media m
    where m.revision=(select revision from retention_head)),
  'Every file the head references stays retained');
select ok(public.internal_cms_media_retained('gallery','salon/legacy head.webp'),
  'An unregistered legacy file the head shows stays retained');
select ok(not public.internal_cms_media_retained('gallery','salon/legacy old only.webp'),
  'A legacy file that only pruned revisions showed is released to the daily reconciler');
select is((public.internal_cms_asset_usage('96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-0000000000a3')->>'historyReferences')::int,0,
  'A library image that only pruned revisions showed keeps no history reference');
select is(public.prune_cms_revisions(),0,'A second prune deletes nothing');

-- The retention check finds a path only as a raw substring. While the head spells a storage path
-- percent-encoded, CSS-escaped or with an HTML character reference, nothing is pruned.
insert into storage.objects(bucket_id,name,created_at) values
 ('gallery','salon/legacy encoded.webp',now()-interval '60 days');
select lives_ok($$select pg_temp.publish(pg_temp.with_gallery_row(pg_temp.state()->'document',
    '96000000-0000-4000-8000-0000000000c3','salon/legacy encoded.webp'))$$,
  'An old revision pins a legacy file by its raw path');
create temporary table retention_pin as select revision from public.cms_site where id;
select lives_ok($$select pg_temp.publish(pg_temp.with_markup(pg_temp.without_gallery_row(pg_temp.state()->'document',
    '96000000-0000-4000-8000-0000000000c3'),
    '<a href="/storage/v1/object/public/gallery/%73alon/legacy%20encoded.webp">'))$$,
  'The head links the same file only percent-encoded');
update public.cms_revisions set created_at=now()-interval '31 days' where revision=(select revision from retention_pin);
select is(public.prune_cms_revisions(),0,'The prune deletes nothing while the head spells a storage path encoded');
select ok(exists(select 1 from public.cms_revisions where revision=(select revision from retention_pin)),
  'The old revision that pins the raw path survives');
select ok(public.internal_cms_media_retained('gallery','salon/legacy encoded.webp'),
  'The file the head links encoded stays retained, so the dispatch cannot delete it');
select lives_ok($$select pg_temp.publish(pg_temp.with_markup(pg_temp.state()->'document',
    '<a href="/storage/v1/object/public/%67allery/%73alon/legacy%20encoded.webp">'))$$,
  'The head links the file with its bucket percent-encoded too');
select is(public.prune_cms_revisions(),0,'The prune deletes nothing while the head spells the bucket encoded');
select lives_ok($$select pg_temp.publish(pg_temp.with_gallery_row(pg_temp.with_markup(pg_temp.state()->'document',''),
    '96000000-0000-4000-8000-0000000000c3','salon/legacy encoded.webp'))$$,
  'The head shows the file by its raw path again');
select set_config('test.expected_pruned',(select count(*) from public.cms_revisions r
  where r.created_at<now()-interval '30 days'
    and r.revision<>(select s.revision from public.cms_site s where s.id)
    and r.revision<>(select max(n.revision) from public.cms_revisions n))::text,true);
select is(public.prune_cms_revisions(),current_setting('test.expected_pruned')::integer,
  'Once the head spells every storage path raw, the prune deletes again');
select ok(not exists(select 1 from public.cms_revisions where revision=(select revision from retention_pin)),
  'The old revision that pinned the raw path is deleted then');
select ok(public.internal_cms_media_retained('gallery','salon/legacy encoded.webp'),
  'The head keeps the file once it shows the raw path');
select ok((select p.prosecdef and p.proconfig=array['search_path=""'] from pg_proc p
    where p.oid='public.prune_cms_revisions()'::regprocedure),
  'The prune runs as its owner with an empty search_path');
select ok(not has_function_privilege('service_role','public.prune_cms_revisions()','execute')
  and not has_function_privilege('authenticated','public.prune_cms_revisions()','execute')
  and not has_function_privilege('anon','public.prune_cms_revisions()','execute'),
  'Only the cron owner can prune revisions');

-- One daily job, scheduled idempotently.
select is((select array_agg(j.jobname || ' ' || j.schedule || ' ' || j.command) from cron.job j
    where j.command ilike '%prune_cms_revisions%'),
  array['cms-revision-prune 37 3 * * * select public.prune_cms_revisions()'],
  'One daily cron job prunes CMS revisions');
select set_config('test.cron_before',(select j.schedule || ' ' || j.command from cron.job j
  where j.jobname='cms-revision-prune'),true);
do $$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'cms-revision-prune') then
      perform cron.unschedule('cms-revision-prune');
    end if;
    perform cron.schedule('cms-revision-prune','37 3 * * *','select public.prune_cms_revisions()');
  end loop;
end;
$$;
select is((select count(*)::int from cron.job where jobname='cms-revision-prune'),1,
  'The prune job exists exactly once after re-running its scheduling block twice');
select is((select j.schedule || ' ' || j.command from cron.job j where j.jobname='cms-revision-prune'),
  current_setting('test.cron_before'),'The re-run block schedules exactly what the migration scheduled');
select ok(not exists(select 1 from cron.job j
    where j.jobname<>'cms-revision-prune' and j.schedule='37 3 * * *'),
  'The prune job runs at a minute no other job uses');

select * from finish();
rollback;
