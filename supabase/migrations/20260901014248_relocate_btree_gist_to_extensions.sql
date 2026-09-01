-- Supabase's advisor reports btree_gist in public. The extension is relocatable in the current
-- local/live catalog (1.7), and a local transaction verified that the sole bookings overlap
-- constraint remains enforced after moving its operator classes to extensions.
do $$
declare
  v_schema_name text;
  v_relocatable boolean;
begin
  select n.nspname, e.extrelocatable
    into v_schema_name, v_relocatable
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if v_schema_name is null then
    raise exception 'btree_gist extension is required';
  end if;
  if v_schema_name = 'extensions' then
    return;
  end if;
  if not v_relocatable then
    raise exception 'btree_gist extension is not relocatable';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_namespace
    where nspname = 'extensions'
  ) then
    raise exception 'extensions schema is required for btree_gist relocation';
  end if;

  execute 'alter extension btree_gist set schema extensions';
end;
$$;
