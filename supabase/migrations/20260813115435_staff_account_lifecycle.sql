-- Separate public roster visibility from staff account authorization. `barbers.active` continues to
-- mean "bookable/listed"; this flag is the immediate database authorization boundary for staff.
alter table public.profiles
  add column account_enabled boolean not null default true;

create index profiles_enabled_barber_idx
  on public.profiles (barber_id)
  where role = 'barber' and account_enabled = true and barber_id is not null;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.account_enabled = true;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role = 'owner'
      from public.profiles p
      where p.id = (select auth.uid())
        and p.account_enabled = true
    ),
    false
  );
$$;

create or replace function public.current_barber_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.barber_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.role = 'barber'
    and p.account_enabled = true;
$$;

revoke execute on function public.current_role() from public, anon;
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.current_barber_id() from public, anon;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.current_barber_id() to authenticated;

-- Owner-only authorization state change. Auth-side banning is coordinated by admin-manage-barber;
-- this database flag is written first on disable so even an already-issued JWT loses RLS access.
create or replace function public.admin_set_barber_account_enabled(
  p_barber_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.profiles p
  set account_enabled = p_enabled
  where p.role = 'barber'
    and p.barber_id = p_barber_id
  returning p.id into v_user_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'account_enabled', p_enabled
  );
end;
$$;

revoke execute on function public.admin_set_barber_account_enabled(text, boolean)
  from public, anon;
grant execute on function public.admin_set_barber_account_enabled(text, boolean)
  to authenticated;

-- Hard deletion is data maintenance, never an appointment-resolution path. Active/future confirmed
-- bookings must first be reassigned or cancelled through their normal lifecycle.
create or replace function public.admin_delete_barber(
  p_barber_id text,
  p_purge_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_upcoming bigint;
  v_past bigint;
  v_deleted bigint := 0;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform 1 from public.barbers b where b.id = p_barber_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where b.status = 'confirmed' and b.end_at > pg_catalog.now()
         )
    into v_count, v_upcoming
  from public.bookings b
  where b.barber_id = p_barber_id;
  v_past := v_count - v_upcoming;

  if v_upcoming > 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'has_upcoming',
      'count', v_count,
      'past', v_past,
      'upcoming', v_upcoming
    );
  end if;

  if v_count > 0 and not p_purge_bookings then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'has_bookings',
      'count', v_count,
      'past', v_past,
      'upcoming', v_upcoming
    );
  end if;

  if p_purge_bookings then
    delete from public.bookings
    where barber_id = p_barber_id
      and not (status = 'confirmed' and end_at > pg_catalog.now());
    get diagnostics v_deleted = row_count;
  end if;

  delete from public.profiles where barber_id = p_barber_id;
  delete from public.barbers where id = p_barber_id;

  return pg_catalog.jsonb_build_object('ok', true, 'deleted_bookings', v_deleted);
end;
$$;

revoke execute on function public.admin_delete_barber(text, boolean) from public, anon;
grant execute on function public.admin_delete_barber(text, boolean) to authenticated;
