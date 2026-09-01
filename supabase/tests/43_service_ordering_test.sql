-- pgTAP — per-barber service ordering.
-- Ordering is zero-based and contiguous. All order-changing operations must use the authorized
-- RPCs so a failed or concurrent browser request cannot leave a half-swap.

begin;
select plan(28);

insert into auth.users (id, email)
values
  ('43000000-0000-4000-8000-000000000001', 'ordering-owner@knc.local'),
  ('43000000-0000-4000-8000-000000000002', 'ordering-barber@knc.local');
insert into public.barbers (id, name)
values ('ordering-hassan', 'Hassan'), ('ordering-victor', 'Victor');
insert into public.profiles (id, role, barber_id)
values
  ('43000000-0000-4000-8000-000000000001', 'owner', null),
  ('43000000-0000-4000-8000-000000000002', 'barber', 'ordering-hassan');

insert into public.services (id, barber_id, name, price, duration_min, sort_order)
values
  ('43000000-0000-4000-8000-000000000011', 'ordering-hassan', 'Order A', 101, 45, 0),
  ('43000000-0000-4000-8000-000000000012', 'ordering-hassan', 'Order B', 102, 45, 1),
  ('43000000-0000-4000-8000-000000000013', 'ordering-hassan', 'Order C', 103, 45, 2);

create or replace function pg_temp.call_create_service(
  p_barber_id text,
  p_name text,
  p_price numeric,
  p_duration_min integer,
  p_active boolean,
  p_available_weekdays smallint[]
) returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  if pg_catalog.to_regprocedure(
    'public.admin_create_service(text,text,numeric,integer,boolean,smallint[])'
  ) is null then
    return null;
  end if;
  execute 'select public.admin_create_service($1, $2, $3, $4, $5, $6)'
    into v_result
    using p_barber_id, p_name, p_price, p_duration_min, p_active, p_available_weekdays;
  return v_result;
end;
$$;

create or replace function pg_temp.call_delete_service(p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  if pg_catalog.to_regprocedure('public.admin_delete_service(uuid)') is null then
    return null;
  end if;
  execute 'select public.admin_delete_service($1)' into v_result using p_id;
  return v_result;
end;
$$;

create or replace function pg_temp.call_reorder_service(
  p_barber_id text,
  p_service_id uuid,
  p_direction integer
) returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  if pg_catalog.to_regprocedure('public.admin_reorder_service(text,uuid,integer)') is null then
    return null;
  end if;
  execute 'select public.admin_reorder_service($1, $2, $3)'
    into v_result
    using p_barber_id, p_service_id, p_direction;
  return v_result;
end;
$$;

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_barber_sort_order_key'
      and contype = 'u'
  ),
  'services has a per-barber unique sort-order constraint'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.admin_create_service(text,text,numeric,integer,boolean,smallint[])'
  ) is not null,
  'authorized service creation RPC exists'
);
select ok(
  pg_catalog.to_regprocedure('public.admin_delete_service(uuid)') is not null,
  'authorized service deletion RPC exists'
);
select ok(
  pg_catalog.to_regprocedure('public.admin_reorder_service(text,uuid,integer)') is not null,
  'authorized service reorder RPC exists'
);

select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.admin_create_service(text,text,numeric,integer,boolean,smallint[])'
    ) is null then false
    else pg_catalog.has_function_privilege(
      'authenticated',
      'public.admin_create_service(text,text,numeric,integer,boolean,smallint[])',
      'execute'
    )
  end,
  'authenticated can execute service creation RPC'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.admin_create_service(text,text,numeric,integer,boolean,smallint[])'
    ) is null then false
    else not pg_catalog.has_function_privilege(
      'anon',
      'public.admin_create_service(text,text,numeric,integer,boolean,smallint[])',
      'execute'
    )
  end,
  'anon cannot execute service creation RPC'
);
select ok(
  case
    when pg_catalog.to_regprocedure('public.admin_delete_service(uuid)') is null then false
    else not pg_catalog.has_function_privilege('anon', 'public.admin_delete_service(uuid)', 'execute')
  end,
  'anon cannot execute service deletion RPC'
);
select ok(
  case
    when pg_catalog.to_regprocedure('public.admin_reorder_service(text,uuid,integer)') is null then false
    else not pg_catalog.has_function_privilege(
      'anon',
      'public.admin_reorder_service(text,uuid,integer)',
      'execute'
    )
  end,
  'anon cannot execute service reorder RPC'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '43000000-0000-4000-8000-000000000001')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$insert into public.services (barber_id, name, price, duration_min) values ('ordering-hassan', 'Direct', 1, 45)$$,
  '42501', null,
  'authenticated cannot insert a service directly and choose its order'
);
select throws_ok(
  $$update public.services set sort_order = 99 where id = '43000000-0000-4000-8000-000000000011'$$,
  '42501', null,
  'authenticated cannot update sort_order directly'
);
select throws_ok(
  $$delete from public.services where id = '43000000-0000-4000-8000-000000000011'$$,
  '42501', null,
  'authenticated cannot delete a service directly and skip compaction'
);

select is(
  (pg_temp.call_create_service('ordering-hassan', 'Order D', 104.50, 45, true, array[0,1,2,3,4,5,6]::smallint[]) ->> 'ok'),
  'true',
  'authorized creation succeeds'
);
select is(
  (select sort_order from public.services where name = 'Order D' and barber_id = 'ordering-hassan'),
  3,
  'authorized creation appends at the next per-barber position'
);
select is(
  (select array_agg(sort_order order by sort_order)::text from public.services where barber_id = 'ordering-hassan'),
  '{0,1,2,3}',
  'creation preserves zero-based contiguous ordering'
);

select is(
  (pg_temp.call_reorder_service(
    'ordering-hassan', '43000000-0000-4000-8000-000000000013', -1
  )->>'ok'),
  'true',
  'authorized reorder succeeds atomically'
);
select is(
  (select array_agg(name order by sort_order)
     from public.services
    where barber_id = 'ordering-hassan' and name like 'Order %'),
  array['Order A', 'Order C', 'Order B', 'Order D'],
  'reorder response leaves the requested services in the expected order'
);
select is(
  (select sort_order from public.services where id = '43000000-0000-4000-8000-000000000013'),
  1,
  'reorder moves only the requested service by one position'
);

select is(
  (pg_temp.call_reorder_service(
    'ordering-hassan', '43000000-0000-4000-8000-000000000013', 0
  )->>'error'),
  'invalid',
  'an invalid direction is rejected without a partial swap'
);
select is(
  (select array_agg(sort_order order by sort_order)::text from public.services where barber_id = 'ordering-hassan'),
  '{0,1,2,3}',
  'a rejected reorder leaves every position unchanged'
);

select is(
  (pg_temp.call_reorder_service(
    'ordering-hassan', '43000000-0000-0000-0000-000000000099', -1
  )->>'error'),
  'not_found',
  'reordering a missing service is rejected'
);

select is(
  (pg_temp.call_delete_service('43000000-0000-4000-8000-000000000011')->>'ok'),
  'true',
  'authorized deletion succeeds'
);
select is(
  (select array_agg(sort_order order by sort_order)::text from public.services where barber_id = 'ordering-hassan'),
  '{0,1,2}',
  'deletion compacts all remaining per-barber positions'
);
select is(
  (pg_temp.call_create_service('ordering-hassan', 'Order E', 105, 45, true, array[0,1,2,3,4,5,6]::smallint[]) ->> 'ok'),
  'true',
  'creation after deletion succeeds'
);
select is(
  (select sort_order from public.services where name = 'Order E' and barber_id = 'ordering-hassan'),
  3,
  'creation after deletion does not reuse a duplicate position'
);

select is(
  (pg_temp.call_create_service('ordering-victor', 'Victor Order', 106, 45, true, array[0,1,2,3,4,5,6]::smallint[]) ->> 'ok'),
  'true',
  'the same RPC maintains an independent barber order'
);
select is(
  (select sort_order from public.services where name = 'Victor Order' and barber_id = 'ordering-victor'),
  0,
  'the independent barber order appends from zero'
);

reset role;
select throws_ok(
  $$insert into public.services (barber_id, name, price, duration_min, sort_order)
    values ('ordering-hassan', 'Duplicate', 107, 45, 0)$$,
  '23505', null,
  'the unique constraint rejects duplicate positions'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '43000000-0000-4000-8000-000000000002')::text,
  true
);
set local role authenticated;
select is(
  (pg_temp.call_reorder_service(
    'ordering-victor', '43000000-0000-0000-0000-000000000099', -1
  )->>'error'),
  'forbidden',
  'a barber cannot reorder another barber''s services'
);

select * from finish();
rollback;
