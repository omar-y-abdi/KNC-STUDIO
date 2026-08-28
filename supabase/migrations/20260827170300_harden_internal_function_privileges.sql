-- Hosted Supabase can retain explicit anon/authenticated EXECUTE ACL entries even when an older
-- migration revoked the default PUBLIC grant. Revoke every browser-facing role explicitly, then
-- restore only the narrow runtime grants each function requires.
--
-- Forward-only security hardening: restoring public execution is not a safe rollback.

revoke execute on function public.admin_cancel_booking(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_booking(uuid) to authenticated;

revoke execute on function public.mark_booking_reminder_delivered(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_booking_reminder_delivered(uuid) to service_role;

revoke execute on function public.queue_due_booking_reminders()
  from public, anon, authenticated, service_role;
revoke execute on function public.queue_booking_reminder_after_insert()
  from public, anon, authenticated, service_role;
revoke execute on function public.queue_booking_confirmation()
  from public, anon, authenticated, service_role;

-- rls_auto_enable() is supplied by hosted Supabase and is absent from the local stack. Event
-- triggers execute as their owner and do not require Data API roles to call their function.
do $$
begin
  if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end;
$$;
