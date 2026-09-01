-- Normalize existing rows before adding the invariant. The ranking is deterministic for equal
-- legacy positions, and the temporary negative values avoid depending on the old gaps/duplicates.
with ranked as (
  select
    id,
    row_number() over (partition by barber_id order by sort_order, id)::integer - 1 as new_order
  from public.services
)
update public.services s
   set sort_order = -ranked.new_order - 1
  from ranked
 where s.id = ranked.id;

update public.services
   set sort_order = -sort_order - 1;

alter table public.services
  add constraint services_barber_sort_order_key unique (barber_id, sort_order);

-- Service creation/deletion/reordering are cross-row operations and therefore no longer use direct
-- browser writes. Ordinary edits retain RLS on the non-order fields; the three RPCs below own the
-- per-barber ordering lock and all compaction.
revoke insert, delete, update on table public.services from public, anon, authenticated;
grant update (name, price, duration_min, active, available_weekdays)
  on table public.services to authenticated;

create function public.admin_create_service(
  p_barber_id text,
  p_name text,
  p_price numeric,
  p_duration_min integer,
  p_active boolean,
  p_available_weekdays smallint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_next_order integer;
  v_row public.services;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if pg_catalog.char_length(v_name) not between 1 and 80
     or p_price is null
     or p_price < 0
     or p_price > 100000
     or p_price <> pg_catalog.trunc(p_price, 2)
     or p_duration_min is null
     or p_duration_min not between 5 and 600
     or p_active is null
     or p_available_weekdays is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('service-order:' || p_barber_id, 0)
  );

  select coalesce(max(s.sort_order) + 1, 0)
    into v_next_order
    from public.services s
   where s.barber_id = p_barber_id;

  begin
    insert into public.services (
      barber_id, name, price, duration_min, active, sort_order, available_weekdays
    ) values (
      p_barber_id, v_name, p_price, p_duration_min, p_active, v_next_order, p_available_weekdays
    )
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate');
    when check_violation or foreign_key_violation or not_null_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'row', pg_catalog.to_jsonb(v_row));
end;
$$;

create function public.admin_delete_service(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barber_id text;
  v_count integer;
begin
  select s.barber_id into v_barber_id
  from public.services s
  where s.id = p_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not coalesce(public.is_owner() or v_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('service-order:' || v_barber_id, 0)
  );

  delete from public.services where id = p_id;

  select count(*) into v_count
  from public.services s
  where s.barber_id = v_barber_id;

  -- Move every remaining row to a disjoint range first. This keeps the immediate unique constraint
  -- valid while compaction shifts positions toward zero.
  update public.services s
     set sort_order = s.sort_order + v_count + 1
   where s.barber_id = v_barber_id;

  with ranked as (
    select
      id,
      row_number() over (order by sort_order, id)::integer - 1 as new_order
    from public.services
    where barber_id = v_barber_id
  )
  update public.services s
     set sort_order = ranked.new_order
    from ranked
   where s.id = ranked.id;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create function public.admin_reorder_service(
  p_barber_id text,
  p_service_id uuid,
  p_direction integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_position integer;
  v_target integer;
  v_count integer;
  v_swap uuid;
  v_index integer;
  v_services jsonb;
begin
  if not coalesce(public.is_owner() or p_barber_id = public.current_barber_id(), false) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_direction not in (-1, 1) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('service-order:' || p_barber_id, 0)
  );

  select pg_catalog.array_agg(locked.id order by locked.sort_order, locked.id)
    into v_ids
    from (
      select s.id, s.sort_order
      from public.services s
      where s.barber_id = p_barber_id
      order by s.sort_order, s.id
      for update
    ) locked;

  v_count := coalesce(pg_catalog.array_length(v_ids, 1), 0);
  v_position := pg_catalog.array_position(v_ids, p_service_id);
  if v_position is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_target := v_position + p_direction;
  if v_target < 1 or v_target > v_count then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_swap := v_ids[v_position];
  v_ids[v_position] := v_ids[v_target];
  v_ids[v_target] := v_swap;

  -- The unique constraint must hold throughout the transaction, so use a disjoint temporary range
  -- before assigning the swapped zero-based positions.
  update public.services s
     set sort_order = s.sort_order + v_count + 1
   where s.barber_id = p_barber_id;

  for v_index in 1..v_count loop
    update public.services s
       set sort_order = v_index - 1
     where s.id = v_ids[v_index];
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.sort_order, s.id),
    '[]'::jsonb
  )
    into v_services
    from public.services s
   where s.barber_id = p_barber_id;

  return pg_catalog.jsonb_build_object('ok', true, 'services', v_services);
end;
$$;

revoke execute on function public.admin_create_service(text, text, numeric, integer, boolean, smallint[])
  from public, anon;
revoke execute on function public.admin_delete_service(uuid) from public, anon;
revoke execute on function public.admin_reorder_service(text, uuid, integer) from public, anon;
grant execute on function public.admin_create_service(text, text, numeric, integer, boolean, smallint[])
  to authenticated;
grant execute on function public.admin_delete_service(uuid) to authenticated;
grant execute on function public.admin_reorder_service(text, uuid, integer) to authenticated;
