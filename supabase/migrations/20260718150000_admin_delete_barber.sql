-- admin_delete_barber — hard-delete a barber from the roster, optionally purging their bookings.
--
-- WHY: "removing" a barber has so far meant a SOFT delete (barbers.active=false) because
-- bookings.barber_id is ON DELETE RESTRICT (migration 0009) — a barber with history cannot be dropped.
-- The panel also needs a PERMANENT delete: a wrong roster entry, a stylist who left with no bookings,
-- or an explicit "delete everything including their appointment history". This owner-only RPC does that
-- hard delete. It refuses by default when the barber still has bookings, and requires an explicit
-- p_purge_bookings opt-in to also destroy that history.
-- Note: p_purge_bookings=true deletes ALL of this barber's bookings INCLUDING upcoming confirmed
-- appointments. This is intended — the has_bookings refusal splits past/upcoming so the owner opts
-- in knowingly (the UI surfaces the upcoming count before this destructive confirm).
--
-- Authorization is re-derived in SQL (is_owner()) because this runs SECURITY DEFINER (RLS-bypassing),
-- exactly like admin_cancel_booking (0006). The FK graph dictates the delete ORDER:
--   * bookings.barber_id -> ON DELETE RESTRICT (0009): delete FIRST, and only when purging.
--   * profiles.barber_id -> ON DELETE SET NULL (0004): delete the dead barber's login identity
--       explicitly, else dropping the barber would leave an orphan role='barber' profile with a null
--       barber_id (a login that can never resolve to a barber again).
--   * barbers (the row) -> CASCADE clears barber_schedules / barber_time_off / barber_slot_blocks /
--       services / barber_photos (all ON DELETE CASCADE).
-- A purged booking's review (reviews.booking_id -> ON DELETE SET NULL, 0012) survives, detached.
--
-- Errors:
--   forbidden    — caller is not the owner (also when unauthenticated: is_owner() is false).
--   not_found    — no barber with that id.
--   has_bookings — the barber has bookings and p_purge_bookings was not set; returns count/past/upcoming
--                  so the panel can warn ("N bookings, U upcoming") before the destructive opt-in.
create or replace function public.admin_delete_barber(
  p_barber_id      text,
  p_purge_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count    bigint;
  v_upcoming bigint;
  v_past     bigint;
  v_deleted  bigint := 0;
begin
  -- Only the owner may hard-delete a barber.
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- The barber must exist.
  perform 1 from public.barbers b where b.id = p_barber_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Count this barber's bookings (all statuses). "upcoming" = still-confirmed future cuts; the rest
  -- (cancelled + past confirmed) fall into "past" = count - upcoming.
  select pg_catalog.count(*),
         pg_catalog.count(*) filter (where b.status = 'confirmed' and b.start_at >= pg_catalog.now())
    into v_count, v_upcoming
  from public.bookings b
  where b.barber_id = p_barber_id;
  v_past := v_count - v_upcoming;

  -- Refuse to silently destroy history: a barber with bookings requires an explicit purge opt-in.
  if v_count > 0 and not p_purge_bookings then
    return pg_catalog.jsonb_build_object(
      'ok',       false,
      'error',    'has_bookings',
      'count',    v_count,
      'past',     v_past,
      'upcoming', v_upcoming
    );
  end if;

  -- Ordered deletes inside the function's implicit transaction (see header FK graph).
  if p_purge_bookings then
    delete from public.bookings where barber_id = p_barber_id;
    get diagnostics v_deleted = row_count;
  end if;

  delete from public.profiles where barber_id = p_barber_id;
  delete from public.barbers   where id = p_barber_id;

  return pg_catalog.jsonb_build_object('ok', true, 'deleted_bookings', v_deleted);
end;
$$;

-- Least privilege: strip PUBLIC execute, expose to authenticated (the owner acts via their Auth session).
revoke execute on function public.admin_delete_barber(text, boolean) from public;
-- Also revoke anon's Supabase default-privilege EXECUTE grant (revoke-from-public leaves it; see 0019).
revoke execute on function public.admin_delete_barber(text, boolean) from anon;
grant  execute on function public.admin_delete_barber(text, boolean) to authenticated;
