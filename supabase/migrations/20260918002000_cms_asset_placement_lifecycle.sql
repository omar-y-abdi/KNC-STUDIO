-- Preserve placement identity when enforcing archived CMS asset lifecycle.
begin;

create function public.internal_cms_document_media_placements(p_document jsonb)
returns table(placement text,bucket text,path text)
language sql stable security definer set search_path = '' as $$
with
images as (
  select
    'presentation.images:' || entry.key as placement,
    entry.value #>> '{ref,bucket}' as bucket,
    entry.value #>> '{ref,path}' as path
  from jsonb_each(
    case
      when jsonb_typeof(p_document #> '{presentation,images}')='object'
        then p_document #> '{presentation,images}'
      else '{}'::jsonb
    end
  ) as entry(key,value)
),
fonts as (
  select
    'presentation.fonts:' || entry.key,
    entry.value #>> '{ref,bucket}',
    entry.value #>> '{ref,path}'
  from jsonb_each(
    case
      when jsonb_typeof(p_document #> '{presentation,fonts}')='object'
        then p_document #> '{presentation,fonts}'
      else '{}'::jsonb
    end
  ) as entry(key,value)
),
gallery as (
  select
    'gallery:' || (image.value->>'id'),
    'gallery',
    image.value->>'storage_path'
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_document->'gallery')='array' then p_document->'gallery'
      else '[]'::jsonb
    end
  ) as image(value)
),
photos as (
  select
    'photos:' || photo.key,
    'barber-photos',
    photo.value
  from jsonb_each_text(
    case
      when jsonb_typeof(p_document->'photos')='object' then p_document->'photos'
      else '{}'::jsonb
    end
  ) as photo(key,value)
),
homepage_logo as (
  select
    'settings:homepage_logo_path',
    'gallery',
    p_document #>> '{settings,homepage_logo_path}'
  where coalesce(p_document #>> '{settings,homepage_logo_path}','')<>''
),
email_logos as (
  select
    'emails:' || (email.value->>'template') || ':' || (email.value->>'lang') || ':logo',
    email.value #>> '{design,logo,bucket}',
    email.value #>> '{design,logo,path}'
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_document->'emails')='array' then p_document->'emails'
      else '[]'::jsonb
    end
  ) as email(value)
  where jsonb_typeof(email.value #> '{design,logo}')='object'
),
pages as (
  select page.value
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_document #> '{presentation,pages}')='array'
        then p_document #> '{presentation,pages}'
      else '[]'::jsonb
    end
  ) as page(value)
),
regions as (
  select region.key,region.value
  from jsonb_each(
    case
      when jsonb_typeof(p_document #> '{presentation,regions}')='object'
        then p_document #> '{presentation,regions}'
      else '{}'::jsonb
    end
  ) as region(key,value)
),
languages(lang) as (values ('sv'),('en')),
modes(mode) as (values ('light'),('dark')),
markup_source as (
  select
    'presentation.pages:' || (page.value->>'id') || ':' || languages.lang || ':html' as placement,
    page.value #>> array['content',languages.lang,'html'] as source
  from pages page
  cross join languages

  union all

  select
    'presentation.pages:' || (page.value->>'id') || ':' || languages.lang || ':css:' || modes.mode,
    page.value #>> array['content',languages.lang,'css',modes.mode]
  from pages page
  cross join languages
  cross join modes

  union all

  select
    'presentation.regions:' || region.key || ':' || languages.lang || ':html',
    region.value #>> array[languages.lang,'html']
  from regions region
  cross join languages

  union all

  select
    'presentation.regions:' || region.key || ':' || languages.lang || ':css:' || modes.mode,
    region.value #>> array[languages.lang,'css',modes.mode]
  from regions region
  cross join languages
  cross join modes
),
markup as (
  select
    source.placement || ':' || match.ordinality::text as placement,
    (match.parts)[1] as bucket,
    (match.parts)[2] as path
  from markup_source source
  cross join lateral regexp_matches(
    source.source,
    '/storage/v1/object/public/(gallery|barber-photos|cms-library)/([a-zA-Z0-9][a-zA-Z0-9_./-]{0,239})',
    'g'
  ) with ordinality as match(parts,ordinality)
),
refs as (
  select * from images
  union all select * from fonts
  union all select * from gallery
  union all select * from photos
  union all select * from homepage_logo
  union all select * from email_logos
  union all select * from markup
)
select distinct refs.placement,refs.bucket,refs.path
from refs
where refs.placement is not null
  and refs.bucket in ('gallery','barber-photos','cms-library')
  and refs.path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$'
  and refs.path not like '%..%'
  and refs.path not like '%//%';
$$;

revoke all on function public.internal_cms_document_media_placements(jsonb)
from public,anon,authenticated,service_role;

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

  lock table public.barbers,public.site_content,public.about_content,public.site_settings,
    public.barber_photos,public.gallery_images,public.email_templates,
    public.cms_email_designs,public.cms_assets in share row exclusive mode;

  select revision into v_head from public.cms_site where id for update;

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

  for v_ref in
    with incoming as (
      select * from public.internal_cms_document_media_placements(p_document)
    ),
    current_head as (
      select * from public.internal_cms_document_media_placements(v_before)
    )
    select incoming.placement,incoming.bucket,incoming.path
    from incoming
    where not exists (
      select 1
      from current_head
      where current_head.placement=incoming.placement
        and current_head.bucket=incoming.bucket
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
      raise exception 'New CMS media placements must use active assets'
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
'Publishes a validated CMS document while serializing asset lifecycle changes. Archived media may remain only in placements already present in the authoritative head.';

commit;
