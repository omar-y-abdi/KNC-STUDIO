-- admin_delete_bookings — hard-delete a set of selected bookings from the panel.
--
-- WHY: the booking list needs a "delete selected" that removes rows outright (a mistaken reservation, a
-- cancelled row the owner wants gone), distinct from admin_cancel_booking (0006), which only flips
-- status to 'cancelled'. Deletion is destructive, so it is authorized and history-guarded in SQL
-- (this runs SECURITY DEFINER / RLS-bypassing, so authority is re-derived from auth.uid()).
--
-- Authorization:
--   * the owner may delete ANY booking in the set;
--   * a barber may delete ONLY their own bookings — if ANY requested id is not one of THIS barber's
--     existing bookings, the WHOLE batch is rejected (delete nothing), so a barber can neither touch
--     nor probe another barber's / the owner's rows;
--   * a caller who is neither owner nor barber is forbidden.
-- History guard: a still-upcoming CONFIRMED booking is a live appointment and is never deletable here
-- (cancel it first). If ANY targeted booking is upcoming-confirmed the batch is refused with
-- has_upcoming BEFORE anything is deleted. A deleted booking's review (reviews.booking_id -> ON DELETE
-- SET NULL, 0012) survives, detached.
--
-- Errors:
--   empty        — null or empty id array (nothing to do).
--   forbidden    — caller is not owner/barber, or a barber included an id that is not their own.
--   has_upcoming — at least one targeted booking is confirmed and starts in the future.
create or replace function public.admin_delete_bookings(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner  boolean := public.is_owner();
  v_barber_id text    := public.current_barber_id();
  v_count     bigint;
begin
  -- Nothing selected.
  if pg_catalog.array_length(p_ids, 1) is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  -- Caller must be the owner or a barber.
  if not v_is_owner and v_barber_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- A barber may only delete their OWN bookings: if any requested id is not one of this barber's
  -- existing bookings, reject the whole batch (delete nothing). Robust to duplicate ids.
  if not v_is_owner then
    if exists (
      select 1
      from pg_catalog.unnest(p_ids) as req(id)
      where not exists (
        select 1 from public.bookings b
        where b.id = req.id and b.barber_id = v_barber_id
      )
    ) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;

  -- History guard (checked BEFORE any delete): never delete a still-upcoming confirmed booking.
  if exists (
    select 1 from public.bookings b
    where b.id = any(p_ids)
      and b.status = 'confirmed'
      and b.start_at >= pg_catalog.now()
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'has_upcoming');
  end if;

  -- Authorized and no upcoming in the set: delete. (A barber reached here only with their own ids.)
  -- Belt-and-suspenders: re-exclude upcoming-confirmed in the predicate too, closing a guard->delete TOCTOU race.
  delete from public.bookings where id = any(p_ids) and not (status = 'confirmed' and start_at >= pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Least privilege: strip PUBLIC execute, expose to authenticated (owner/barber act via their session).
revoke execute on function public.admin_delete_bookings(uuid[]) from public;
-- Also revoke anon's Supabase default-privilege EXECUTE grant (revoke-from-public leaves it; see 0019).
revoke execute on function public.admin_delete_bookings(uuid[]) from anon;
grant  execute on function public.admin_delete_bookings(uuid[]) to authenticated;
