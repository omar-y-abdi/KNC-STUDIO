-- CMS publication fixes deployed together (LIFE-3, LIFE-1, LIFE-13).
--
-- LIFE-3: optimistic-concurrency conflicts raised SQLSTATE 40001. PostgREST retries 40001 inside
-- the same request until the backend is terminated, so the studio never received its 409 and the
-- retry re-took the publication's 9-table lock hundreds of times per second. Conflicts now raise
-- PT409, which PostgREST answers as HTTP 409 at once.
--
-- LIFE-1: archived media may stay where the authoritative head already shows it, but may not be
-- newly placed. Structured placements keep per-key identity. Markup references are compared per
-- asset against everything the head references: every gallery change recaptures Home/About, which
-- renumbers markup images, so an ordinal says nothing about whether an image is new. The rule runs
-- only here; the Edge validator keeps registration and scope checks.
--
-- LIFE-13: a revision kept the request document next to its committed document. Idempotency only
-- needs the request's identity: md5 of the canonical jsonb text.
--
-- Function bodies are copied from their latest definitions; only the commented changes differ.
-- Deploy: terminate PostgREST backends still retrying internal_cms_* before and after this
-- migration, then deploy cms-studio at once (the old Edge answers PT409 with 503).
begin;

alter table public.cms_revisions
  add column request_fingerprint text check (request_fingerprint ~ '^[0-9a-f]{32}$');

-- Clearing the request copy in the same pass frees its TOAST data; revisions are never updated
-- again, so dropping the column alone would keep the bytes on disk.
update public.cms_revisions
set request_fingerprint = md5(request_document::text), request_document = null
where request_document is not null;

-- Body from 20260915030000_unified_cms.sql (renamed by 20260918001000). Changed: the request
-- fingerprint replaces the request copy, and both conflicts raise PT409.
create or replace function public.internal_cms_publish_unchecked(p_actor uuid,p_document jsonb,p_base_revision bigint,p_base_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_head bigint; v_before jsonb; v_after jsonb; v_previous public.cms_revisions%rowtype; row_data jsonb; pair record; cell record; v_current_ids text[]; v_new_ids text[];
begin
 perform public.internal_cms_assert_owner(p_actor);
 if p_request_id is null or p_base_revision is null or p_base_revision<0 or p_base_fingerprint is null or p_base_fingerprint !~ '^[0-9a-f]{32}$'
   or p_document is null or p_document->>'schema' is distinct from '1' or jsonb_typeof(p_document->'barbers') is distinct from 'array'
   or jsonb_typeof(p_document->'settings') is distinct from 'object'
   or jsonb_typeof(p_document->'presentation') is distinct from 'object' or octet_length(p_document::text)>3145728 then
   raise exception 'Invalid CMS publication' using errcode='22023';
 end if;
 if (p_document->'settings') ? 'cancellation_policy_hours'
   or exists(
     select 1
     from jsonb_array_elements(p_document->'barbers') as item(value)
     where item.value ? 'active'
   ) then
   raise exception 'Operational booking rules are not CMS content' using errcode='22023';
 end if;
 -- One consistent snapshot, including edits made by existing non-CMS management tools.
 lock table public.barbers,public.site_content,public.about_content,public.site_settings,public.barber_photos,public.gallery_images,public.email_templates,public.cms_email_designs,public.cms_assets in share row exclusive mode;
 select revision into v_head from public.cms_site where id for update;
 select * into v_previous from public.cms_revisions where request_id=p_request_id;
 if found then
   if v_previous.actor_id is distinct from p_actor or v_previous.request_fingerprint is distinct from md5(p_document::text) then
     raise exception 'Request identity was reused with different content' using errcode='22023';
   end if;
   return jsonb_build_object('revision',v_previous.revision,'fingerprint',v_previous.fingerprint,'requestId',p_request_id,'document',v_previous.document);
 end if;
 v_before := public.internal_cms_document();
 if v_head<>p_base_revision or md5(v_before::text)<>p_base_fingerprint then
   raise sqlstate 'PT409' using message='CMS content changed; review the newer revision before publishing';
 end if;
 select array_agg(id order by id) into v_current_ids from public.barbers;
 select array_agg(value->>'id' order by value->>'id') into v_new_ids from jsonb_array_elements(p_document->'barbers');
 if v_current_ids is distinct from v_new_ids then raise sqlstate 'PT409' using message='Staff membership changed; reload before publishing'; end if;
 insert into public.cms_revisions(revision,actor_id,document,fingerprint,summary)
 values(v_head,p_actor,v_before,md5(v_before::text),'Initial CMS snapshot') on conflict(revision) do nothing;

 -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.site_content existing
 where not exists (
   select 1 from jsonb_each(p_document->'site') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'site') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.site_content(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.site_content.value is distinct from excluded.value;
   end loop;
 end loop;
 -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.about_content existing
 where not exists (
   select 1 from jsonb_each(p_document->'about') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'about') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.about_content(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.about_content.value is distinct from excluded.value;
   end loop;
 end loop;
 delete from public.site_settings where key in (select key from jsonb_each(v_before->'settings')) and not p_document->'settings' ? key;
 for pair in select * from jsonb_each_text(p_document->'settings') loop
   insert into public.site_settings(key,value) values(pair.key,pair.value) on conflict(key) do update set value=excluded.value,updated_at=now();
 end loop;
 for row_data in select value from jsonb_array_elements(p_document->'barbers') loop
   update public.barbers set name=row_data->>'name',ig=row_data->>'ig',role_sv=row_data->>'role_sv',role_en=row_data->>'role_en',bio_sv=row_data->>'bio_sv',bio_en=row_data->>'bio_en',sort_order=(row_data->>'sort_order')::integer where id=row_data->>'id';
 end loop;
 delete from public.barber_photos where not p_document->'photos' ? barber_id;
 for pair in select * from jsonb_each_text(p_document->'photos') loop
   insert into public.barber_photos(barber_id,storage_path) values(pair.key,pair.value) on conflict(barber_id) do update set storage_path=excluded.storage_path,updated_at=now();
 end loop;
 delete from public.gallery_images where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_document->'gallery'));
 for row_data in select value from jsonb_array_elements(p_document->'gallery') loop
   insert into public.gallery_images(id,kind,storage_path,alt,sort_order) values((row_data->>'id')::uuid,row_data->>'kind',row_data->>'storage_path',row_data->>'alt',(row_data->>'sort_order')::integer)
   on conflict(id) do update set kind=excluded.kind,storage_path=excluded.storage_path,alt=excluded.alt,sort_order=excluded.sort_order;
 end loop;
 delete from public.email_templates t where not exists(select 1 from jsonb_array_elements(p_document->'emails') e where e->>'template'=t.template and e->>'lang'=t.lang);
 for row_data in select value from jsonb_array_elements(p_document->'emails') loop
   insert into public.email_templates(template,lang,subject,preheader,title,intro,section_title,note,cta_label,contact_lead)
   values(row_data->>'template',row_data->>'lang',row_data->>'subject',row_data->>'preheader',row_data->>'title',row_data->>'intro',row_data->>'section_title',row_data->>'note',row_data->>'cta_label',row_data->>'contact_lead')
   on conflict(template,lang) do update set subject=excluded.subject,preheader=excluded.preheader,title=excluded.title,intro=excluded.intro,section_title=excluded.section_title,note=excluded.note,cta_label=excluded.cta_label,contact_lead=excluded.contact_lead,updated_at=now();
   if row_data->'design'='null'::jsonb then delete from public.cms_email_designs where template=row_data->>'template' and lang=row_data->>'lang';
   else insert into public.cms_email_designs(template,lang,design) values(row_data->>'template',row_data->>'lang',row_data->'design') on conflict(template,lang) do update set design=excluded.design; end if;
 end loop;
 update public.cms_site set revision=v_head+1,presentation=p_document->'presentation',updated_at=now() where id;
 v_after := public.internal_cms_document();
 insert into public.cms_revisions(revision,actor_id,request_id,request_fingerprint,document,fingerprint,summary)
 values(v_head+1,p_actor,p_request_id,md5(p_document::text),v_after,md5(v_after::text),'Published website and email content');
 return jsonb_build_object('revision',v_head+1,'fingerprint',md5(v_after::text),'requestId',p_request_id,'document',v_after);
end $$;
revoke all on function public.internal_cms_publish_unchecked(uuid,jsonb,bigint,text,uuid)
from public,anon,authenticated,service_role;

alter table public.cms_revisions drop column request_document;

-- Media the draft shows that the head does not already show in the same way.
create function public.internal_cms_newly_placed_media(p_document jsonb,p_head jsonb)
returns table(bucket text,path text)
language sql stable security definer set search_path = '' as $$
with incoming as materialized (
  select
    r.placement,
    r.bucket,
    r.path,
    r.placement like 'presentation.pages:%' or r.placement like 'presentation.regions:%' as markup
  from public.internal_cms_document_media_placements(p_document) r
),
head as materialized (
  select r.placement,r.bucket,r.path
  from public.internal_cms_document_media_placements(p_head) r
)
select distinct incoming.bucket,incoming.path
from incoming
where not exists (
  select 1
  from head
  where head.bucket=incoming.bucket
    and head.path=incoming.path
    and (incoming.markup or head.placement=incoming.placement)
);
$$;
revoke all on function public.internal_cms_newly_placed_media(jsonb,jsonb)
from public,anon,authenticated,service_role;

-- PT422 carries an owner-facing Swedish message; cms-studio passes it through unchanged.
create function public.internal_cms_assert_media_publishable(p_document jsonb,p_head jsonb)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_media record;
begin
  select media.path,asset.id,asset.name,asset.mime,asset.trashed_at
  into v_media
  from public.internal_cms_newly_placed_media(p_document,p_head) media
  left join public.cms_assets asset on asset.bucket=media.bucket and asset.path=media.path
  where asset.id is null or asset.archived
  order by media.bucket,media.path
  limit 1;

  if not found then
    return;
  end if;

  if v_media.id is null then
    raise sqlstate 'PT422' using message=format(
      'Filen %s finns inte i biblioteket. Välj den på nytt under Resurser.',
      v_media.path
    );
  end if;

  raise sqlstate 'PT422' using message=format(
    '%s %s %s och kan inte läggas till på en ny plats. Återställ den under Resurser först.',
    case when v_media.mime like 'image/%' then 'Bilden' else 'Filen' end,
    v_media.name,
    case when v_media.trashed_at is null then 'är arkiverad' else 'ligger i papperskorgen' end
  );
end $$;
revoke all on function public.internal_cms_assert_media_publishable(jsonb,jsonb)
from public,anon,authenticated,service_role;

-- The studio's validate operation (import, locked preview) applies the same rule to the head.
create function public.internal_cms_check_media(p_actor uuid,p_document jsonb)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.internal_cms_assert_owner(p_actor);
  perform public.internal_cms_assert_media_publishable(p_document,public.internal_cms_document());
end $$;
revoke all on function public.internal_cms_check_media(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_cms_check_media(uuid,jsonb) to service_role;

-- Body from 20260918002000_cms_asset_placement_lifecycle.sql. Changed: the stale base raises
-- PT409, and the per-placement loop is replaced by internal_cms_assert_media_publishable.
create or replace function public.internal_cms_publish(
  p_actor uuid,
  p_document jsonb,
  p_base_revision bigint,
  p_base_fingerprint text,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_head bigint;
  v_before jsonb;
begin
  perform public.internal_cms_assert_owner(p_actor);

  if p_request_id is null
    or p_base_revision is null
    or p_base_revision<0
    or p_base_fingerprint is null
    or p_base_fingerprint !~ '^[0-9a-f]{32}$'
    or p_document is null
    or p_document->>'schema' is distinct from '1'
    or jsonb_typeof(p_document->'barbers') is distinct from 'array'
    or jsonb_typeof(p_document->'presentation') is distinct from 'object'
    or octet_length(p_document::text)>3145728 then
    raise exception 'Invalid CMS publication' using errcode='22023';
  end if;

  lock table public.barbers,public.site_content,public.about_content,public.site_settings,
    public.barber_photos,public.gallery_images,public.email_templates,
    public.cms_email_designs,public.cms_assets in share row exclusive mode;

  select revision into v_head from public.cms_site where id for update;

  -- An exact replay returns the committed revision even if its media was archived since.
  if exists (select 1 from public.cms_revisions where request_id=p_request_id) then
    return public.internal_cms_publish_unchecked(
      p_actor,p_document,p_base_revision,p_base_fingerprint,p_request_id
    );
  end if;

  v_before := public.internal_cms_document();

  if v_head<>p_base_revision or md5(v_before::text)<>p_base_fingerprint then
    raise sqlstate 'PT409' using message='CMS content changed; review the newer revision before publishing';
  end if;

  perform public.internal_cms_assert_media_publishable(p_document,v_before);

  return public.internal_cms_publish_unchecked(
    p_actor,p_document,p_base_revision,p_base_fingerprint,p_request_id
  );
end $$;
revoke all on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
from public,anon,authenticated;
grant execute on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
to service_role;

comment on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid) is
'Publishes a validated CMS document while serializing asset lifecycle changes. Archived media may stay on structured keys the authoritative head already uses and in markup when the head references the asset anywhere; any other placement requires an active asset.';

-- Body from 20260915030000_unified_cms.sql. Changed: the stale version raises PT409.
create or replace function public.internal_cms_asset_update(p_actor uuid,p_id uuid,p_version integer,p_name text,p_alt text,p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_asset public.cms_assets%rowtype;
begin
 perform public.internal_cms_assert_owner(p_actor);
 update public.cms_assets set name=p_name,alt=p_alt,archived=p_archived,version=version+1 where id=p_id and version=p_version returning * into v_asset;
 if not found then raise sqlstate 'PT409' using message='Asset metadata changed'; end if;
 return to_jsonb(v_asset)-'created_at';
end $$;
revoke all on function public.internal_cms_asset_update(uuid,uuid,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_update(uuid,uuid,integer,text,text,boolean) to service_role;

-- Body from 20260924223012_cms_revision_media_index.sql. Changed: the stale version raises PT409.
create or replace function public.internal_cms_asset_transition(
  p_actor uuid,
  p_id uuid,
  p_version integer,
  p_action text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.cms_assets%rowtype;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id for update;
  if not found then raise exception 'CMS asset not found' using errcode='P0002'; end if;
  if v_asset.version<>p_version or v_asset.deleting_at is not null then
    raise sqlstate 'PT409' using message='Asset lifecycle changed';
  end if;
  if p_action not in ('archive','restore','trash','delete') then
    raise exception 'Invalid asset lifecycle action' using errcode='22023';
  end if;

  select count(*) into v_current
  from public.internal_cms_document_media_placements(public.internal_cms_document()) r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  select coalesce(sum(r.reference_count),0) into v_history
  from public.cms_revision_media r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;

  if p_action='trash' and v_current>0 then
    raise exception 'Referenced assets cannot be moved to trash' using errcode='23514';
  end if;
  if p_action='delete' and (v_asset.trashed_at is null or v_current>0 or v_history>0) then
    raise exception 'Retained references protect this asset' using errcode='23514';
  end if;

  if p_action='archive' then
    update public.cms_assets set archived=true,trashed_at=null,version=version+1
    where id=p_id returning * into v_asset;
  elsif p_action='restore' then
    update public.cms_assets set archived=false,trashed_at=null,version=version+1
    where id=p_id returning * into v_asset;
  elsif p_action='trash' then
    update public.cms_assets set archived=true,trashed_at=coalesce(trashed_at,now()),version=version+1
    where id=p_id returning * into v_asset;
  else
    update public.cms_assets set deleting_at=now(),version=version+1
    where id=p_id returning * into v_asset;
  end if;

  return jsonb_build_object(
    'asset',to_jsonb(v_asset)-'created_at'-'deleting_at',
    'usage',jsonb_build_object('currentReferences',v_current,'historyReferences',v_history)
  );
end $$;
revoke all on function public.internal_cms_asset_transition(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_transition(uuid,uuid,integer,text) to service_role;

-- Body from 20260924223012_cms_revision_media_index.sql. Changed: a lost claim raises PT409.
create or replace function public.internal_cms_asset_delete_abort(
  p_actor uuid,p_id uuid,p_version integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_asset public.cms_assets%rowtype;
begin
  perform public.internal_cms_assert_owner(p_actor);
  update public.cms_assets set deleting_at=null,version=version+1
  where id=p_id and version=p_version and deleting_at is not null
  returning * into v_asset;
  if not found then raise sqlstate 'PT409' using message='Asset deletion claim changed'; end if;
  return to_jsonb(v_asset)-'created_at'-'deleting_at';
end $$;
revoke all on function public.internal_cms_asset_delete_abort(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_delete_abort(uuid,uuid,integer) to service_role;

-- Body from 20260924223012_cms_revision_media_index.sql. Changed: a lost claim raises PT409.
create or replace function public.internal_cms_asset_delete_finalize(
  p_actor uuid,p_id uuid,p_version integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.cms_assets%rowtype;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id for update;
  if not found then return true; end if;
  if v_asset.version<>p_version or v_asset.deleting_at is null then
    raise sqlstate 'PT409' using message='Asset deletion claim changed';
  end if;
  select count(*) into v_current
  from public.internal_cms_document_media_placements(public.internal_cms_document()) r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  select coalesce(sum(r.reference_count),0) into v_history
  from public.cms_revision_media r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  if v_current>0 or v_history>0 then
    raise exception 'Retained references protect this asset' using errcode='23514';
  end if;
  delete from public.cms_assets where id=p_id and version=p_version;
  return true;
end $$;
revoke all on function public.internal_cms_asset_delete_finalize(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_delete_finalize(uuid,uuid,integer) to service_role;

commit;
