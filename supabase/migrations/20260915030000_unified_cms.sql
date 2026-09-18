-- Additive CMS layer. Existing booking, authentication and scheduling tables are not replaced.
begin;

create table public.cms_site (
  id boolean primary key default true check (id),
  revision bigint not null default 0 check (revision >= 0),
  presentation jsonb not null default '{"copy":{},"styles":{},"images":{},"themes":{"light":{},"dark":{}},"pages":[],"regions":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(presentation) = 'object' and octet_length(presentation::text) <= 2097152)
);
insert into public.cms_site(id) values (true);
alter table public.cms_site enable row level security;
revoke all on public.cms_site from public, anon, authenticated;
grant select on public.cms_site to anon, authenticated;
create policy cms_presentation_read on public.cms_site for select to anon, authenticated using (true);

create table public.cms_email_designs (
  template text not null,
  lang text not null check (lang in ('sv','en')),
  design jsonb not null check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 12000),
  primary key (template,lang),
  foreign key(template,lang) references public.email_templates(template,lang) on delete cascade
);
alter table public.cms_email_designs enable row level security;
revoke all on public.cms_email_designs from public, anon, authenticated;

create table public.cms_revisions (
  revision bigint primary key check(revision >= 0),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  request_id uuid unique,
  request_document jsonb,
  document jsonb not null check(jsonb_typeof(document) = 'object' and octet_length(document::text) <= 3145728),
  fingerprint text not null,
  summary text not null default '' check(char_length(summary) <= 160)
);
alter table public.cms_revisions enable row level security;
revoke all on public.cms_revisions from public, anon, authenticated;

create table public.cms_assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check(bucket in ('gallery','barber-photos','cms-library')),
  path text not null check(path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$' and path not like '%..%' and path not like '%//%'),
  name text not null check(char_length(name) between 1 and 160),
  alt text not null default '' check(char_length(alt) <= 2000),
  mime text not null,
  width integer check(width is null or width > 0),
  height integer check(height is null or height > 0),
  bytes bigint not null default 0 check(bytes >= 0),
  archived boolean not null default false,
  version integer not null default 0 check(version >= 0),
  created_at timestamptz not null default now(),
  unique(bucket,path)
);
alter table public.cms_assets enable row level security;
revoke all on public.cms_assets from public, anon, authenticated;
-- Existing public assets remain addressable; this does not publish new placements or change data.
insert into public.cms_assets(bucket,path,name,alt,mime,bytes)
select o.bucket_id, o.name, right(o.name,160), coalesce(g.alt,''), coalesce(o.metadata->>'mimetype','image/webp'),
 case when o.metadata->>'size' ~ '^[0-9]{1,14}$' then (o.metadata->>'size')::bigint else 0 end
from storage.objects o left join public.gallery_images g on o.bucket_id='gallery' and o.name=g.storage_path
where o.bucket_id in ('gallery','barber-photos') and o.name ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$' and o.name not like '%..%' and o.name not like '%//%'
on conflict(bucket,path) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cms-library','cms-library',true,5242880,array['image/webp','font/woff2'])
on conflict(id) do nothing;
-- Browser writes are intentionally absent; the authenticated image gateway validates first.

grant select, insert, update, delete on public.cms_site, public.cms_email_designs, public.cms_revisions, public.cms_assets to service_role;

create function public.internal_cms_assert_owner(p_actor uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='owner' and account_enabled and not must_change_password) then
    raise exception 'CMS owner required' using errcode='42501';
  end if;
end $$;
revoke all on function public.internal_cms_assert_owner(uuid) from public,anon,authenticated;
grant execute on function public.internal_cms_assert_owner(uuid) to service_role;

create function public.internal_cms_document() returns jsonb
language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'schema',1,
 'site',coalesce((select jsonb_object_agg(key,langs order by key) from (select key,jsonb_object_agg(lang,value order by lang) langs from public.site_content group by key) s),'{}'::jsonb),
 'about',coalesce((select jsonb_object_agg(key,langs order by key) from (select key,jsonb_object_agg(lang,value order by lang) langs from public.about_content group by key) s),'{}'::jsonb),
 'settings',coalesce((select jsonb_object_agg(key,value order by key) from public.site_settings where key=any(array['homepage_scale','about_scale','homepage_logo_path','homepage_logo_scale','homepage_logo_style','business_name','business_legal_name','business_org_number','business_email','business_phone_display','business_phone_tel','business_street','business_postal_code','business_city','business_maps_href','seo_title_sv','seo_description_sv','seo_title_en','seo_description_en'])),'{}'::jsonb),
 'barbers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'ig',ig,'role_sv',role_sv,'role_en',role_en,'bio_sv',bio_sv,'bio_en',bio_en,'sort_order',sort_order) order by id) from public.barbers),'[]'::jsonb),
 'photos',coalesce((select jsonb_object_agg(barber_id,storage_path order by barber_id) from public.barber_photos),'{}'::jsonb),
 'gallery',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'storage_path',storage_path,'alt',alt,'sort_order',sort_order) order by id) from public.gallery_images),'[]'::jsonb),
 'emails',coalesce((select jsonb_agg((to_jsonb(t)-'updated_at') || jsonb_build_object('design',d.design) order by t.template,t.lang) from public.email_templates t left join public.cms_email_designs d using(template,lang)),'[]'::jsonb),
 'presentation',(select presentation from public.cms_site where id)
) $$;
revoke all on function public.internal_cms_document() from public,anon,authenticated;
grant execute on function public.internal_cms_document() to service_role;

create function public.internal_cms_state(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_document jsonb;
begin
 perform public.internal_cms_assert_owner(p_actor);
 v_document := public.internal_cms_document();
 return jsonb_build_object('revision',(select revision from public.cms_site where id),'fingerprint',md5(v_document::text),'document',v_document,
 'assets',coalesce((select jsonb_agg(to_jsonb(a)-'created_at' order by a.created_at desc,a.id) from public.cms_assets a),'[]'::jsonb));
end $$;
revoke all on function public.internal_cms_state(uuid) from public,anon,authenticated;
grant execute on function public.internal_cms_state(uuid) to service_role;

create function public.internal_cms_history(p_actor uuid,p_before bigint default 9223372036854775807) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform public.internal_cms_assert_owner(p_actor);
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from (select revision,created_at,summary from public.cms_revisions where revision<p_before order by revision desc limit 30) r),'[]'::jsonb);
end $$;
revoke all on function public.internal_cms_history(uuid,bigint) from public,anon,authenticated;
grant execute on function public.internal_cms_history(uuid,bigint) to service_role;

create function public.internal_cms_revision(p_actor uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 perform public.internal_cms_assert_owner(p_actor);
 return (select jsonb_build_object('revision',revision,'created_at',created_at,'document',document) from public.cms_revisions where revision=p_revision);
end $$;
revoke all on function public.internal_cms_revision(uuid,bigint) from public,anon,authenticated;
grant execute on function public.internal_cms_revision(uuid,bigint) to service_role;

create function public.internal_cms_publish(p_actor uuid,p_document jsonb,p_base_revision bigint,p_base_fingerprint text,p_request_id uuid) returns jsonb
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
   if v_previous.actor_id is distinct from p_actor or v_previous.request_document is distinct from p_document then
     raise exception 'Request identity was reused with different content' using errcode='22023';
   end if;
   return jsonb_build_object('revision',v_previous.revision,'fingerprint',v_previous.fingerprint,'requestId',p_request_id,'document',v_previous.document);
 end if;
 v_before := public.internal_cms_document();
 if v_head<>p_base_revision or md5(v_before::text)<>p_base_fingerprint then
   raise exception 'CMS content changed; review the newer revision before publishing' using errcode='40001';
 end if;
 select array_agg(id order by id) into v_current_ids from public.barbers;
 select array_agg(value->>'id' order by value->>'id') into v_new_ids from jsonb_array_elements(p_document->'barbers');
 if v_current_ids is distinct from v_new_ids then raise exception 'Staff membership changed; reload before publishing' using errcode='40001'; end if;
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
 insert into public.cms_revisions(revision,actor_id,request_id,request_document,document,fingerprint,summary)
 values(v_head+1,p_actor,p_request_id,p_document,v_after,md5(v_after::text),'Published website and email content');
 return jsonb_build_object('revision',v_head+1,'fingerprint',md5(v_after::text),'requestId',p_request_id,'document',v_after);
end $$;
revoke all on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid) to service_role;

create function public.internal_cms_asset_update(p_actor uuid,p_id uuid,p_version integer,p_name text,p_alt text,p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_asset public.cms_assets%rowtype;
begin
 perform public.internal_cms_assert_owner(p_actor);
 update public.cms_assets set name=p_name,alt=p_alt,archived=p_archived,version=version+1 where id=p_id and version=p_version returning * into v_asset;
 if not found then raise exception 'Asset metadata changed' using errcode='40001'; end if;
 return to_jsonb(v_asset)-'created_at';
end $$;
revoke all on function public.internal_cms_asset_update(uuid,uuid,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_update(uuid,uuid,integer,text,text,boolean) to service_role;

create or replace function public.email_template_for_delivery(p_template text,p_lang text) returns jsonb
language sql stable security definer set search_path = '' as $$
 select (to_jsonb(t)-'updated_at') || case when d.design is null then '{}'::jsonb else jsonb_build_object('design',d.design) end
 from public.email_templates t left join public.cms_email_designs d using(template,lang)
 where t.template=p_template and t.lang=p_lang;
$$;
revoke all on function public.email_template_for_delivery(text,text) from public,anon,authenticated;
grant execute on function public.email_template_for_delivery(text,text) to service_role;

create function public.public_cms_presentation() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('revision',revision,'presentation',presentation) from public.cms_site where id;
$$;
revoke all on function public.public_cms_presentation() from public,anon,authenticated;
grant execute on function public.public_cms_presentation() to anon,authenticated,service_role;

-- A matching retained path blocks physical cleanup. JSON snapshots contain no client secrets.
create function public.internal_cms_media_retained(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.cms_revisions r where position(p_path in r.document::text)>0)
 or exists(select 1 from public.cms_assets a where a.bucket=p_bucket and a.path=p_path);
$$;
revoke all on function public.internal_cms_media_retained(text,text) from public,anon,authenticated;
grant execute on function public.internal_cms_media_retained(text,text) to service_role;

commit;
