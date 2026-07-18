-- admin_purge_history — owner-only bulk delete of all non-live booking history.
--
-- WHY: over time the bookings table accumulates rows that are no longer live appointments — cancelled
-- bookings and confirmed bookings whose start is already in the past. The panel needs a single
-- "clear history" action to purge them all at once (data minimisation / a clean list) while NEVER
-- touching an upcoming confirmed appointment. Runs SECURITY DEFINER (RLS-bypassing) so authority is
-- re-derived from auth.uid() via is_owner(), like admin_cancel_booking (0006). A purged booking's
-- review (reviews.booking_id -> ON DELETE SET NULL, 0012) survives, detached.
--
-- Errors:
--   forbidden — caller is not the owner (also when unauthenticated: is_owner() is false).
create or replace function public.admin_purge_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- History = every booking that is not a live upcoming appointment: any cancelled row, plus any
  -- confirmed row that has already started (start_at < now). Upcoming confirmed rows are preserved.
  delete from public.bookings
  where status = 'cancelled'
     or (status = 'confirmed' and start_at < pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- Least privilege: strip PUBLIC execute, expose to authenticated (the owner acts via their Auth session).
revoke execute on function public.admin_purge_history() from public;
-- Also revoke anon's Supabase default-privilege EXECUTE grant (revoke-from-public leaves it; see 0019).
revoke execute on function public.admin_purge_history() from anon;
grant  execute on function public.admin_purge_history() to authenticated;
