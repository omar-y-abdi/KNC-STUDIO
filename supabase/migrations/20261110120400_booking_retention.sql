-- Deletes bookings whose appointment ended over 12 months ago, 500 a night, with the same triggers
-- and cascades as admin_purge_history; from the first run that includes those already stored. A
-- failed e-mail of such a booking is first marked skipped (it leaves the owner's retry list); a
-- pending or dispatching one keeps its booking.

create or replace function public.internal_purge_expired_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := pg_catalog.now() - interval '12 months';
  v_ids uuid[];
  v_count integer;
begin
  -- A failed e-mail waits for the owner and would hold its booking for ever: past the cutoff,
  -- dismiss it as admin_discard_failed_booking_email_delivery does.
  update public.booking_email_delivery_jobs j
  set status = 'skipped',
      completed_at = pg_catalog.now()
  from public.bookings b
  where b.id = j.booking_id
    and b.end_at < v_cutoff
    and j.status = 'failed';

  -- The row lock keeps new delivery jobs out: only a trigger on this row creates one. 'failed'
  -- stays listed so bookings_prevent_unresolved_email_delete never refuses a row selected here.
  with locked as (
    select b.id
    from public.bookings b
    where b.end_at < v_cutoff
      and not exists (
        select 1
        from public.booking_email_delivery_jobs j
        where j.booking_id = b.id
          and j.status in ('pending', 'dispatching', 'failed')
      )
    order by b.end_at, b.id
    limit 500
    for update of b skip locked
  )
  select coalesce(pg_catalog.array_agg(locked.id), '{}'::uuid[]) into v_ids
  from locked;

  delete from public.bookings b
  where b.id = any (v_ids)
    and b.end_at < v_cutoff
    and not exists (
      select 1
      from public.booking_email_delivery_jobs j
      where j.booking_id = b.id
        and j.status in ('pending', 'dispatching', 'failed')
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.internal_purge_expired_bookings()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-retention-purge') then
    perform cron.unschedule('booking-retention-purge');
  end if;
end;
$$;

-- 03:11 UTC: before customer-booking-access-cleanup (03:23), at a minute no other job uses.
select cron.schedule(
  'booking-retention-purge',
  '11 3 * * *',
  'select public.internal_purge_expired_bookings()'
);
