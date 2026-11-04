begin;
select plan(11);
update public.cms_site set revision = 124, presentation = jsonb_build_object(
  'copy', '{}'::jsonb,
  'styles', '{}'::jsonb,
  'images', '{}'::jsonb,
  'regions', '{}'::jsonb,
  'themes', jsonb_build_object('light', jsonb_build_object('text', '#111111'), 'dark', '{}'::jsonb),
  'fonts', jsonb_build_object(
    '30000000-0000-4000-8000-000000000001', jsonb_build_object('name', 'Ägarens typsnitt')
  ),
  'pages', jsonb_build_array(
    jsonb_build_object('path', '/contact', 'title', jsonb_build_object('sv', 'Kontakt', 'en', 'Contact')),
    jsonb_build_object('path', '/hemsida', 'content', repeat('x', 100000))
  )
);
select ok(has_function_privilege('anon', 'public.public_cms_page(text)', 'EXECUTE'),
  'anonymous visitors may read one published page');
select ok(not exists (
  select 1
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) acl
  where p.oid = 'public.public_cms_page(text)'::regprocedure
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
), 'PUBLIC holds no execute grant');
select ok((select p.prosecdef and 'search_path=""' = any(p.proconfig)
  from pg_proc p where p.oid = 'public.public_cms_page(text)'::regprocedure),
  'runs as its owner with an empty search_path, like public_cms_presentation');
select is(public.public_cms_page('/contact') -> 'page' ->> 'path', '/contact', 'returns the requested page');
select is(public.public_cms_page('/contact') ->> 'revision', '124', 'uses the current publication');
select is(public.public_cms_page('/contact') -> 'themes' -> 'light' ->> 'text', '#111111',
  'carries the themes the page renders with');
select is(public.public_cms_page('/contact') -> 'fonts' -> '30000000-0000-4000-8000-000000000001' ->> 'name',
  'Ägarens typsnitt', 'carries the uploaded fonts');
select ok(octet_length(public.public_cms_page('/contact')::text) < 1000, 'never includes another page');
select is(public.public_cms_page('/missing'), null::jsonb, 'a missing page returns null');
update public.cms_site set presentation = presentation - 'fonts';
select is(public.public_cms_page('/contact') -> 'fonts', 'null'::jsonb,
  'a publication without uploaded fonts answers null fonts');
set local role anon;
select is(public.public_cms_page('/contact') -> 'page' ->> 'path', '/contact', 'an anonymous call reads it');
reset role;
select * from finish();
rollback;
