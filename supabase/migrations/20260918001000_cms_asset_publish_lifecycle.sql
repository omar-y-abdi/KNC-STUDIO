-- Prevent archived assets from being newly introduced by stale CMS drafts.
begin;

create function public.internal_cms_document_media(p_document jsonb)
returns table(bucket text,path text)
language sql stable security definer set search_path = '' as $$
with structured as (
  select ref->>'bucket' as bucket, ref->>'path' as path
  from jsonb_path_query(p_document,'$.presentation.images.*.ref') as refs(ref)

  union all

  select ref->>'bucket', ref->>'path'
  from jsonb_path_query(p_document,'$.presentation.fonts.*.ref') as refs(ref)

  union all

  select 'gallery', image->>'storage_path'
  from jsonb_path_query(p_document,'$.gallery[*]') as images(image)

  union all

  select 'barber-photos', photo.value
  from jsonb_each_text(
    case
      when jsonb_typeof(p_document->'photos')='object' then p_document->'photos'
      else '{}'::jsonb
    end
  ) as photo

  union all

  select 'gallery', p_document#>>'{settings,homepage_logo_path}'
  where coalesce(p_document#>>'{settings,homepage_logo_path}','')<>''

  union all

  select logo->>'bucket', logo->>'path'
  from jsonb_path_query(p_document,'$.emails[*].design.logo') as logos(logo)
),
markup_source as (
  select j.value #>> '{}' as source
  from jsonb_path_query(p_document,'$.presentation.pages[*].content.*.html') as j(value)

  union all

  select j.value #>> '{}'
  from jsonb_path_query(p_document,'$.presentation.pages[*].content.*.css.*') as j(value)

  union all

  select j.value #>> '{}'
  from jsonb_path_query(p_document,'$.presentation.regions.*.*.html') as j(value)

  union all

  select j.value #>> '{}'
  from jsonb_path_query(p_document,'$.presentation.regions.*.*.css.*') as j(value)
),
markup as (
  select (m.parts)[1] as bucket,(m.parts)[2] as path
  from markup_source
  cross join lateral regexp_matches(
    source,
    '/storage/v1/object/public/(gallery|barber-photos|cms-library)/([a-zA-Z0-9][a-zA-Z0-9_./-]{0,239})',
    'g'
  ) as m(parts)
),
refs as (
  select bucket,path from structured
  union all
  select bucket,path from markup
)
select distinct refs.bucket,refs.path
from refs
where refs.bucket in ('gallery','barber-photos','cms-library')
  and refs.path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$'
  and refs.path not like '%..%'
  and refs.path not like '%//%';
$$;
revoke all on function public.internal_cms_document_media(jsonb) from public,anon,authenticated,service_role;

alter function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
rename to internal_cms_publish_unchecked;
revoke all on function public.internal_cms_publish_unchecked(uuid,jsonb,bigint,text,uuid)
from public,anon,authenticated,service_role;

create function public.internal_cms_publish(
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
  v_previous public.cms_revisions%rowtype;
  v_ref record;
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

  -- Archive/restore writes take ROW EXCLUSIVE on cms_assets. This lock conflicts
  -- with them, so lifecycle changes and the reference eligibility check are
  -- serialized with the publication transaction.
  lock table public.barbers,public.site_content,public.about_content,public.site_settings,
    public.barber_photos,public.gallery_images,public.email_templates,
    public.cms_email_designs,public.cms_assets in share row exclusive mode;

  select revision into v_head from public.cms_site where id for update;

  -- Preserve the original idempotent replay behavior even if an asset used by
  -- the already-committed request was archived afterwards.
  select * into v_previous
  from public.cms_revisions
  where request_id=p_request_id;

  if found then
    return public.internal_cms_publish_unchecked(
      p_actor,p_document,p_base_revision,p_base_fingerprint,p_request_id
    );
  end if;

  v_before := public.internal_cms_document();

  if v_head<>p_base_revision or md5(v_before::text)<>p_base_fingerprint then
    raise exception 'CMS content changed; review the newer revision before publishing'
      using errcode='40001';
  end if;

  -- Archived resources may remain in the current public head/history, but an
  -- archived resource may not be introduced into a new placement.
  for v_ref in
    with incoming as (
      select * from public.internal_cms_document_media(p_document)
    ),
    current_head as (
      select * from public.internal_cms_document_media(v_before)
    )
    select incoming.bucket,incoming.path
    from incoming
    where not exists (
      select 1
      from current_head
      where current_head.bucket=incoming.bucket
        and current_head.path=incoming.path
    )
  loop
    if not exists (
      select 1
      from public.cms_assets asset
      where asset.bucket=v_ref.bucket
        and asset.path=v_ref.path
        and not asset.archived
    ) then
      raise exception 'New CMS media must be active before publication'
        using errcode='22023';
    end if;
  end loop;

  return public.internal_cms_publish_unchecked(
    p_actor,p_document,p_base_revision,p_base_fingerprint,p_request_id
  );
end $$;
revoke all on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
from public,anon,authenticated;
grant execute on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
to service_role;

comment on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid) is
'Publishes a validated CMS document while serializing asset lifecycle changes. Newly introduced media must be active; already-public archived references may remain.';

commit;
