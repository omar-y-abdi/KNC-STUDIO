-- Keep native HTML requests independent of the size of the editor snapshots.
begin;
create or replace function public.public_cms_page_metadata(p_path text, p_lang text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'revision', s.revision,
    'title', p -> 'title' ->> p_lang,
    'description', p -> 'description' ->> p_lang
  )
  from public.cms_site s, lateral jsonb_array_elements(s.presentation -> 'pages') p
  where s.id and p ->> 'path' = p_path and p_lang in ('sv', 'en')
  limit 1;
$$;
revoke all on function public.public_cms_page_metadata(text,text) from public;
grant execute on function public.public_cms_page_metadata(text,text) to anon, authenticated, service_role;
commit;
