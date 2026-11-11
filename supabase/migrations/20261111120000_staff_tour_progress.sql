-- Staff tutorial progress: per account, the tours already seen and whether the tutorial was
-- removed. Closed to every API role, so the two functions below are the only way in and each
-- session reaches only its own row.

-- The foreign key blocks writes to profiles until commit: give up after 5 s, changing nothing.
set lock_timeout = '5s';

create table if not exists public.staff_tour_progress (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  seen       text[] not null default '{}',
  removed    boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint staff_tour_progress_seen_check check (
    seen <@ array['overview', 'schedule', 'bookings', 'services', 'profile']
    and pg_catalog.cardinality(seen) <= 5
    and coalesce(pg_catalog.array_ndims(seen), 1) = 1
  )
);

alter table public.staff_tour_progress enable row level security;
revoke all on table public.staff_tour_progress from public, anon, authenticated, service_role;

create or replace function public.own_staff_tour_progress()
returns table (seen text[], removed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.seen, p.removed
  from public.staff_tour_progress p
  where p.profile_id = (select auth.uid());
$$;

revoke all on function public.own_staff_tour_progress()
  from public, anon, authenticated, service_role;
grant execute on function public.own_staff_tour_progress()
  to authenticated;

create or replace function public.set_own_staff_tour_progress(p_seen text[], p_removed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
begin
  if v_profile is null then
    raise exception using errcode = '42501', message = 'sign-in required';
  end if;

  insert into public.staff_tour_progress (profile_id, seen, removed, updated_at)
  values (v_profile, p_seen, p_removed, pg_catalog.now())
  on conflict (profile_id) do update
  set seen = excluded.seen,
      removed = excluded.removed,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_own_staff_tour_progress(text[], boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_own_staff_tour_progress(text[], boolean)
  to authenticated;

reset lock_timeout;
