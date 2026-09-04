begin;
select plan(84);

select ok(not has_table_privilege('anon', 'public.external_action_jobs', 'SELECT'),
  'anon cannot inspect external action jobs');
select ok(not has_table_privilege('authenticated', 'public.external_action_jobs', 'SELECT'),
  'authenticated cannot inspect external action jobs');
select ok(not has_table_privilege('service_role', 'public.external_action_jobs', 'SELECT'),
  'service role must use fenced worker RPCs');
select ok(has_function_privilege('service_role', 'public.claim_external_action(uuid)', 'EXECUTE'),
  'service role can claim queued work');
select ok(not has_function_privilege('authenticated', 'public.claim_external_action(uuid)', 'EXECUTE'),
  'authenticated cannot claim queued work');
select ok(has_function_privilege('service_role', 'public.block_external_action(uuid,uuid,text)', 'EXECUTE'),
  'service role can block work that requires human recovery');
select ok(not has_function_privilege('authenticated', 'public.block_external_action(uuid,uuid,text)', 'EXECUTE'),
  'authenticated cannot block external work');
select ok(has_function_privilege('service_role', 'public.internal_queue_storage_deletion(text,text)', 'EXECUTE'),
  'service role can durably queue emergency Storage cleanup');
select ok(not has_function_privilege('authenticated', 'public.internal_queue_storage_deletion(text,text)', 'EXECUTE'),
  'authenticated cannot queue arbitrary Storage cleanup');
select ok(not has_function_privilege('anon', 'public.queue_orphaned_storage_objects()', 'EXECUTE'),
  'anon cannot invoke orphaned Storage reconciliation');
select ok(not has_function_privilege('authenticated', 'public.queue_orphaned_storage_objects()', 'EXECUTE'),
  'authenticated cannot invoke orphaned Storage reconciliation');
select ok(not has_function_privilege('service_role', 'public.queue_orphaned_storage_objects()', 'EXECUTE'),
  'service role cannot invoke scheduler-owned orphaned Storage reconciliation');
select ok(not has_table_privilege('authenticated', 'public.gallery_images', 'INSERT'),
  'authenticated cannot bypass gallery upload gateway');
select ok(not has_table_privilege('authenticated', 'public.gallery_images', 'UPDATE'),
  'authenticated cannot bypass gallery metadata writes');
select ok(not has_table_privilege('authenticated', 'public.gallery_images', 'DELETE'),
  'authenticated cannot bypass durable gallery deletion');
select ok(not has_table_privilege('authenticated', 'public.barber_photos', 'INSERT'),
  'authenticated cannot bypass barber photo upload gateway');
select ok(not has_table_privilege('authenticated', 'public.barber_photos', 'UPDATE'),
  'authenticated cannot bypass barber photo replacement gateway');
select ok(not has_table_privilege('authenticated', 'public.barber_photos', 'DELETE'),
  'authenticated cannot bypass durable barber photo deletion');
select ok(has_function_privilege(
  'service_role', 'public.internal_insert_gallery_image(text,text,text,integer)', 'EXECUTE'),
  'service role can insert validated gallery metadata through the narrow RPC');
select ok(not has_function_privilege(
  'authenticated', 'public.internal_insert_gallery_image(text,text,text,integer)', 'EXECUTE'),
  'authenticated cannot invoke the internal gallery insert RPC');
select is((
  select pg_catalog.count(*)::int
  from pg_catalog.pg_policy p
  where p.polrelid = 'storage.objects'::regclass
    and p.polname in ('gallery_owner_delete', 'barber_photos_owner_delete', 'barber_photos_own_delete')
), 0, 'authenticated clients have no direct Storage delete policy for managed images');

set local role service_role;
select is(
  public.internal_insert_gallery_image('salon', 'salon/validated.webp', 'Validated', 2) ->> 'kind',
  'salon', 'service-role gateway can persist validated gallery metadata'
);
select throws_ok(
  $$select public.internal_insert_gallery_image('salon', 'cuts/wrong.webp', 'Wrong', 0)$$,
  '22023', 'invalid gallery image',
  'gallery insert RPC rejects a path outside the declared gallery kind'
);
reset role;
delete from public.gallery_images where storage_path = 'salon/validated.webp';

insert into public.gallery_images (id, kind, storage_path, alt, sort_order)
values ('33000000-0000-0000-0000-000000000001', 'salon', 'salon/outbox.webp', 'Outbox', 0);

set local role service_role;
select is(public.internal_delete_gallery_image(
  '33000000-0000-0000-0000-000000000001', 'salon/wrong.webp'
) ->> 'error', 'not_found', 'optimistic path rejects stale gallery delete');
reset role;
select is((select count(*)::int from public.gallery_images where id='33000000-0000-0000-0000-000000000001'), 1,
  'stale gallery delete keeps metadata');
select is((select count(*)::int from public.external_action_jobs), 0,
  'stale gallery delete queues nothing');

set local role service_role;
select set_config('test.gallery_delete', public.internal_delete_gallery_image(
  '33000000-0000-0000-0000-000000000001', 'salon/outbox.webp'
)::text, true);
select is((current_setting('test.gallery_delete')::jsonb) ->> 'ok', 'true',
  'metadata delete and deletion intent commit together');
reset role;
select is((select count(*)::int from public.gallery_images where id='33000000-0000-0000-0000-000000000001'), 0,
  'gallery metadata is deleted');
select is((select count(*)::int from public.external_action_jobs where action_type='storage_object_delete'), 1,
  'Storage deletion intent persists');

select set_config('test.storage_job', (select id::text from public.external_action_jobs
  where action_type='storage_object_delete'), true);
set local role service_role;
select set_config('test.storage_claim', public.claim_external_action(
  current_setting('test.storage_job')::uuid
)::text, true);
select is((current_setting('test.storage_claim')::jsonb) ->> 'path', 'salon/outbox.webp',
  'claimed Storage context contains expected object path');
select is(public.fail_external_action(
  current_setting('test.storage_job')::uuid,
  (current_setting('test.storage_claim')::jsonb ->> 'dispatch_token')::uuid,
  'storage_failed'
), true, 'retryable worker failure returns action to pending');
reset role;
select is((select status from public.external_action_jobs where id=current_setting('test.storage_job')::uuid),
  'pending', 'failed action remains durable');

set local role service_role;
select set_config('test.block_claim', public.claim_external_action(
  current_setting('test.storage_job')::uuid
)::text, true);
select is(public.block_external_action(
  current_setting('test.storage_job')::uuid,
  (current_setting('test.block_claim')::jsonb ->> 'dispatch_token')::uuid,
  'calendar_authorization_required'
), true, 'non-retryable action enters a durable blocked state');
reset role;
select is((select status from public.external_action_jobs where id=current_setting('test.storage_job')::uuid),
  'blocked', 'blocked action is not eligible for automatic dispatch');
select public.queue_storage_deletion('gallery', 'salon/outbox.webp');
select is((select status from public.external_action_jobs where id=current_setting('test.storage_job')::uuid),
  'pending', 'explicitly re-queuing blocked intent resumes dispatch');

set local role service_role;
select set_config('test.old_claim', public.claim_external_action(
  current_setting('test.storage_job')::uuid
)::text, true);
reset role;
select public.queue_storage_deletion('gallery', 'salon/outbox.webp');
set local role service_role;
select is(public.complete_external_action(
  current_setting('test.storage_job')::uuid,
  (current_setting('test.old_claim')::jsonb ->> 'dispatch_token')::uuid
), false, 'stale dispatch token cannot complete superseding intent');
select set_config('test.new_claim', public.claim_external_action(
  current_setting('test.storage_job')::uuid
)::text, true);
select is((current_setting('test.new_claim')::jsonb) ->> 'action_type', 'storage_object_delete',
  'superseding Storage intent is independently claimable');
select is(public.complete_external_action(
  current_setting('test.storage_job')::uuid,
  (current_setting('test.new_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'latest dispatch token completes action');
reset role;
select is((select count(*)::int from public.external_action_jobs where id=current_setting('test.storage_job')::uuid), 0,
  'completed action leaves no queue row');

insert into public.barbers (id, name) values ('storage-reconciler', 'Storage Reconciler');
insert into storage.objects (bucket_id, name, created_at) values
  ('gallery', 'salon/orphan-old.webp', pg_catalog.now() - interval '31 minutes'),
  ('barber-photos', 'storage-reconciler/orphan-old.webp', pg_catalog.now() - interval '31 minutes'),
  ('gallery', 'salon/orphan-fresh.webp', pg_catalog.now()),
  ('gallery', 'salon/referenced.webp', pg_catalog.now() - interval '31 minutes'),
  ('barber-photos', 'storage-reconciler/referenced.webp', pg_catalog.now() - interval '31 minutes');
insert into public.gallery_images (kind, storage_path, alt)
values ('salon', 'salon/referenced.webp', 'Referenced');
insert into public.barber_photos (barber_id, storage_path)
values ('storage-reconciler', 'storage-reconciler/referenced.webp');

select is(public.queue_orphaned_storage_objects(), 2,
  'reconciler queues every old unreferenced managed object');
select is((select count(*)::int from public.external_action_jobs
  where action_type='storage_object_delete' and dedupe_key='gallery:salon/orphan-old.webp'), 1,
  'old gallery orphan receives durable deletion intent');
select is((select count(*)::int from public.external_action_jobs
  where action_type='storage_object_delete'
    and dedupe_key='barber-photos:storage-reconciler/orphan-old.webp'), 1,
  'old barber-photo orphan receives durable deletion intent');
select is((select count(*)::int from public.external_action_jobs
  where action_type='storage_object_delete' and dedupe_key='gallery:salon/orphan-fresh.webp'), 0,
  'fresh upload receives reconciliation grace period');
select is((select count(*)::int from public.external_action_jobs
  where action_type='storage_object_delete'
    and dedupe_key in (
      'gallery:salon/referenced.webp',
      'barber-photos:storage-reconciler/referenced.webp'
    )), 0, 'referenced Storage objects are never queued');

select set_config('test.orphan_job', (select id::text from public.external_action_jobs
  where action_type='storage_object_delete' and dedupe_key='gallery:salon/orphan-old.webp'), true);
set local role service_role;
select set_config('test.orphan_claim', public.claim_external_action(
  current_setting('test.orphan_job')::uuid
)::text, true);
reset role;
select is(public.queue_orphaned_storage_objects(), 0,
  'reconciliation leaves existing pending and dispatching intents untouched');
select is((select dispatch_token::text from public.external_action_jobs
  where id=current_setting('test.orphan_job')::uuid),
  current_setting('test.orphan_claim')::jsonb ->> 'dispatch_token',
  'reconciliation never invalidates an in-flight worker token');

insert into storage.objects (bucket_id, name, created_at)
values ('gallery', 'salon/adopted-before-dispatch.webp', pg_catalog.now() - interval '31 minutes');
select is(public.queue_orphaned_storage_objects(), 1,
  'newly observed orphan receives one durable deletion intent');
insert into public.gallery_images (kind, storage_path, alt)
values ('salon', 'salon/adopted-before-dispatch.webp', 'Adopted');
select set_config('test.adopted_job', (select id::text from public.external_action_jobs
  where action_type='storage_object_delete'
    and dedupe_key='gallery:salon/adopted-before-dispatch.webp'), true);
set local role service_role;
select set_config('test.adopted_claim', public.claim_external_action(
  current_setting('test.adopted_job')::uuid
)::text, true);
select is((current_setting('test.adopted_claim')::jsonb) ->> 'superseded', 'true',
  'dispatch rechecks metadata and suppresses deletion when object became referenced');
select is(public.complete_external_action(
  current_setting('test.adopted_job')::uuid,
  (current_setting('test.adopted_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'superseded Storage deletion completes without deleting referenced bytes');
reset role;

insert into public.barbers (id, name) values ('calendar-outbox', 'Calendar Outbox');
insert into public.barber_calendar_tokens (barber_id, refresh_token, google_email)
values ('calendar-outbox', 'refresh-secret', 'calendar@example.test');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('33000000-0000-0000-0000-000000000010', 'calendar-outbox', 'service', 'Service', 300, 30,
   '2099-08-01 09:00+00', '2099-08-01 09:30+00', 'Calendar Customer', 'email',
   '0703300010', 'customer@example.test', 'sv', 'confirmed');
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values ('33000000-0000-0000-0000-000000000010', 'calendar-outbox', 'primary', 'google-event-10');

update public.bookings set status='cancelled', cancelled_at=pg_catalog.now()
where id='33000000-0000-0000-0000-000000000010';
select is((select count(*)::int from public.external_action_jobs
  where action_type='calendar_event_delete' and dedupe_key='33000000-0000-0000-0000-000000000010'), 1,
  'booking cancellation queues durable Calendar deletion');
select is((select position('refresh-secret' in payload::text) from public.external_action_jobs
  where action_type='calendar_event_delete' and dedupe_key='33000000-0000-0000-0000-000000000010'), 0,
  'Calendar queue payload stores no OAuth credential');
select is((select count(*)::int from public.calendar_event_map
  where booking_id='33000000-0000-0000-0000-000000000010'), 1,
  'Google event identifier survives until deletion succeeds');

select set_config('test.calendar_job', (select id::text from public.external_action_jobs
  where action_type='calendar_event_delete' and dedupe_key='33000000-0000-0000-0000-000000000010'), true);
set local role service_role;
select set_config('test.calendar_claim', public.claim_external_action(
  current_setting('test.calendar_job')::uuid
)::text, true);
select is((current_setting('test.calendar_claim')::jsonb) ->> 'google_event_id', 'google-event-10',
  'worker resolves preserved Google event id server-side');
select is((current_setting('test.calendar_claim')::jsonb) ->> 'refresh_token', 'refresh-secret',
  'worker resolves OAuth credential server-side only after claim');
select public.calendar_forget_event('33000000-0000-0000-0000-000000000010');
reset role;
select is((select count(*)::int from public.calendar_event_map
  where booking_id='33000000-0000-0000-0000-000000000010'), 0,
  'successful external delete may then forget mapping');
set local role service_role;
select is(public.complete_external_action(
  current_setting('test.calendar_job')::uuid,
  (current_setting('test.calendar_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'Calendar action completes after mapping cleanup');
reset role;

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('33000000-0000-0000-0000-000000000011', 'calendar-outbox', 'service', 'Service', 300, 30,
   '2099-08-02 09:00+00', '2099-08-02 09:30+00', 'Delete Customer', 'email',
   '0703300011', 'delete@example.test', 'sv', 'confirmed');
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values ('33000000-0000-0000-0000-000000000011', 'calendar-outbox', 'primary', 'google-event-11');
update public.booking_email_delivery_jobs
set status='delivered', completed_at=pg_catalog.now()
where booking_id='33000000-0000-0000-0000-000000000011';
delete from public.bookings where id='33000000-0000-0000-0000-000000000011';
select is((select count(*)::int from public.calendar_event_map
  where booking_id='33000000-0000-0000-0000-000000000011'), 1,
  'hard booking delete preserves external event mapping');
select is((select count(*)::int from public.external_action_jobs
  where action_type='calendar_event_delete' and dedupe_key='33000000-0000-0000-0000-000000000011'), 1,
  'hard booking delete queues external event removal');

set local role service_role;
select public.calendar_record_event(
  '33000000-0000-0000-0000-000000000012', 'calendar-outbox', 'late-google-event'
);
reset role;
select is((select count(*)::int from public.calendar_event_map
  where booking_id='33000000-0000-0000-0000-000000000012'), 1,
  'late Calendar insert preserves identifier despite missing booking');
select is((select count(*)::int from public.external_action_jobs
  where action_type='calendar_event_delete' and dedupe_key='33000000-0000-0000-0000-000000000012'), 1,
  'late Calendar insert is immediately queued for deletion');

set local role service_role;
select set_config('test.disconnect', public.prepare_calendar_disconnect('calendar-outbox')::text, true);
select is((current_setting('test.disconnect')::jsonb) ->> 'pending', 'true',
  'disconnect enters durable pending state');
reset role;
select ok((select disconnect_requested_at is not null from public.barber_calendar_tokens
  where barber_id='calendar-outbox'), 'disconnect keeps token while cleanup drains');
select ok((select count(*) > 0 from public.external_action_jobs
  where action_type='calendar_event_delete'), 'disconnect queues every remaining external event');
select is((select count(*)::int from public.external_action_jobs
  where action_type='calendar_disconnect' and dedupe_key='calendar-outbox'), 1,
  'disconnect itself is durable and retryable');
select is(public.calendar_sync_source('33000000-0000-0000-0000-000000000010')->>'refresh_token',
  null, 'pending disconnect blocks new Calendar sync');

select set_config('test.repair_job', (select id::text from public.external_action_jobs
  where action_type='calendar_event_delete'
    and dedupe_key='33000000-0000-0000-0000-000000000012'), true);
set local role service_role;
select set_config('test.repair_claim', public.claim_external_action(
  current_setting('test.repair_job')::uuid
)::text, true);
select public.block_external_action(
  current_setting('test.repair_job')::uuid,
  (current_setting('test.repair_claim')::jsonb ->> 'dispatch_token')::uuid,
  'calendar_authorization_required'
);
select is(public.calendar_store_token(
  'calendar-outbox', 'wrong-account-token', 'other@example.test', 'primary'
) ->> 'error', 'account_mismatch', 'disconnect repair rejects a different Google account');
reset role;
select is((select refresh_token from public.barber_calendar_tokens where barber_id='calendar-outbox'),
  'refresh-secret', 'account mismatch preserves the original server-side credential');
set local role service_role;
select is(public.calendar_store_token(
  'calendar-outbox', 'replacement-secret', 'calendar@example.test', 'primary'
) ->> 'cleanup_pending', 'true', 'same-account authorization repairs pending cleanup');
reset role;
select is((select refresh_token from public.barber_calendar_tokens where barber_id='calendar-outbox'),
  'replacement-secret', 'same-account repair rotates the server-side credential');
select is((select status from public.external_action_jobs where id=current_setting('test.repair_job')::uuid),
  'pending', 'same-account repair resumes blocked Calendar deletion');

-- Simulate Google deletion acknowledgements for every remaining Calendar job before asking whether
-- disconnect is safe.  A drained map alone is insufficient once direct identity jobs are durable.
delete from public.calendar_event_map where barber_id='calendar-outbox';
do $$
declare
  v_job record;
  v_claim jsonb;
begin
  for v_job in
    select id
    from public.external_action_jobs
    where action_type='calendar_event_delete'
      and payload->>'barber_id'='calendar-outbox'
  loop
    v_claim := public.claim_external_action(v_job.id);
    if v_claim is not null then
      perform public.complete_external_action(
        v_job.id,
        (v_claim->>'dispatch_token')::uuid
      );
    end if;
  end loop;
end;
$$;
update public.barber_calendar_tokens set disconnect_requested_at=pg_catalog.now()-interval '6 minutes'
where barber_id='calendar-outbox';
select set_config('test.disconnect_job', (select id::text from public.external_action_jobs
  where action_type='calendar_disconnect' and dedupe_key='calendar-outbox'), true);
set local role service_role;
select set_config('test.disconnect_claim', public.claim_external_action(
  current_setting('test.disconnect_job')::uuid
)::text, true);
select is((current_setting('test.disconnect_claim')::jsonb) ->> 'ready', 'true',
  'disconnect becomes ready only after event mappings drain and grace period passes');
select is((current_setting('test.disconnect_claim')::jsonb) ->> 'refresh_token', 'replacement-secret',
  'revoke credential remains available until disconnect execution');
select public.calendar_delete_token('calendar-outbox');
reset role;
select is((select count(*)::int from public.barber_calendar_tokens where barber_id='calendar-outbox'), 0,
  'successful revoke may then remove local token');
set local role service_role;
select is(public.complete_external_action(
  current_setting('test.disconnect_job')::uuid,
  (current_setting('test.disconnect_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'disconnect action completes after token cleanup');
reset role;

insert into public.barbers (id, name) values ('auth-outbox', 'Auth Outbox');
insert into auth.users (id, email) values
  ('33000000-0000-0000-0000-000000000020', 'owner@outbox.test'),
  ('33000000-0000-0000-0000-000000000021', 'barber@outbox.test');
insert into public.profiles (id, role, barber_id) values
  ('33000000-0000-0000-0000-000000000020', 'owner', null),
  ('33000000-0000-0000-0000-000000000021', 'barber', 'auth-outbox');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','33000000-0000-0000-0000-000000000020')::text, true);
select set_config('test.disable', public.admin_set_barber_account_enabled('auth-outbox', false)::text, true);
select is((current_setting('test.disable')::jsonb) ->> 'account_enabled', 'false',
  'owner database authorization change is immediate');
reset role;
select is((select count(*)::int from public.external_action_jobs
  where action_type='auth_user_access_sync' and dedupe_key='33000000-0000-0000-0000-000000000021'), 1,
  'Auth-side ban is queued durably');
select set_config('test.auth_job', (select id::text from public.external_action_jobs
  where action_type='auth_user_access_sync' and dedupe_key='33000000-0000-0000-0000-000000000021'), true);
set local role service_role;
select set_config('test.auth_old_claim', public.claim_external_action(
  current_setting('test.auth_job')::uuid
)::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','33000000-0000-0000-0000-000000000020')::text, true);
select public.admin_set_barber_account_enabled('auth-outbox', true);
reset role;
set local role service_role;
select is(public.complete_external_action(
  current_setting('test.auth_job')::uuid,
  (current_setting('test.auth_old_claim')::jsonb ->> 'dispatch_token')::uuid
), false, 'stale Auth worker cannot overwrite newer account state');
select set_config('test.auth_current_claim', public.claim_external_action(
  current_setting('test.auth_job')::uuid
)::text, true);
select is((current_setting('test.auth_current_claim')::jsonb) ->> 'account_enabled', 'true',
  'latest Auth action resolves current database state');
select is(public.complete_external_action(
  current_setting('test.auth_job')::uuid,
  (current_setting('test.auth_current_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'latest Auth worker completes successfully');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','33000000-0000-0000-0000-000000000020')::text, true);
select set_config('test.delete_auth', public.admin_delete_barber('auth-outbox')::text, true);
select is((current_setting('test.delete_auth')::jsonb) ->> 'ok', 'true',
  'barber deletion atomically queues Auth cleanup before local deletion');
reset role;
select is((select count(*)::int from public.profiles where id='33000000-0000-0000-0000-000000000021'), 0,
  'deleted barber profile is gone immediately');
select is((select count(*)::int from public.external_action_jobs
  where action_type='auth_user_delete' and dedupe_key='33000000-0000-0000-0000-000000000021'), 1,
  'Auth deletion intent survives profile and barber deletion');

insert into public.barbers (id, name) values ('calendar-delete', 'Calendar Delete');
insert into public.barber_calendar_tokens (barber_id, refresh_token)
values ('calendar-delete', 'delete-refresh');
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values ('33000000-0000-0000-0000-000000000030', 'calendar-delete', 'primary', 'delete-event');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','33000000-0000-0000-0000-000000000020')::text, true);
select set_config('test.delete_calendar', public.admin_delete_barber('calendar-delete')::text, true);
select is((current_setting('test.delete_calendar')::jsonb) ->> 'error', 'external_cleanup_pending',
  'barber deletion waits for external Calendar cleanup');
reset role;
select is((select count(*)::int from public.barbers where id='calendar-delete'), 1,
  'barber remains until external Calendar identifiers are safely removed');

select * from finish();
rollback;
