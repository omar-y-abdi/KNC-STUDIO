-- Booking retention: 12 months (checklist item 68, gap 1).
--
-- Until now a booking stayed until the owner deleted it. A daily job now deletes every booking
-- whose appointment ended more than 12 months ago.
--
-- What it deletes is a subset of what the owner's own "purge history" (admin_purge_history) may
-- delete, namely cancelled bookings and confirmed bookings that have ended, and it goes through the
-- same row delete with the same effects:
--   * bookings_prevent_unresolved_email_delete still guards every row,
--   * the calendar event of the booking is queued for removal (booking_calendar_cleanup_on_delete),
--   * delivery jobs, the reminder and device-receipt grants cascade,
--   * a review and the e-mail log keep their rows and lose only the link to the booking.
-- The customer's contact data that then belongs to no booking is removed by
-- customer-booking-access-cleanup, which runs twelve minutes later the same night.
--
-- A confirmation or cancellation e-mail that is pending or being sent holds its booking, as it does
-- for the owner's delete. A FAILED e-mail waits for the owner to retry or dismiss it and nothing
-- else ever clears it, so it would hold its booking for ever. Twelve months after the appointment
-- the job therefore dismisses it first, exactly as the owner's own dismissal does
-- (admin_discard_failed_booking_email_delivery: the delivery job becomes 'skipped'), and the booking
-- is then deleted like any other.
--
-- Time is the database transaction time, as in the neighbouring retention jobs
-- (internal_purge_email_send_log). "12 months" is calendar months counted back from that instant.
--
-- Deployment order: nothing here is called by application code, old or new.

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
  -- Dismiss the failed e-mails of bookings past the cutoff: status 'skipped' and completed_at now,
  -- the same two columns the owner's dismissal writes. Only 'failed' is touched, and only for a
  -- booking whose appointment ended more than 12 months ago. A pending or dispatching e-mail is
  -- left alone and keeps holding its booking; a failed e-mail of a younger booking stays failed
  -- for the owner.
  update public.booking_email_delivery_jobs j
  set status = 'skipped',
      completed_at = pg_catalog.now()
  from public.bookings b
  where b.id = j.booking_id
    and b.end_at < v_cutoff
    and j.status = 'failed';

  -- Lock one bounded batch, oldest first. A booking another transaction is working on (the owner
  -- is cancelling or deleting it right now) is skipped, never waited for. Holding the row lock
  -- keeps a new delivery job from appearing for the booking: the only code that creates one is a
  -- trigger on an insert or a status change of this row. 'failed' stays in the list below although
  -- the statement above has just cleared it: an e-mail that fails between that statement and this
  -- one holds its booking until the next run, and bookings_prevent_unresolved_email_delete can
  -- then never refuse a row this function selected.
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

  -- Delete a booking when, as seen now, all of this holds:
  --   it is in the batch locked above, and
  --   its appointment ended more than 12 months before this transaction began
  --   (end_at is earlier than now minus 12 months; a booking that ended exactly 12 months ago
  --   stays, and so does every booking that has not ended, since its end is not in the past), and
  --   none of its confirmation or cancellation e-mails is pending or being sent (a failed one was
  --   dismissed by the first statement; one that failed after it holds the booking for one more
  --   run). A booking with a pending or dispatching e-mail stays until that e-mail is delivered,
  --   skipped, superseded or failed.
  -- The status of the booking plays no part: cancelled and confirmed bookings are treated alike.
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
