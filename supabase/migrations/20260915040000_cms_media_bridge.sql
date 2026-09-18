-- Keep old editors operational while the new studio uses immutable media references.
begin;

create function public.internal_cms_register_storage_object() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket_id in ('gallery','barber-photos','cms-library')
     and new.name ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,239}$'
     and new.name not like '%..%' and new.name not like '%//%' then
    insert into public.cms_assets(bucket,path,name,mime,bytes)
    values(new.bucket_id,new.name,right(new.name,160),coalesce(new.metadata->>'mimetype','application/octet-stream'),
      case when new.metadata->>'size' ~ '^[0-9]{1,14}$' then (new.metadata->>'size')::bigint else 0 end)
    on conflict(bucket,path) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.internal_cms_register_storage_object() from public,anon,authenticated,service_role;
create trigger cms_register_uploaded_object after insert on storage.objects
for each row execute function public.internal_cms_register_storage_object();

create function public.internal_cms_missing_media(p_actor uuid,p_references jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.internal_cms_assert_owner(p_actor);
  if jsonb_typeof(p_references) is distinct from 'array' or jsonb_array_length(p_references)>10000 then
    raise exception 'Invalid media references' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(r.ref) from jsonb_array_elements(p_references) as r(ref)
    where not exists(select 1 from public.cms_assets a where a.bucket=r.ref->>'bucket' and a.path=r.ref->>'path')
       or not exists(select 1 from storage.objects o where o.bucket_id=r.ref->>'bucket' and o.name=r.ref->>'path')
  ),'[]'::jsonb);
end $$;
revoke all on function public.internal_cms_missing_media(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_cms_missing_media(uuid,jsonb) to service_role;

comment on table public.cms_assets is 'Immutable media registry. During parallel rollout legacy editors remove placements, not retained library bytes. Archive unused files in the studio; garbage collection is a separate reviewed maintenance operation.';
commit;
