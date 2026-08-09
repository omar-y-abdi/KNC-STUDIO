-- One-day customer reminders. A booking is eligible only when it was created at least 24 hours
-- before start_at; this permanently excludes a booking made 23 hours before its appointment.
create extension if not exists pg_cron;

create table public.booking_reminders (
  booking_id      uuid primary key references public.bookings(id) on delete cascade,
  due_at          timestamptz not null,
  last_attempt_at timestamptz,
  delivered_at    timestamptz,
  attempt_count   integer not null default 0 check (attempt_count >= 0),
  created_at      timestamptz not null default pg_catalog.now()
);

create index booking_reminders_due_idx
on public.booking_reminders (due_at)
where delivered_at is null;

alter table public.booking_reminders enable row level security;
revoke all on table public.booking_reminders from anon, authenticated, service_role;

create or replace function public.queue_booking_reminder_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed'
     and new.email is not null
     and new.start_at - new.created_at >= interval '24 hours' then
    insert into public.booking_reminders (booking_id, due_at)
    values (new.id, new.start_at - interval '24 hours')
    on conflict (booking_id) do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function public.queue_booking_reminder_after_insert() from public;

drop trigger if exists booking_reminder_on_insert on public.bookings;
create trigger booking_reminder_on_insert
after insert on public.bookings
for each row execute function public.queue_booking_reminder_after_insert();

-- Existing future bookings also receive a reminder if they were booked with at least 24 hours'
-- notice and their reminder time has not passed.
insert into public.booking_reminders (booking_id, due_at)
select b.id, b.start_at - interval '24 hours'
from public.bookings b
where b.status = 'confirmed'
  and b.email is not null
  and b.start_at - b.created_at >= interval '24 hours'
  and b.start_at >= pg_catalog.now() + interval '24 hours'
on conflict (booking_id) do nothing;

create or replace function public.mark_booking_reminder_delivered(
  p_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.booking_reminders r
  set delivered_at = coalesce(r.delivered_at, pg_catalog.now())
  where r.booking_id = p_id;

  return found;
end;
$$;

revoke execute on function public.mark_booking_reminder_delivered(uuid) from public;
grant execute on function public.mark_booking_reminder_delivered(uuid) to service_role;

-- Called by one pg_cron job every minute. Retries happen every five minutes but only while the
-- appointment remains 23-24 hours away; reminders are never sent later in the day.
create or replace function public.queue_due_booking_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url        text;
  v_secret     text;
  v_booking_id uuid;
  v_queued     integer := 0;
begin
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'booking_confirmation_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return 0;
  end if;

  for v_booking_id in
    select r.booking_id
    from public.booking_reminders r
    join public.bookings b on b.id = r.booking_id
    where r.delivered_at is null
      and r.due_at <= pg_catalog.now()
      and (r.last_attempt_at is null or r.last_attempt_at <= pg_catalog.now() - interval '5 minutes')
      and b.status = 'confirmed'
      and b.email is not null
      and b.start_at > pg_catalog.now() + interval '23 hours'
    order by r.due_at
    for update of r skip locked
    limit 50
  loop
    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object(
        'id', v_booking_id,
        'event', 'booking_reminder'
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );

    update public.booking_reminders r
    set last_attempt_at = pg_catalog.now(),
        attempt_count = r.attempt_count + 1
    where r.booking_id = v_booking_id;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception
  when others then
    raise warning 'booking reminder enqueue failed: %', sqlerrm;
    return v_queued;
end;
$$;

revoke execute on function public.queue_due_booking_reminders() from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-reminder-dispatch') then
    perform cron.unschedule('booking-reminder-dispatch');
  end if;
end;
$$;

select cron.schedule(
  'booking-reminder-dispatch',
  '* * * * *',
  'select public.queue_due_booking_reminders()'
);
