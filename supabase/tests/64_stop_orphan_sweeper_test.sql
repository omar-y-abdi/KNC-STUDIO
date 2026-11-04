begin;
select plan(31);

-- The orphan sweeper is off the per-minute dispatcher and runs from one daily cron job.
select has_function('public', 'queue_orphaned_storage_objects', array[]::text[],
  'the orphan Storage reconciler still exists');
select ok(pg_catalog.pg_get_functiondef('public.queue_due_external_actions()'::regprocedure)
  not ilike '%queue_orphaned_storage_objects%',
  'the per-minute dispatcher no longer calls the orphan reconciler');
select is((select pg_catalog.array_agg(j.jobname || ' ' || j.schedule) from cron.job j
  where j.command ilike '%queue_orphaned_storage_objects%'),
  array['storage-orphan-reconcile 53 3 * * *'],
  'only the daily reconcile job calls the orphan reconciler');
select is((select count(*)::int from pg_catalog.pg_proc p
  where p.prosrc ilike '%queue_orphaned_storage_objects%'), 0,
  'no database function body calls the orphan reconciler');

-- Both recreated functions keep their privilege boundary.
select ok(not has_function_privilege('service_role', 'public.queue_due_external_actions()', 'EXECUTE'),
  'service role cannot invoke the cron-owned external action dispatcher');
select ok(not has_function_privilege('authenticated', 'public.queue_due_external_actions()', 'EXECUTE'),
  'authenticated cannot invoke the cron-owned external action dispatcher');
select ok(not has_function_privilege('service_role', 'public.queue_orphaned_storage_objects()', 'EXECUTE'),
  'service role cannot invoke the cron-owned orphan reconciler');

-- Old, unreferenced bytes. The upload trigger registers valid object names in cms_assets; a name
-- outside that pattern stays unregistered.
insert into storage.objects (bucket_id, name, created_at) values
  ('gallery', 'salon/cms-registered.webp', pg_catalog.now() - interval '2 days'),
  ('barber-photos', 'sweeper-check/cms-registered.webp', pg_catalog.now() - interval '2 days'),
  ('gallery', 'salon/unregistered orphan.webp', pg_catalog.now() - interval '2 days'),
  ('gallery', 'salon/fresh orphan.webp', pg_catalog.now()),
  ('gallery', 'salon/revision referenced.webp', pg_catalog.now() - interval '2 days');
insert into public.cms_revisions (revision, document, fingerprint)
values (640001, '{"image": {"path": "salon/revision referenced.webp"}}', 'sweeper-test');
select is((select count(*)::int from public.cms_assets a
  where a.path in (
    'salon/cms-registered.webp', 'sweeper-check/cms-registered.webp',
    'salon/unregistered orphan.webp', 'salon/fresh orphan.webp', 'salon/revision referenced.webp'
  )), 2, 'precondition: the upload trigger registered exactly the two valid object names');

select public.queue_due_external_actions();
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete'), 0,
  'the per-minute dispatcher queues no Storage deletion');

-- A gallery cleanup intent still runs through the dispatcher after legacy producers are retired.
select vault.create_secret('http://127.0.0.1:9/external-cleanup', 'external_cleanup_url');
select vault.create_secret('sweeper-test-secret', 'booking_webhook_secret');
insert into storage.objects (bucket_id, name, created_at)
values ('gallery', 'salon/owner-deleted.webp', pg_catalog.now() - interval '2 days');
set local role service_role;
select ok(public.internal_queue_storage_deletion('gallery', 'salon/owner-deleted.webp') is not null,
  'the retained generic queue commits a gallery Storage deletion intent');
reset role;
select is((select status from public.external_action_jobs
  where action_type = 'storage_object_delete' and dedupe_key = 'gallery:salon/owner-deleted.webp'),
  'pending', 'explicit deletion intent is pending');

select is(public.queue_due_external_actions(), 1,
  'the scheduled dispatcher sends the explicit deletion to external-cleanup');
select set_config('test.owner_job', (select pg_catalog.jsonb_build_object(
    'id', j.id, 'token', j.dispatch_token, 'status', j.status)::text
  from public.external_action_jobs j
  where j.action_type = 'storage_object_delete' and j.dedupe_key = 'gallery:salon/owner-deleted.webp'),
  true);
select is(current_setting('test.owner_job')::jsonb ->> 'status', 'dispatching',
  'the dispatched job holds a fresh dispatch token');

set local role service_role;
select is(public.external_action_for_dispatch(
  (current_setting('test.owner_job')::jsonb ->> 'id')::uuid,
  (current_setting('test.owner_job')::jsonb ->> 'token')::uuid
) ->> 'path', 'salon/owner-deleted.webp',
  'external-cleanup receives the exact object to delete');
select is(public.complete_external_action(
  (current_setting('test.owner_job')::jsonb ->> 'id')::uuid,
  (current_setting('test.owner_job')::jsonb ->> 'token')::uuid
), true, 'external-cleanup completes the explicit deletion');
reset role;
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete'), 0,
  'completed explicit deletion is not re-queued by the dispatcher');

-- external-cleanup asks only the generic dispatcher, which must still resolve Calendar jobs.
select set_config('test.calendar_job', public.queue_external_action(
  'calendar_disconnect', 'sweeper-calendar',
  pg_catalog.jsonb_build_object('barber_id', 'sweeper-calendar')
)::text, true);
set local role service_role;
select set_config('test.calendar_claim', public.claim_external_action(
  current_setting('test.calendar_job')::uuid
)::text, true);
select is(public.external_action_for_dispatch(
  current_setting('test.calendar_job')::uuid,
  (current_setting('test.calendar_claim')::jsonb ->> 'dispatch_token')::uuid
), public.calendar_external_action_for_dispatch(
  current_setting('test.calendar_job')::uuid,
  (current_setting('test.calendar_claim')::jsonb ->> 'dispatch_token')::uuid
), 'the generic dispatcher returns the Calendar dispatcher''s context for a Calendar job');
reset role;
select is(current_setting('test.calendar_claim')::jsonb ->> 'action_type', 'calendar_disconnect',
  'the Calendar job context is not empty');

-- The daily reconciler queues only old, unregistered, unreferenced objects.
select is(public.queue_orphaned_storage_objects(), 2,
  'daily reconciliation queues the two old unregistered objects');
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete' and dedupe_key = 'gallery:salon/unregistered orphan.webp'),
  1, 'an old unregistered orphan receives one durable deletion intent');
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete'
    and dedupe_key in (
      'gallery:salon/cms-registered.webp',
      'barber-photos:sweeper-check/cms-registered.webp'
    )), 0,
  'a cms_assets-registered object is never queued');
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete' and dedupe_key = 'gallery:salon/fresh orphan.webp'),
  0, 'an object younger than the grace period is not queued');
set local role service_role;
select is(public.internal_cms_media_retained('gallery', 'salon/revision referenced.webp'), true,
  'a queued object referenced by a CMS revision is retained at dispatch, not deleted');
select is(public.internal_cms_media_retained('gallery', 'salon/unregistered orphan.webp'), false,
  'an unreferenced unregistered orphan is released for deletion at dispatch');
reset role;

select set_config('test.orphan_job', (select id::text from public.external_action_jobs
  where action_type = 'storage_object_delete' and dedupe_key = 'gallery:salon/unregistered orphan.webp'),
  true);
set local role service_role;
select set_config('test.orphan_claim', public.claim_external_action(
  current_setting('test.orphan_job')::uuid
)::text, true);
reset role;
select is(public.queue_orphaned_storage_objects(), 0,
  'reconciliation leaves existing pending and dispatching intents untouched');
select is((select dispatch_token::text from public.external_action_jobs
  where id = current_setting('test.orphan_job')::uuid),
  current_setting('test.orphan_claim')::jsonb ->> 'dispatch_token',
  'reconciliation never invalidates an in-flight worker token');

-- pg_cron history is bounded by one daily purge job.
insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time) values
  (0, -6401, 'select 1', 'succeeded', pg_catalog.now() - interval '8 days',
    pg_catalog.now() - interval '8 days'),
  (0, -6402, 'select 1', 'succeeded', pg_catalog.now() - interval '6 days',
    pg_catalog.now() - interval '6 days'),
  (0, -6403, 'select 1', 'running', pg_catalog.now() - interval '8 days', null);
do $$
begin
  execute (select j.command from cron.job j where j.jobname = 'cron-job-run-details-purge');
end;
$$;
select is((select pg_catalog.array_agg(d.runid order by d.runid) from cron.job_run_details d
  where d.runid in (-6401, -6402, -6403)), array[-6403, -6402]::bigint[],
  'purge deletes finished runs older than 7 days and keeps recent or unfinished runs');

-- Re-running the migration's scheduling blocks leaves each job exactly once, unchanged.
select set_config('test.cron_before', (select pg_catalog.jsonb_object_agg(
    j.jobname, j.schedule || ' ' || j.command)::text
  from cron.job j where j.jobname in ('storage-orphan-reconcile', 'cron-job-run-details-purge')),
  true);
do $$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'storage-orphan-reconcile') then
      perform cron.unschedule('storage-orphan-reconcile');
    end if;
    perform cron.schedule(
      'storage-orphan-reconcile',
      '53 3 * * *',
      'select public.queue_orphaned_storage_objects()'
    );
    if exists (select 1 from cron.job where jobname = 'cron-job-run-details-purge') then
      perform cron.unschedule('cron-job-run-details-purge');
    end if;
    perform cron.schedule(
      'cron-job-run-details-purge',
      '47 3 * * *',
      $cmd$delete from cron.job_run_details where end_time < pg_catalog.now() - interval '7 days'$cmd$
    );
  end loop;
end;
$$;
select is((select count(*)::int from cron.job where jobname = 'storage-orphan-reconcile'), 1,
  'the daily reconcile job exists exactly once after re-running its block twice');
select is((select count(*)::int from cron.job where jobname = 'cron-job-run-details-purge'), 1,
  'the cron history purge job exists exactly once after re-running its block twice');
select is((select pg_catalog.jsonb_object_agg(j.jobname, j.schedule || ' ' || j.command)::text
  from cron.job j where j.jobname in ('storage-orphan-reconcile', 'cron-job-run-details-purge')),
  current_setting('test.cron_before'),
  'the re-run blocks schedule exactly what the migration scheduled');
select isnt((select j.schedule from cron.job j where j.jobname = 'storage-orphan-reconcile'),
  (select j.schedule from cron.job j where j.jobname = 'cron-job-run-details-purge'),
  'the reconcile and purge jobs run at different minutes');

select * from finish();
rollback;
