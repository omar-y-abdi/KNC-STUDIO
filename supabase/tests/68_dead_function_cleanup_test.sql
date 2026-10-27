begin;
select plan(8);

select hasnt_function('public', 'calendar_deletion_context', array['uuid'],
  'the unused Calendar deletion context RPC is absent');
select hasnt_function('public', 'calendar_forget_event', array['uuid'],
  'the unconditional Calendar map deletion RPC is absent');
select hasnt_function('public', 'calendar_record_event', array['uuid', 'text', 'text'],
  'the legacy Calendar map recording RPC is absent');
select hasnt_function('public', 'internal_cms_document_media', array['jsonb'],
  'the superseded CMS media helper is absent');

select ok(not pg_catalog.has_function_privilege('anon', 'public.current_role()', 'execute'),
  'anon cannot execute the role lookup');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.current_role()', 'execute'),
  'authenticated cannot execute the role lookup');
select ok(not exists (
  select 1
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) acl
  where p.oid = 'public.current_role()'::regprocedure
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
), 'PUBLIC has no execute grant on the role lookup');

select has_function('public', 'internal_cms_document_media_placements', array['jsonb'],
  'the active placement-aware CMS media helper remains present');

select * from finish();
rollback;
