-- Take the orphan Storage sweeper off the per-minute dispatcher and bound pg_cron history
-- (OPS-1, PERF-1, LIFE-12, OPS-12).
--
-- The upload trigger (20260915040000) registers every managed object in cms_assets, and
-- internal_cms_media_retained keeps every registered object. Each storage_object_delete that the
-- sweeper queued for an unreferenced registered object was therefore retained and completed, which
-- removed the job, so the next minute's sweep queued it again: one Edge invocation and one retention
-- lookup per object per minute, without ever deleting a byte. The sweeper now skips registered
-- objects and runs once a day. Explicit deletion intents (gallery, barber photo and logo removal)
-- are queued by their own RPCs and are dispatched exactly as before.
begin;

-- Body copied from 20260913140731_durable_dispatch_request_budget.sql without the sweeper call.
-- CREATE OR REPLACE keeps the owner and the execute grants of the existing function.
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

-- Body copied from 20260824075236_admin_cms_logo_and_contact_controls.sql with one added condition:
-- an object registered in cms_assets is CMS library inventory, never an orphan. Unregistered bytes
-- (names outside the registration pattern, or bytes left by a failed upload compensation) are
-- still queued; external-cleanup re-checks retention, fail closed, before it deletes anything.
-- CREATE OR REPLACE keeps the owner and the revoked execute grants of the existing function.
create or replace function public.queue_orphaned_storage_objects()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object record;
  v_queued integer := 0;
begin
  for v_object in
    select o.bucket_id, o.name
    from storage.objects o
    where o.bucket_id in ('gallery', 'barber-photos')
      and o.created_at < pg_catalog.now() - interval '30 minutes'
      and not exists (
        select 1 from public.external_action_jobs j
        where j.action_type = 'storage_object_delete'
          and j.dedupe_key = o.bucket_id || ':' || o.name
      )
      and not exists (
        select 1 from public.cms_assets a
        where a.bucket = o.bucket_id and a.path = o.name
      )
      and (
        (o.bucket_id = 'gallery' and not exists (
          select 1 from public.gallery_images g where g.storage_path = o.name
        ) and not exists (
          select 1 from public.site_settings s
          where s.key = 'homepage_logo_path' and s.value = o.name
        ))
        or
        (o.bucket_id = 'barber-photos' and not exists (
          select 1 from public.barber_photos p where p.storage_path = o.name
        ))
      )
    order by o.created_at, o.id
    limit 100
  loop
    perform public.queue_external_action(
      'storage_object_delete',
      v_object.bucket_id || ':' || v_object.name,
      pg_catalog.jsonb_build_object('bucket', v_object.bucket_id, 'path', v_object.name)
    );
    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

-- Unregistered orphans are rare; one reconciliation per day bounds the cost of any object that is
-- queued, retained at dispatch and found again.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'storage-orphan-reconcile') then
    perform cron.unschedule('storage-orphan-reconcile');
  end if;
end;
$$;

select cron.schedule(
  'storage-orphan-reconcile',
  '53 3 * * *',
  'select public.queue_orphaned_storage_objects()'
);

-- A pending deletion of a registered object can only be retained and completed by external-cleanup.
-- Dispatching jobs keep their live token and finish the same way; nothing re-queues them.
delete from public.external_action_jobs j
where j.action_type = 'storage_object_delete'
  and j.status = 'pending'
  and exists (
    select 1
    from public.cms_assets a
    where a.bucket = j.payload->>'bucket'
      and a.path = j.payload->>'path'
  );

-- pg_cron writes one history row per run and never prunes them. Unfinished runs are kept.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cron-job-run-details-purge') then
    perform cron.unschedule('cron-job-run-details-purge');
  end if;
end;
$$;

select cron.schedule(
  'cron-job-run-details-purge',
  '47 3 * * *',
  $$delete from cron.job_run_details where end_time < pg_catalog.now() - interval '7 days'$$
);

commit;
