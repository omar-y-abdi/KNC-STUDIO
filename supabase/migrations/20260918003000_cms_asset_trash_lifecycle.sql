-- Recoverable trash + optimistic lifecycle transitions for CMS resources.
begin;

alter table public.cms_assets
  add column if not exists trashed_at timestamptz,
  add column if not exists deleting_at timestamptz;

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
  select count(*) into v_history
  from public.cms_revisions revision
  cross join lateral public.internal_cms_document_media_placements(revision.document) r
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
  select count(*) into v_history
  from public.cms_revisions revision
  cross join lateral public.internal_cms_document_media_placements(revision.document) r
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
  select count(*) into v_history
  from public.cms_revisions revision
  cross join lateral public.internal_cms_document_media_placements(revision.document) r
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
