-- Materialize immutable revision references once, not on every asset click/delete.
-- This is derived metadata. Documents remain authoritative and unchanged.
begin;
lock table public.cms_revisions in share row exclusive mode;
create table public.cms_revision_media (
  revision bigint not null references public.cms_revisions(revision) on delete cascade,
  bucket text not null,
  path text not null,
  reference_count bigint not null check(reference_count > 0),
  primary key(revision,bucket,path)
);
create index cms_revision_media_asset on public.cms_revision_media(bucket,path) include(reference_count);
alter table public.cms_revision_media enable row level security;
revoke all on public.cms_revision_media from public,anon,authenticated,service_role;

create function public.internal_cms_index_revision_media() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cms_revision_media where revision=new.revision;
  insert into public.cms_revision_media(revision,bucket,path,reference_count)
  select new.revision,r.bucket,r.path,count(*)
  from public.internal_cms_document_media_placements(new.document) r
  group by r.bucket,r.path;
  return new;
end $$;
revoke all on function public.internal_cms_index_revision_media() from public,anon,authenticated,service_role;
create trigger cms_revision_media_index
  after insert or update of document on public.cms_revisions
  for each row execute function public.internal_cms_index_revision_media();

-- The lock and trigger make the backfill atomic with concurrent publications.
insert into public.cms_revision_media(revision,bucket,path,reference_count)
select revision.revision,r.bucket,r.path,count(*)
from public.cms_revisions revision
cross join lateral public.internal_cms_document_media_placements(revision.document) r
group by revision.revision,r.bucket,r.path;

create or replace function public.internal_cms_asset_usage(p_actor uuid,p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_asset public.cms_assets%rowtype;
  v_current bigint;
  v_history bigint;
begin
  perform public.internal_cms_assert_owner(p_actor);
  select * into v_asset from public.cms_assets where id=p_id;
  if not found then raise exception 'CMS asset not found' using errcode='P0002'; end if;
  select count(*) into v_current
  from public.internal_cms_document_media_placements(public.internal_cms_document()) r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  select coalesce(sum(r.reference_count),0) into v_history
  from public.cms_revision_media r
  where r.bucket=v_asset.bucket and r.path=v_asset.path;
  return jsonb_build_object('currentReferences',v_current,'historyReferences',v_history);
end $$;
revoke all on function public.internal_cms_asset_usage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_usage(uuid,uuid) to service_role;

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
    raise exception 'Asset lifecycle changed' using errcode='40001';
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
  if not found then raise exception 'Asset deletion claim changed' using errcode='40001'; end if;
  return to_jsonb(v_asset)-'created_at'-'deleting_at';
end $$;
revoke all on function public.internal_cms_asset_delete_abort(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.internal_cms_asset_delete_abort(uuid,uuid,integer) to service_role;

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
    raise exception 'Asset deletion claim changed' using errcode='40001';
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
