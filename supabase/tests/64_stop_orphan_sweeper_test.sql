begin;
select plan(17);

-- The legacy orphan sweeper is gone, and nothing scheduled can still reach it.
select hasnt_function('public', 'queue_orphaned_storage_objects', array[]::text[],
  'the legacy orphan Storage sweeper no longer exists');
select is((select count(*)::int from pg_catalog.pg_proc p
  where p.prosrc ilike '%queue_orphaned_storage_objects%'), 0,
  'no database function body calls the orphan sweeper');
select is((select count(*)::int from cron.job j
  where j.command ilike '%queue_orphaned_storage_objects%'), 0,
  'no cron job calls the orphan sweeper');

-- The dispatcher keeps its privilege boundary after being recreated.
select ok(not has_function_privilege('service_role', 'public.queue_due_external_actions()', 'EXECUTE'),
  'service role cannot invoke the cron-owned external action dispatcher');
select ok(not has_function_privilege('authenticated', 'public.queue_due_external_actions()', 'EXECUTE'),
  'authenticated cannot invoke the cron-owned external action dispatcher');

-- Old, unreferenced bytes that the sweeper used to re-queue every minute. The upload trigger
-- registers valid object names in cms_assets; a name outside that pattern stays unregistered.
insert into storage.objects (bucket_id, name, created_at) values
  ('gallery', 'salon/cms-registered.webp', pg_catalog.now() - interval '2 days'),
  ('barber-photos', 'sweeper-check/cms-registered.webp', pg_catalog.now() - interval '2 days'),
  ('gallery', 'salon/unregistered orphan.webp', pg_catalog.now() - interval '2 days');
select is((select count(*)::int from public.cms_assets a
  where (a.bucket, a.path) in (
    ('gallery', 'salon/cms-registered.webp'),
    ('barber-photos', 'sweeper-check/cms-registered.webp'),
    ('gallery', 'salon/unregistered orphan.webp')
  )), 2, 'precondition: the upload trigger registered exactly the two valid object names');

select public.queue_due_external_actions();
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete'
    and dedupe_key in (
      'gallery:salon/cms-registered.webp',
      'barber-photos:sweeper-check/cms-registered.webp'
    )), 0,
  'no storage_object_delete is queued for a cms_assets-registered object');
select is((select count(*)::int from public.external_action_jobs
  where action_type = 'storage_object_delete'), 0,
  'the scheduled path queues no Storage deletion at all');

-- An explicit owner deletion still runs end to end through the scheduled dispatcher.
select vault.create_secret('http://127.0.0.1:9/external-cleanup', 'external_cleanup_url');
select vault.create_secret('sweeper-test-secret', 'booking_webhook_secret');
insert into storage.objects (bucket_id, name, created_at)
values ('gallery', 'salon/owner-deleted.webp', pg_catalog.now() - interval '2 days');
insert into public.gallery_images (id, kind, storage_path, alt, sort_order)
values ('64000000-0000-4000-8000-000000000001', 'salon', 'salon/owner-deleted.webp', 'Deleted', 0);

set local role service_role;
select is(public.internal_delete_gallery_image(
  '64000000-0000-4000-8000-000000000001', 'salon/owner-deleted.webp'
) ->> 'ok', 'true', 'owner gallery deletion commits its Storage deletion intent');
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

-- pg_cron history is bounded by one daily purge job.
select is((select count(*)::int from cron.job where jobname = 'cron-job-run-details-purge'), 1,
  'exactly one cron history purge job is scheduled');

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

select * from finish();
rollback;
