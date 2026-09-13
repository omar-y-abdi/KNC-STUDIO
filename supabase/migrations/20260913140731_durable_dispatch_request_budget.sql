-- Give cold Edge invocations time for database + provider calls. pg_net remains asynchronous.
-- Five-second transport aborts caused repeated live Calendar and confirmation delivery failures.
-- Queue leases, dispatch tokens, provider idempotency, and retry ownership stay unchanged.

CREATE OR REPLACE FUNCTION public.queue_due_booking_email_deliveries()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      timeout_milliseconds := 30000
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
$function$;

CREATE OR REPLACE FUNCTION public.queue_due_booking_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      timeout_milliseconds := 30000
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
$function$;

CREATE OR REPLACE FUNCTION public.queue_due_external_actions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url text;
  v_secret text;
  v_job record;
  v_dispatch_token uuid;
  v_queued integer := 0;
begin
  begin
    perform public.queue_orphaned_storage_objects();
  exception when others then
    raise warning 'orphaned Storage reconciliation failed';
  end;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'external_cleanup_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return 0;
  end if;

  for v_job in
    select j.id
    from public.external_action_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= pg_catalog.now())
       or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit 25
  loop
    update public.external_action_jobs j
    set status = 'dispatching',
        attempt_count = j.attempt_count + 1,
        last_attempt_at = pg_catalog.now(),
        dispatch_token = pg_catalog.gen_random_uuid(),
        last_error_code = null
    where j.id = v_job.id
    returning j.dispatch_token into v_dispatch_token;

    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object(
        'action_id', v_job.id,
        'dispatch_token', v_dispatch_token
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 30000
    );

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception when others then
  raise warning 'external action enqueue failed';
  return v_queued;
end;
$function$;
