begin;
select plan(4);

select results_eq(
  $$
    select
      c.oid::regclass::text || ':' ||
      coalesce(r.rolname, 'PUBLIC') || ':' ||
      a.privilege_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) a
    left join pg_catalog.pg_roles r on r.oid = a.grantee
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))
      and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    order by 1
  $$,
  $$select null::text where false$$,
  'API roles and PUBLIC have no RLS-bypassing or schema-mutation table privileges'
);

select results_eq(
  $$
    select
      owner_role.rolname || ':' ||
      coalesce(grantee_role.rolname, 'PUBLIC') || ':' ||
      a.privilege_type
    from pg_catalog.pg_default_acl d
    join pg_catalog.pg_roles owner_role on owner_role.oid = d.defaclrole
    join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    left join pg_catalog.pg_roles grantee_role on grantee_role.oid = a.grantee
    where n.nspname = 'public'
      and d.defaclobjtype = 'r'
      and owner_role.rolname = 'postgres'
      and (a.grantee = 0 or grantee_role.rolname in ('anon', 'authenticated', 'service_role'))
      and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    order by 1
  $$,
  $$select null::text where false$$,
  'future public tables inherit no dangerous API-role privileges'
);

select ok(
  has_function_privilege('anon', 'public.public_business_discovery()', 'EXECUTE'),
  'privilege hardening preserves intentional public discovery access'
);
select ok(
  has_function_privilege('service_role', 'public.claim_external_action(uuid)', 'EXECUTE'),
  'privilege hardening preserves narrow service-role worker access'
);

select * from finish();
rollback;
