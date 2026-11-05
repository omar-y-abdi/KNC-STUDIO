-- One published page with the themes and fonts it renders with, so the Worker answers /contact
-- without reading the whole presentation. It exposes a subset of public_cms_presentation, with the
-- same visibility and grants.
begin;
create or replace function public.public_cms_page(p_path text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'revision', s.revision,
    'page', p,
    'themes', s.presentation -> 'themes',
    'fonts', s.presentation -> 'fonts'
  )
  from public.cms_site s, lateral jsonb_array_elements(s.presentation -> 'pages') p
  where s.id and p ->> 'path' = p_path
  limit 1;
$$;
revoke all on function public.public_cms_page(text) from public, anon, authenticated;
grant execute on function public.public_cms_page(text) to anon, authenticated, service_role;
commit;
