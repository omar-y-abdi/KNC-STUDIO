-- Retire the secret-bearing Dashboard Database Webhook from #43.
--
-- This is intentionally forward-only. The guard prevents applying the retirement before the
-- migration-owned Calendar trigger and durable external-action executor are available. Production
-- deployment, canonical WEBHOOK_SECRET rotation, and Edge/Vault parity verification remain
-- action-time operator steps; this file does not perform any secret maintenance.

do $$
begin
  if to_regclass('public.external_action_jobs') is null
     or to_regprocedure('public.queue_calendar_event_sync(uuid)') is null
     or to_regprocedure('public.queue_booking_calendar_sync()') is null
     or to_regprocedure('public.external_action_for_dispatch(uuid, uuid)') is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.bookings'::regclass
         and t.tgname = 'booking_calendar_sync_on_change'
         and t.tgfoid = 'public.queue_booking_calendar_sync()'::regprocedure
         and not t.tgisinternal
     ) then
    raise exception using
      errcode = '55000',
      message = 'durable Calendar trigger/outbox is not ready for legacy webhook retirement';
  end if;
end;
$$;

drop trigger if exists calendar_sync_on_bookings on public.bookings;
