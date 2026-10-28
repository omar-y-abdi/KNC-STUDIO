begin;

insert into auth.users(id,email) values
 ('99000000-0000-4000-8000-000000000091','retention-compatibility-owner@example.invalid');
insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values
 ('99000000-0000-4000-8000-000000000091','owner',null,true,false);
insert into public.cms_assets(id,bucket,path,name,mime,bytes,archived) values
 ('99000000-0000-4000-8000-000000000092','cms-library','images/kept.webp','kept.webp','image/webp',100,false);

create function pg_temp.publish(p_document jsonb) returns jsonb language sql as $$
 select public.internal_cms_publish('99000000-0000-4000-8000-000000000091',p_document,
   (s.value->>'revision')::bigint,s.value->>'fingerprint',gen_random_uuid())
 from (select public.internal_cms_state('99000000-0000-4000-8000-000000000091') as value) s
$$;

-- Start each probe with empty rendered sources. Preserve the rest of the authoritative document.
create temporary table draft as
with variant as (
 select jsonb_build_object('html','','css',jsonb_build_object('light','','dark','')) as value
), localized as (
 select jsonb_build_object('sv',value,'en',value) as value from variant
), pages as (
 select jsonb_agg(jsonb_build_object('id',id,'kind','page','path',path,'inMenu',false,
   'name',jsonb_build_object('sv','Probe','en','Probe'),
   'title',jsonb_build_object('sv','Probe','en','Probe'),
   'description',jsonb_build_object('sv','','en',''),'content',localized.value) order by path) as value
 from localized cross join (values
   ('99000000-0000-4000-8000-000000000093','/retention-one'),
   ('99000000-0000-4000-8000-000000000094','/retention-two')
 ) as page(id,path)
), regions as (
 select jsonb_object_agg(name,localized.value) as value from localized
 cross join unnest(array['home-before','home-after','about-before','about-after']) as region(name)
)
select jsonb_set(jsonb_set(public.internal_cms_document(),'{presentation,pages}',pages.value),
 '{presentation,regions}',regions.value) as value from pages,regions;

create temporary table sources(path text[] primary key,label text,canonical text);
insert into sources(path,label)
select array['presentation','pages',page,'content',lang] || field.path,
 'page ' || page || ' / ' || lang || ' / ' || field.label
from unnest(array['0','1']) as page(page)
cross join unnest(array['sv','en']) as lang(lang)
cross join (values (array['html'],'HTML'),(array['css','light'],'light CSS'),
  (array['css','dark'],'dark CSS')) as field(path,label);
insert into sources(path,label)
select array['presentation','regions',region,lang] || field.path,
 'region ' || region || ' / ' || lang || ' / ' || field.label
from unnest(array['home-before','home-after','about-before','about-after']) as region(region)
cross join unnest(array['sv','en']) as lang(lang)
cross join (values (array['html'],'HTML'),(array['css','light'],'light CSS'),
  (array['css','dark'],'dark CSS')) as field(path,label);
update sources set canonical=case when path[array_length(path,1)]='html'
 then '<img src="https://media.example/storage/v1/object/public/cms-library/images/kept.webp" alt="">'
 else '.hero{background-image:url("https://media.example/storage/v1/object/public/cms-library/images/kept.webp")}' end;

create temporary table probes(path text[],canonical text,source text,label text);
-- Every page/language/theme and every supported region is inspected, including a non-first page.
insert into probes
select path,canonical,case when path[array_length(path,1)]='html'
 then replace(canonical,'/v1/','/v1/./') else replace(canonical,'/storage/',$raw$/st\6frage/$raw$) end,
 label from sources;
-- These spellings were accepted by the older Edge validator without rewriting CSS or dot segments.
-- Inspecting actual source strings must cover them even when the literal storage prefix is hidden.
insert into probes
select array['presentation','pages','0','content','sv','css','light'],
 '.hero{background-image:url("https://media.example/storage/v1/object/public/cms-library/images/kept.webp")}',
 '.hero{background-image:url("https://media.example' || path || '")}',label
from (values
 ($raw$/st\orage/v1/object/public/cms-library/images/kept.webp$raw$,'simple CSS escape'),
 ($raw$\2f storage/v1/object/public/cms-library/images/kept.webp$raw$,'CSS hex-escaped slash'),
 ($raw$/storage/v1/object/p\75 blic/cms-library/images/kept.webp$raw$,'CSS escape in public'),
 (E'/st\\\norage/v1/object/public/cms-library/images/kept.webp','CSS line continuation'),
 ('/storage/v1/./object/public/cms-library/images/kept.webp','raw dot in prefix'),
 ('/storage/v1/unused/../object/public/cms-library/images/kept.webp','raw parent in prefix'),
 ('/storage/v1/%2e/object/public/cms-library/images/kept.webp','percent dot in prefix'),
 ('/storage/v1/unused/%2E%2e/object/public/cms-library/images/kept.webp','percent parent in prefix'),
 ('/storage/v1/unused/.%2e/object/public/cms-library/images/kept.webp','mixed dot-percent parent'),
 ('/storage/v1/unused/%2e./object/public/cms-library/images/kept.webp','mixed percent-dot parent'),
 ('/storage/v1/object/public/cms-library/images/./kept.webp','raw dot in path'),
 ('/storage/v1/object/public/cms-library/images/extra/../kept.webp','raw parent in path'),
 ('/storage/v1/object/public/cms-library/images/%2E/kept.webp','percent dot in path'),
 ('/storage/v1/object/public/cms-library/images/extra/%2e%2e/kept.webp','percent parent in path'),
 ('/storage/v1/object/public/cms-library/images/%6bept.webp','existing percent-path guard')
) as spelling(path,label);
insert into probes
select path,canonical,canonical || $css$ .label::after{content:"\2192"}$css$,
 'Harmless authored CSS escapes' from sources
where label='page 0 / sv / light CSS';
insert into probes
select path,canonical,replace(canonical,'kept.webp','kept&apos;s.webp'),
 'Existing HTML entity guard remains' from sources where label='page 0 / sv / HTML';

select plan(13 + (select count(*)::integer from probes));

-- End-to-end safety oracle: the historical raw reference is the only indexed deletion pin for
-- an active image in a supported, already-persisted old CSS spelling. No Storage call is made.
select pg_temp.publish(jsonb_set(d.value,s.path,to_jsonb(s.canonical)))
from draft d,sources s where s.label='page 0 / sv / light CSS';
create temporary table old_pin as select revision from public.cms_site where id;
select ok(exists(select 1 from public.cms_revision_media
 where revision=(select revision from old_pin) and bucket='cms-library' and path='images/kept.webp'),
 'The previous canonical publication indexes this asset');
select pg_temp.publish(jsonb_set(d.value,s.path,to_jsonb(replace(s.canonical,'/storage/',$raw$/st\6frage/$raw$))))
from draft d,sources s where s.label='page 0 / sv / light CSS';
update public.cms_revisions set created_at=now()-interval '31 days' where revision<=(select revision from old_pin);
select is((select count(*)::int from public.internal_cms_document_media_placements(public.internal_cms_document())
 where bucket='cms-library' and path='images/kept.webp'),0,
 'The active CSS reference is invisible to the literal SQL extractor');
select ok((public.internal_cms_asset_usage('99000000-0000-4000-8000-000000000091',
 '99000000-0000-4000-8000-000000000092')->>'historyReferences')::int>0,
 'The old indexed revision protects the asset before pruning');
select lives_ok($$select public.internal_cms_asset_transition('99000000-0000-4000-8000-000000000091',
 '99000000-0000-4000-8000-000000000092',0,'trash')$$,
 'The owner can trash the asset when current placements cannot see it');
select throws_ok($$select public.internal_cms_asset_transition('99000000-0000-4000-8000-000000000091',
 '99000000-0000-4000-8000-000000000092',1,'delete')$$,
 '23514','Retained references protect this asset','Hard deletion is refused before pruning');
select is(public.prune_cms_revisions(),0,'Previously accepted CSS escapes block pruning');
select ok(exists(select 1 from public.cms_revisions where revision=(select revision from old_pin)),
 'The indexed historical revision remains');
select ok((public.internal_cms_asset_usage('99000000-0000-4000-8000-000000000091',
 '99000000-0000-4000-8000-000000000092')->>'historyReferences')::int>0,
 'Pruning preserves the current image deletion protection');
select throws_ok($$select public.internal_cms_asset_transition('99000000-0000-4000-8000-000000000091',
 '99000000-0000-4000-8000-000000000092',1,'delete')$$,
 '23514','Retained references protect this asset','Hard deletion is still refused after pruning');

-- Reset only test lifecycle state: the red test may have obtained a deletion claim. Each probe
-- creates a canonical pin through the real publisher, then seeds an already-persisted legacy head.
-- The current publisher rejects some of these spellings; upgrading must still protect stored data.
-- The real revision-index trigger runs for both snapshots; no retention/index routine is stubbed.
update public.cms_assets set archived=false,trashed_at=null,deleting_at=null
where id='99000000-0000-4000-8000-000000000092';
create function pg_temp.guarded(p_path text[],p_canonical text,p_source text,p_label text)
returns text language plpgsql as $$
declare v_old bigint; v_document jsonb;
begin
 perform pg_temp.publish(jsonb_set((select value from draft),p_path,to_jsonb(p_canonical)));
 select revision into v_old from public.cms_site where id;
 v_document := jsonb_set((select value from draft),p_path,to_jsonb(p_source));
 update public.cms_site set revision=v_old+1,presentation=v_document->'presentation' where id;
 insert into public.cms_revisions(revision,actor_id,document,fingerprint,summary)
 values(v_old+1,'99000000-0000-4000-8000-000000000091',v_document,md5(v_document::text),'Legacy head fixture');
 update public.cms_revisions set created_at=now()-interval '31 days' where revision=v_old;
 return is(public.prune_cms_revisions(),0,p_label || ' retains old indexed history');
end $$;
select pg_temp.guarded(path,canonical,source,label) from probes order by label;

-- JSON serialization escapes quotes and line breaks even when the authored source is canonical.
-- Unrelated prose may also contain actual backslashes/dot segments. Neither should pause pruning.
update public.cms_revisions set created_at=now()-interval '31 days'
where revision=(select revision from public.cms_site where id);
select pg_temp.publish(jsonb_set(jsonb_set(jsonb_set(d.value,
 '{presentation,pages,0,content,sv,html}',to_jsonb('<img src="https://media.example/storage/v1/object/public/cms-library/images/kept.webp" alt="A quoted image">'::text)),
 '{presentation,pages,0,content,en,css,dark}',to_jsonb(E'.hero {\n  background-image: url("https://media.example/storage/v1/object/public/cms-library/images/kept.webp");\n}\n'::text)),
 '{presentation,copy}',jsonb_build_object('app',jsonb_build_object('sv',jsonb_build_object('title',$raw$Notes: C:\assets\file and /../ or /%2e/ are prose.$raw$)))))
from draft d;
create temporary table canonical_head as select revision,document from public.cms_revisions
where revision=(select revision from public.cms_site where id);
create temporary table expected_prune as select count(*)::integer as count from public.cms_revisions r
where r.created_at<now()-interval '30 days'
 and r.revision<>(select revision from public.cms_site where id)
 and r.revision<>(select max(revision) from public.cms_revisions);
select ok((select count from expected_prune)>0,'Canonical-source control has old revisions eligible for pruning');
select is(public.prune_cms_revisions(),(select count from expected_prune),
 'Quoted HTML, multiline CSS and unrelated prose still allow retention expiry');
select is((select document from public.cms_revisions where revision=(select revision from canonical_head)),
 (select document from canonical_head),'The guard never rewrites authored content');
select is((select count(*)::int from public.cms_revisions r where r.created_at<now()-interval '30 days'
 and r.revision<>(select revision from public.cms_site where id)
 and r.revision<>(select max(revision) from public.cms_revisions)),0,
 'Publishing actual canonical source permits old history to expire');

select * from finish();
rollback;
