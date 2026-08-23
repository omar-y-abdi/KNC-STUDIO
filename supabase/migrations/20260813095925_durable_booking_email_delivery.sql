-- Confirmation and cancellation webhooks used to be fire-and-forget pg_net calls. Persisting
-- each delivery first makes failed Edge Function/Resend calls observable and retryable.
create table public.booking_email_delivery_jobs (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  event           text not null check (event in ('booking_confirmed', 'booking_cancelled')),
  status          text not null default 'pending' check (
    status in ('pending', 'dispatching', 'delivered', 'skipped', 'superseded')
  ),
  sent_kinds      text[] not null default '{}'::text[] check (
    sent_kinds <@ array['customer', 'barber']::text[]
  ),
  attempt_count   integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz,
  completed_at    timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  created_at      timestamptz not null default pg_catalog.now(),
  unique (booking_id, event)
);

create index booking_email_delivery_jobs_dispatch_idx
on public.booking_email_delivery_jobs (next_attempt_at, created_at)
where status = 'pending';

create index booking_email_delivery_jobs_reclaim_idx
on public.booking_email_delivery_jobs (last_attempt_at)
where status = 'dispatching';

alter table public.booking_email_delivery_jobs enable row level security;
revoke all on table public.booking_email_delivery_jobs from anon, authenticated, service_role;

create or replace function public.queue_booking_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'booking_confirmed';
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled' then
    v_event := 'booking_cancelled';
  else
    return new;
  end if;

  insert into public.booking_email_delivery_jobs (booking_id, event)
  values (new.id, v_event)
  on conflict (booking_id, event) do nothing;

  return new;
end;
$$;

revoke execute on function public.queue_booking_email_delivery()
from public, anon, authenticated, service_role;

drop trigger if exists booking_confirmation_on_insert on public.bookings;
drop trigger if exists booking_cancellation_on_update on public.bookings;
drop trigger if exists booking_email_delivery_on_insert on public.bookings;
drop trigger if exists booking_email_delivery_on_status_change on public.bookings;

create trigger booking_email_delivery_on_insert
after insert on public.bookings
for each row execute function public.queue_booking_email_delivery();

create trigger booking_email_delivery_on_status_change
after update of status on public.bookings
for each row
when (old.status = 'confirmed' and new.status = 'cancelled')
execute function public.queue_booking_email_delivery();

create or replace function public.booking_email_delivery_for_dispatch(
  p_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', j.id,
    'booking_id', j.booking_id,
    'event', j.event,
    'sent_kinds', j.sent_kinds
  )
  from public.booking_email_delivery_jobs j
  where j.id = p_id
    and j.status = 'dispatching';
$$;

create or replace function public.complete_booking_email_delivery(
  p_id uuid,
  p_status text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('delivered', 'skipped', 'superseded') then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set status = p_status,
      completed_at = pg_catalog.now(),
      last_error_code = null
  where j.id = p_id
    and j.status = 'dispatching';

  return found;
end;
$$;

create or replace function public.mark_booking_email_delivery_recipient(
  p_id uuid,
  p_kind text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('customer', 'barber') then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set sent_kinds = pg_catalog.array_append(j.sent_kinds, p_kind)
  where j.id = p_id
    and j.status = 'dispatching'
    and not (p_kind = any(j.sent_kinds));

  return found or exists (
    select 1
    from public.booking_email_delivery_jobs j
    where j.id = p_id
      and j.status in ('dispatching', 'delivered')
      and p_kind = any(j.sent_kinds)
  );
end;
$$;

create or replace function public.fail_booking_email_delivery(
  p_id uuid,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code not in ('not_configured', 'send_failed', 'message_build_failed') then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set status = 'pending',
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
        secs => least(
          3600,
          (60 * pg_catalog.power(2, least(greatest(j.attempt_count - 1, 0), 6)))::integer
        )
      ),
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching';

  return found;
end;
$$;

revoke execute on function public.booking_email_delivery_for_dispatch(uuid)
from public, anon, authenticated;
revoke execute on function public.complete_booking_email_delivery(uuid, text)
from public, anon, authenticated;
revoke execute on function public.fail_booking_email_delivery(uuid, text)
from public, anon, authenticated;
revoke execute on function public.mark_booking_email_delivery_recipient(uuid, text)
from public, anon, authenticated;
grant execute on function public.booking_email_delivery_for_dispatch(uuid) to service_role;
grant execute on function public.complete_booking_email_delivery(uuid, text) to service_role;
grant execute on function public.fail_booking_email_delivery(uuid, text) to service_role;
grant execute on function public.mark_booking_email_delivery_recipient(uuid, text) to service_role;

create or replace function public.queue_due_booking_email_deliveries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_job    record;
  v_queued integer := 0;
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

  for v_job in
    select j.id
    from public.booking_email_delivery_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= pg_catalog.now())
       or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit 50
  loop
    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object('delivery_id', v_job.id),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );

    update public.booking_email_delivery_jobs j
    set status = 'dispatching',
        attempt_count = j.attempt_count + 1,
        last_attempt_at = pg_catalog.now(),
        last_error_code = null
    where j.id = v_job.id;

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception
  when others then
    raise warning 'booking email delivery enqueue failed';
    return v_queued;
end;
$$;

revoke execute on function public.queue_due_booking_email_deliveries()
from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-email-delivery-dispatch') then
    perform cron.unschedule('booking-email-delivery-dispatch');
  end if;
  if exists (select 1 from cron.job where jobname = 'booking-email-delivery-cleanup') then
    perform cron.unschedule('booking-email-delivery-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'booking-email-delivery-dispatch',
  '* * * * *',
  'select public.queue_due_booking_email_deliveries()'
);

select cron.schedule(
  'booking-email-delivery-cleanup',
  '17 3 * * *',
  $$delete from public.booking_email_delivery_jobs
    where status in ('delivered', 'skipped', 'superseded')
      and completed_at < pg_catalog.now() - interval '90 days'$$
);
