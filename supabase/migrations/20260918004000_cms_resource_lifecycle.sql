-- Add a complete, reference-safe lifecycle for CMS resources.
begin;

alter table public.cms_assets
  add column trashed boolean not null default false,
  add column deleting boolean not null default false;

alter table public.cms_assets
  add constraint cms_assets_lifecycle_state_check
  check ((not trashed or archived) and (not deleting or trashed));

create or replace function public.internal_cms_asset_update(
  p_actor uuid,
  p_id uuid,
  p_version integer,
  p_name text,
  p_alt text,
  p_archived boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_asset public.cms_assets%rowtype;
begin
  perform public.internal_cms_assert_owner(p_actor);
  update public.cms_assets
  set name=p_name,alt=p_alt,archived=p_archived,version=version+1
  where id=p_id and version=p_version and not trashed and not deleting
  returning * into v_asset;
  if not found then
    raise exception 'Asset metadata changed or the resource is not editable'
      using errcode='40001';
  end if;
  return to_jsonb(v_asset)-'created_at';
end $$;
revoke all on function public.internal_cms_asset_update(uuid,uuid,integer,text,text,boolean)
from public,anon,authenticated;
grant execute on function public.internal_cms_asset_update(uuid,uuid,integer,text,text,boolean)
to service_role;

create function public.internal_cms_asset_usage_counts(p_bucket text,p_path text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'currentReferences',(
      select count(*)
      from public.internal_cms_document_media_placements(public.internal_cms_document()) placement
      where placement.bucket=p_bucket and placement.path=p_path
    ),
    'historyReferences',(
      select count(*)
      from public.cms_revisions revision
      cross join lateral public.internal_cms_document_media_placements(revision.document) placement
      where placement.bucket=p_bucket and placement.path=p_path
    )
  );
$$;
revoke all on function public.internal_cms_asset_usage_counts(text,text)
from public,anon,authenticated,service_role;

create function public.internal_cms_asset_usage(p_actor uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_asset public.cms_assets%rowtype;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id;
  if not found then raise exception 'Resursen finns inte längre.' using errcode='P4090'; end if;
  return public.internal_cms_asset_usage_counts(v_asset.bucket,v_asset.path);
end $$;
revoke all on function public.internal_cms_asset_usage(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.internal_cms_asset_usage(uuid,uuid) to service_role;

create function public.internal_cms_asset_transition(
  p_actor uuid,
  p_id uuid,
  p_version integer,
  p_action text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.cms_assets%rowtype;
  v_usage jsonb;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  if p_action not in ('archive','restore','trash','delete') then
    raise exception 'Ogiltig resursåtgärd.' using errcode='22023';
  end if;

  lock table public.barbers,public.site_content,public.about_content,public.site_settings,
    public.barber_photos,public.gallery_images,public.email_templates,
    public.cms_email_designs,public.cms_assets in share row exclusive mode;

  select * into v_asset from public.cms_assets where id=p_id for update;
  if not found then raise exception 'Resursen finns inte längre.' using errcode='P4090'; end if;
  if v_asset.version<>p_version then
    raise exception 'Resursen ändrades i en annan flik.' using errcode='40001';
  end if;

  v_usage := public.internal_cms_asset_usage_counts(v_asset.bucket,v_asset.path);
  v_current := coalesce((v_usage->>'currentReferences')::bigint,0);
  v_history := coalesce((v_usage->>'historyReferences')::bigint,0);

  if v_asset.deleting then
    if p_action<>'delete' then
      raise exception 'Resursen håller redan på att raderas.' using errcode='P4090';
    end if;
    return jsonb_build_object('asset',to_jsonb(v_asset)-'created_at','usage',v_usage);
  end if;

  if p_action='archive' then
    if v_asset.trashed then
      raise exception 'Återställ resursen från papperskorgen först.' using errcode='P4090';
    end if;
    update public.cms_assets
    set archived=true,trashed=false,version=version+1
    where id=p_id returning * into v_asset;
  elsif p_action='restore' then
    update public.cms_assets
    set archived=false,trashed=false,version=version+1
    where id=p_id returning * into v_asset;
  elsif p_action='trash' then
    if v_current>0 then
      raise exception 'Resursen används fortfarande på den publicerade webbplatsen.'
        using errcode='P4090';
    end if;
    update public.cms_assets
    set archived=true,trashed=true,version=version+1
    where id=p_id returning * into v_asset;
  else
    if not v_asset.trashed then
      raise exception 'Flytta resursen till papperskorgen före permanent radering.'
        using errcode='P4090';
    end if;
    if v_current>0 then
      raise exception 'Resursen används fortfarande på den publicerade webbplatsen.'
        using errcode='P4090';
    end if;
    if v_history>0 then
      raise exception 'Resursen finns fortfarande i sparad historik och kan inte raderas permanent.'
        using errcode='P4090';
    end if;
    update public.cms_assets
    set deleting=true,version=version+1
    where id=p_id returning * into v_asset;
  end if;

  return jsonb_build_object('asset',to_jsonb(v_asset)-'created_at','usage',v_usage);
end $$;
revoke all on function public.internal_cms_asset_transition(uuid,uuid,integer,text)
from public,anon,authenticated;
grant execute on function public.internal_cms_asset_transition(uuid,uuid,integer,text)
to service_role;

create function public.internal_cms_asset_delete_finalize(
  p_actor uuid,
  p_id uuid,
  p_version integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.cms_assets%rowtype;
  v_usage jsonb;
begin
  perform public.internal_cms_assert_owner(p_actor);
  lock table public.barbers,public.site_content,public.about_content,public.site_settings,
    public.barber_photos,public.gallery_images,public.email_templates,
    public.cms_email_designs,public.cms_assets in share row exclusive mode;
  select * into v_asset from public.cms_assets where id=p_id for update;
  if not found then return true; end if;
  if v_asset.version<>p_version or not v_asset.trashed or not v_asset.deleting then
    raise exception 'Resursen ändrades innan raderingen kunde slutföras.' using errcode='40001';
  end if;
  v_usage := public.internal_cms_asset_usage_counts(v_asset.bucket,v_asset.path);
  if coalesce((v_usage->>'currentReferences')::bigint,0)>0
     or coalesce((v_usage->>'historyReferences')::bigint,0)>0 then
    raise exception 'Resursen fick en ny referens innan raderingen kunde slutföras.'
      using errcode='P4090';
  end if;
  delete from public.cms_assets where id=p_id and version=p_version and deleting and trashed;
  return true;
end $$;
revoke all on function public.internal_cms_asset_delete_finalize(uuid,uuid,integer)
from public,anon,authenticated;
grant execute on function public.internal_cms_asset_delete_finalize(uuid,uuid,integer)
to service_role;

create function public.internal_cms_assert_asset_assignable(p_bucket text,p_path text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_path is null or p_path='' then return; end if;
  if not exists(
    select 1 from public.cms_assets asset
    where asset.bucket=p_bucket and asset.path=p_path
      and not asset.archived and not asset.trashed and not asset.deleting
  ) then
    raise exception 'Archived, trashed or deleting media cannot be assigned to a new placement.'
      using errcode='23514';
  end if;
end $$;
revoke all on function public.internal_cms_assert_asset_assignable(text,text)
from public,anon,authenticated,service_role;

create function public.internal_cms_guard_storage_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bucket text;
begin
  if tg_op='UPDATE' and new.storage_path is not distinct from old.storage_path then return new; end if;
  v_bucket := case when tg_table_name='barber_photos' then 'barber-photos' else 'gallery' end;
  perform public.internal_cms_assert_asset_assignable(v_bucket,new.storage_path);
  return new;
end $$;
revoke all on function public.internal_cms_guard_storage_assignment()
from public,anon,authenticated,service_role;

drop trigger if exists cms_guard_gallery_asset_assignment on public.gallery_images;
create trigger cms_guard_gallery_asset_assignment
before insert or update on public.gallery_images
for each row execute function public.internal_cms_guard_storage_assignment();

drop trigger if exists cms_guard_barber_asset_assignment on public.barber_photos;
create trigger cms_guard_barber_asset_assignment
before insert or update on public.barber_photos
for each row execute function public.internal_cms_guard_storage_assignment();

create function public.internal_cms_guard_logo_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.key<>'homepage_logo_path' or coalesce(new.value,'')='' then return new; end if;
  if tg_op='UPDATE' and old.key='homepage_logo_path' and new.value is not distinct from old.value then
    return new;
  end if;
  perform public.internal_cms_assert_asset_assignable('gallery',new.value);
  return new;
end $$;
revoke all on function public.internal_cms_guard_logo_assignment()
from public,anon,authenticated,service_role;

drop trigger if exists cms_guard_homepage_logo_assignment on public.site_settings;
create trigger cms_guard_homepage_logo_assignment
before insert or update on public.site_settings
for each row execute function public.internal_cms_guard_logo_assignment();

create function public.internal_cms_guard_email_logo_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_logo jsonb;
begin
  v_logo := new.design->'logo';
  if jsonb_typeof(v_logo) is distinct from 'object' then return new; end if;
  if tg_op='UPDATE' and v_logo is not distinct from old.design->'logo' then return new; end if;
  perform public.internal_cms_assert_asset_assignable(v_logo->>'bucket',v_logo->>'path');
  return new;
end $$;
revoke all on function public.internal_cms_guard_email_logo_assignment()
from public,anon,authenticated,service_role;

drop trigger if exists cms_guard_email_logo_assignment on public.cms_email_designs;
create trigger cms_guard_email_logo_assignment
before insert or update on public.cms_email_designs
for each row execute function public.internal_cms_guard_email_logo_assignment();

comment on table public.cms_assets is
'Immutable CMS resource registry with Active, Archived and Trash lifecycle. Permanent deletion requires zero current and retained-history references.';

commit;
