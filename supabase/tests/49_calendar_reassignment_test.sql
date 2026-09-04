-- pgTAP — Calendar reassignment lifecycle.
--
-- The map is an immutable cleanup identity until Google deletion succeeds.  All credentials below
-- are test fixtures only; production job payloads are checked to contain identifiers, never tokens
-- or booking PII.

begin;
select plan(62);

select ok(
  (select a.attnotnull
   from pg_catalog.pg_attribute a
   where a.attrelid = 'public.calendar_event_map'::regclass
     and a.attname = 'calendar_id'),
  'calendar_event_map requires an explicit calendar_id'
);
select is(
  (select count(*)::int
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a
     on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.calendar_event_map'::regclass
     and a.attname = 'calendar_id'),
  0,
  'calendar_event_map has no guessed calendar_id default'
);
select ok(has_function_privilege(
  'service_role',
  'public.calendar_queue_event_deletion_for_identity(uuid,text,text,text)',
  'EXECUTE'
), 'service_role can queue an immutable Calendar cleanup identity');
select ok(not has_function_privilege(
  'anon',
  'public.calendar_queue_event_deletion_for_identity(uuid,text,text,text)',
  'EXECUTE'
), 'anon cannot queue Calendar cleanup identities');
select ok(has_function_privilege(
  'service_role',
  'public.calendar_forget_event_if_matches(uuid,text,text,text)',
  'EXECUTE'
), 'service_role can perform exact Calendar map CAS cleanup');
select ok(not has_function_privilege(
  'authenticated',
  'public.calendar_forget_event_if_matches(uuid,text,text,text)',
  'EXECUTE'
), 'authenticated cannot perform Calendar map CAS cleanup');
select ok(has_function_privilege(
  'service_role',
  'public.calendar_record_event_if_current(uuid,text,text,text)',
  'EXECUTE'
), 'service_role can perform conditional Calendar map recording');
select ok(not has_function_privilege(
  'authenticated',
  'public.calendar_record_event_if_current(uuid,text,text,text)',
  'EXECUTE'
), 'authenticated cannot perform conditional Calendar map recording');
select ok(has_function_privilege(
  'service_role',
  'public.calendar_external_action_for_dispatch(uuid,uuid)',
  'EXECUTE'
), 'service_role can use the Calendar dispatch seam');
select ok(not has_function_privilege(
  'anon',
  'public.calendar_external_action_for_dispatch(uuid,uuid)',
  'EXECUTE'
), 'anon cannot use the Calendar dispatch seam');

insert into public.barbers (id, name) values
  ('calendar-reassign-a', 'Calendar Reassign A'),
  ('calendar-reassign-b', 'Calendar Reassign B');
insert into public.barber_calendar_tokens (barber_id, refresh_token, google_email, calendar_id)
values
  ('calendar-reassign-a', 'refresh-a', 'a@example.test', 'calendar-a'),
  ('calendar-reassign-b', 'refresh-b', 'b@example.test', 'calendar-b');
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('49000000-0000-0000-0000-000000000001', 'calendar-reassign-b', 'service', 'Service', 300, 30,
   '2099-09-01 09:00+00', '2099-09-01 09:30+00', 'Reassigned Customer', 'email',
   '0704900001', 'reassigned@example.test', 'sv', 'confirmed');
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values
  ('49000000-0000-0000-0000-000000000001', 'calendar-reassign-a', 'calendar-a', 'old-event-a');
select is(
  (select count(*)::int
   from public.calendar_event_map m
   left join public.barber_calendar_tokens t on t.barber_id = m.barber_id
   where t.google_email is null or pg_catalog.btrim(t.google_email) = ''),
  0, 'mapped Calendar identities have a non-empty Google account'
);

select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'barber_id',
  'calendar-reassign-b', 'source resolves the current destination barber'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'google_event_id',
  null, 'source never treats the old barber event as the destination event'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'mapped_barber_id',
  'calendar-reassign-a', 'source preserves the old barber identity'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'mapped_calendar_id',
  'calendar-a', 'source preserves the old Calendar identity'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'mapped_refresh_token',
  'refresh-a', 'source resolves the old barbers current server credential'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'customer_name',
  'Reassigned Customer', 'source retains the authorized Calendar customer name'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'phone',
  '0704900001', 'source retains the authorized Calendar phone'
);
select is(
  public.calendar_sync_source('49000000-0000-0000-0000-000000000001')->>'email',
  'reassigned@example.test', 'source retains the authorized Calendar email'
);

select is(public.calendar_record_event_if_current(
  '49000000-0000-0000-0000-000000000001',
  'calendar-reassign-b', 'calendar-b', 'new-event-b'
), false, 'conditional record rejects an old mapping winner');
select is(
  (select barber_id from public.calendar_event_map
   where booking_id='49000000-0000-0000-0000-000000000001'),
  'calendar-reassign-a', 'conditional record never overwrites the old mapping'
);
select is(public.calendar_forget_event_if_matches(
  '49000000-0000-0000-0000-000000000001',
  'calendar-reassign-b', 'calendar-b', 'new-event-b'
), false, 'exact forget reports a mapping race');
select is(
  (select google_event_id from public.calendar_event_map
   where booking_id='49000000-0000-0000-0000-000000000001'),
  'old-event-a', 'a failed exact forget preserves the newer mapping winner'
);

-- Simulate an old worker writing the stable booking-derived destination event after Expand.  The
-- compatibility function must preserve the old map and requeue the booking for the new worker.
select set_config('test.sync_job', (select id::text from public.external_action_jobs
  where action_type='calendar_event_sync'
    and dedupe_key='49000000-0000-0000-0000-000000000001'), true);
select set_config('test.sync_claim', public.claim_external_action(
  current_setting('test.sync_job')::uuid
)::text, true);
select public.calendar_record_event(
  '49000000-0000-0000-0000-000000000001',
  'calendar-reassign-b',
  'bbs490000000000000000000000000001'
);
select is(
  (select barber_id from public.calendar_event_map
   where booking_id='49000000-0000-0000-0000-000000000001'),
  'calendar-reassign-a', 'old-worker compatibility write preserves old cleanup identity'
);
select is(
  (select count(*)::int from public.external_action_jobs
   where action_type='calendar_event_sync'
     and dedupe_key='49000000-0000-0000-0000-000000000001'),
  1, 'old-worker compatibility write requeues one sync action'
);
select is(
  (select status from public.external_action_jobs
   where action_type='calendar_event_sync'
     and dedupe_key='49000000-0000-0000-0000-000000000001'),
  'pending', 'compatibility requeue clears the stale dispatch state'
);
select is(
  (select dispatch_token from public.external_action_jobs
   where action_type='calendar_event_sync'
     and dedupe_key='49000000-0000-0000-0000-000000000001'),
  null, 'compatibility requeue invalidates the old worker dispatch token'
);

select set_config('test.identity_job', public.calendar_queue_event_deletion_for_identity(
  '49000000-0000-0000-0000-000000000001',
  'calendar-reassign-a', 'calendar-a', 'old-event-a'
)::text, true);
select is(
  (select payload - 'booking_id' - 'barber_id' - 'calendar_id' - 'google_event_id'
   from public.external_action_jobs where id=current_setting('test.identity_job')::uuid)::text,
  '{}', 'durable Calendar cleanup payload contains identifiers only'
);
select is(
  (select position('refresh-' in payload::text)
   from public.external_action_jobs where id=current_setting('test.identity_job')::uuid),
  0, 'durable Calendar cleanup payload contains no OAuth credential'
);
select is(
  (select position('Reassigned Customer' in payload::text)
   from public.external_action_jobs where id=current_setting('test.identity_job')::uuid),
  0, 'durable Calendar cleanup payload contains no booking PII'
);

update public.barber_calendar_tokens
set refresh_token='refresh-a-rotated'
where barber_id='calendar-reassign-a';
select set_config('test.identity_claim', public.claim_external_action(
  current_setting('test.identity_job')::uuid
)::text, true);
select is(
  public.calendar_external_action_for_dispatch(
    current_setting('test.identity_job')::uuid,
    (current_setting('test.identity_claim')::jsonb ->> 'dispatch_token')::uuid
  )->>'refresh_token',
  'refresh-a-rotated', 'cleanup resolves the old barbers current credential at dispatch'
);
select is(
  public.calendar_external_action_for_dispatch(
    current_setting('test.identity_job')::uuid,
    (current_setting('test.identity_claim')::jsonb ->> 'dispatch_token')::uuid
  )->>'google_event_id',
  'old-event-a', 'cleanup dispatch preserves the immutable old event id'
);
select is(public.calendar_forget_event_if_matches(
  '49000000-0000-0000-0000-000000000001',
  'calendar-reassign-a', 'calendar-a', 'old-event-a'
), true, 'successful old-event delete can acknowledge the exact map');
select is(public.complete_external_action(
  current_setting('test.identity_job')::uuid,
  (current_setting('test.identity_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'identity cleanup action completes after exact map acknowledgement');
select is(
  (select count(*)::int from public.calendar_event_map
   where booking_id='49000000-0000-0000-0000-000000000001'),
  0, 'old mapping is retired only after exact cleanup acknowledgement'
);

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('49000000-0000-0000-0000-000000000002', 'calendar-reassign-a', 'service', 'Service', 300, 30,
   '2099-09-02 09:00+00', '2099-09-02 09:30+00', 'Cancelled Customer', 'email',
   '0704900002', 'cancelled@example.test', 'sv', 'confirmed');
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values
  ('49000000-0000-0000-0000-000000000002', 'calendar-reassign-a', 'calendar-a', 'cancel-event-a');
update public.bookings
set status='cancelled', cancelled_at=pg_catalog.now()
where id='49000000-0000-0000-0000-000000000002';
select is(
  (select payload->>'calendar_id' from public.external_action_jobs
   where action_type='calendar_event_delete'
     and dedupe_key='49000000-0000-0000-0000-000000000002'),
  'calendar-a', 'cancellation snapshots the old Calendar id'
);
select is(
  (select position('refresh-a-rotated' in payload::text)
   from public.external_action_jobs
   where action_type='calendar_event_delete'
     and dedupe_key='49000000-0000-0000-0000-000000000002'),
  0, 'cancellation cleanup payload contains no current refresh token'
);

-- A real reassignment update to a barber without a usable token must still enqueue cleanup.  The
-- old A identity remains authoritative; the sync worker receives no destination event identity and
-- therefore performs no replacement insert.
delete from public.barber_calendar_tokens
where barber_id='calendar-reassign-b';
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('49000000-0000-0000-0000-000000000004', 'calendar-reassign-a', 'service', 'Service', 300, 30,
   '2099-09-04 09:00+00', '2099-09-04 09:30+00', 'Unlinked Customer', 'email',
   '0704900004', 'unlinked@example.test', 'sv', 'confirmed');
delete from public.external_action_jobs
where action_type='calendar_event_sync'
  and dedupe_key='49000000-0000-0000-0000-000000000004';
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values
  ('49000000-0000-0000-0000-000000000004', 'calendar-reassign-a', 'calendar-a', 'old-event-unlinked');
update public.bookings
set barber_id='calendar-reassign-b'
where id='49000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.external_action_jobs
   where action_type='calendar_event_sync'
     and dedupe_key='49000000-0000-0000-0000-000000000004'),
  1, 'A to unlinked B reassignment queues cleanup-only sync'
);
select is(
  (select (payload - 'booking_id')::text from public.external_action_jobs
   where action_type='calendar_event_sync'
     and dedupe_key='49000000-0000-0000-0000-000000000004'),
  '{}', 'unlinked reassignment sync payload remains identifier-only'
);
select set_config('test.unlinked_job', (select id::text from public.external_action_jobs
  where action_type='calendar_event_sync'
    and dedupe_key='49000000-0000-0000-0000-000000000004'), true);
select set_config('test.unlinked_claim', public.claim_external_action(
  current_setting('test.unlinked_job')::uuid
)::text, true);
select is(
  public.calendar_external_action_for_dispatch(
    current_setting('test.unlinked_job')::uuid,
    (current_setting('test.unlinked_claim')::jsonb ->> 'dispatch_token')::uuid
  )->>'calendar_id',
  null, 'unlinked reassignment has no destination Calendar'
);
select is(
  public.calendar_external_action_for_dispatch(
    current_setting('test.unlinked_job')::uuid,
    (current_setting('test.unlinked_claim')::jsonb ->> 'dispatch_token')::uuid
  )->>'google_event_id',
  null, 'unlinked reassignment has no destination event replacement'
);
select is(
  public.calendar_external_action_for_dispatch(
    current_setting('test.unlinked_job')::uuid,
    (current_setting('test.unlinked_claim')::jsonb ->> 'dispatch_token')::uuid
  )->>'mapped_barber_id',
  'calendar-reassign-a', 'cleanup-only dispatch preserves old barber identity'
);
select is(
  public.calendar_external_action_for_dispatch(
    current_setting('test.unlinked_job')::uuid,
    (current_setting('test.unlinked_claim')::jsonb ->> 'dispatch_token')::uuid
  )->>'mapped_google_event_id',
  'old-event-unlinked', 'cleanup-only dispatch preserves old event identity'
);
select is(
  (select barber_id from public.calendar_event_map
   where booking_id='49000000-0000-0000-0000-000000000004'),
  'calendar-reassign-a', 'unlinked reassignment never overwrites the old map early'
);
select is(public.calendar_forget_event_if_matches(
  '49000000-0000-0000-0000-000000000004',
  'calendar-reassign-a', 'calendar-a', 'old-event-unlinked'
), true, 'cleanup-only dispatch can acknowledge old Google deletion');
select is(public.complete_external_action(
  current_setting('test.unlinked_job')::uuid,
  (current_setting('test.unlinked_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'cleanup-only sync completes after old deletion');
select is(
  (select count(*)::int from public.calendar_event_map
   where booking_id='49000000-0000-0000-0000-000000000004'),
  0, 'unlinked reassignment leaves no stale old mapping after deletion'
);

-- A connected barber can have a sync-only authorization block.  Reauthorization must be visible for
-- that job too, bind to the same Google account, and leave valid mapped events untouched.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status)
values
  ('49000000-0000-0000-0000-000000000003', 'calendar-reassign-a', 'service', 'Service', 300, 30,
   '2099-09-03 09:00+00', '2099-09-03 09:30+00', 'Valid Customer', 'email',
   '0704900003', 'valid@example.test', 'sv', 'confirmed');
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
values
  ('49000000-0000-0000-0000-000000000003', 'calendar-reassign-a', 'calendar-a', 'valid-event-a');
select set_config('test.repair_sync_job', (select id::text from public.external_action_jobs
  where action_type='calendar_event_sync'
    and dedupe_key='49000000-0000-0000-0000-000000000003'), true);
set local role service_role;
select set_config('test.repair_sync_claim', public.claim_external_action(
  current_setting('test.repair_sync_job')::uuid
)::text, true);
select public.block_external_action(
  current_setting('test.repair_sync_job')::uuid,
  (current_setting('test.repair_sync_claim')::jsonb ->> 'dispatch_token')::uuid,
  'calendar_authorization_required'
);
reset role;

insert into auth.users (id, email)
values ('49000000-0000-0000-0000-000000000010', 'barber-a@example.test');
insert into public.profiles (id, role, barber_id)
values ('49000000-0000-0000-0000-000000000010', 'barber', 'calendar-reassign-a');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', '49000000-0000-0000-0000-000000000010')::text,
  true
);
select is(public.calendar_connection_status()->>'repair_required', 'true',
  'connected barber status exposes sync-only Calendar repair');
reset role;

set local role service_role;
select is(public.calendar_store_token(
  'calendar-reassign-a', 'wrong-account-refresh', 'other@example.test', 'calendar-a'
) ->> 'error', 'account_mismatch', 'sync-only connected repair rejects a different Google account');
reset role;
select is((select refresh_token from public.barber_calendar_tokens
  where barber_id='calendar-reassign-a'), 'refresh-a-rotated',
  'connected account mismatch preserves the current credential');
set local role service_role;
select is(public.calendar_store_token(
  'calendar-reassign-a', 'repair-refresh-a', 'A@EXAMPLE.TEST', 'calendar-a'
) ->> 'repair_pending', 'true', 'same-account sync repair reactivates cleanup');
reset role;
select is((select status from public.external_action_jobs
  where id=current_setting('test.repair_sync_job')::uuid), 'pending',
  'connected repair resumes blocked sync');
select is((select count(*)::int from public.external_action_jobs
  where action_type='calendar_event_delete'
    and dedupe_key='49000000-0000-0000-0000-000000000003'), 0,
  'connected repair does not queue deletion for a valid mapped event');
select is((select google_event_id from public.calendar_event_map
  where booking_id='49000000-0000-0000-0000-000000000003'), 'valid-event-a',
  'connected repair preserves the valid mapped event');
select is((select disconnect_requested_at is null from public.barber_calendar_tokens
  where barber_id='calendar-reassign-a'), true,
  'connected repair keeps the ordinary connected state');

-- A separately blocked direct deletion is reactivated by the same connected repair branch.
set local role service_role;
select set_config('test.repair_job', public.calendar_queue_event_deletion_for_identity(
  '49000000-0000-0000-0000-000000000002',
  'calendar-reassign-a', 'calendar-a', 'repair-event-a'
)::text, true);
select set_config('test.repair_claim', public.claim_external_action(
  current_setting('test.repair_job')::uuid
)::text, true);
select public.block_external_action(
  current_setting('test.repair_job')::uuid,
  (current_setting('test.repair_claim')::jsonb ->> 'dispatch_token')::uuid,
  'calendar_authorization_required'
);
select is(public.calendar_store_token(
  'calendar-reassign-a', 'repair-refresh-a-2', 'a@example.test', 'calendar-a'
) ->> 'repair_pending', 'true', 'connected repair reactivates blocked deletion');
reset role;
select is((select status from public.external_action_jobs
  where id=current_setting('test.repair_job')::uuid), 'pending',
  'connected repair resumes the blocked direct deletion');

-- A normal connected upsert cannot switch accounts while any old Calendar identity remains bound.
set local role service_role;
select is(public.calendar_store_token(
  'calendar-reassign-a', 'wrong-connected-refresh', 'other@example.test', 'calendar-a'
) ->> 'error', 'account_mismatch',
  'normal connected upsert rejects an account switch while cleanup identity remains');
reset role;
select is((select refresh_token from public.barber_calendar_tokens
  where barber_id='calendar-reassign-a'), 'repair-refresh-a-2',
  'normal account mismatch preserves the current credential');
select is((select google_event_id from public.calendar_event_map
  where booking_id='49000000-0000-0000-0000-000000000003'), 'valid-event-a',
  'normal account mismatch preserves the mapped event');
set local role service_role;
select is(public.calendar_store_token(
  'calendar-reassign-a', 'normal-refresh-a', 'a@example.test', 'calendar-a'
) ->> 'cleanup_pending', 'false',
  'same-account connected rotation remains an ordinary upsert');
reset role;
select is((select refresh_token from public.barber_calendar_tokens
  where barber_id='calendar-reassign-a'), 'normal-refresh-a',
  'same-account connected rotation stores the new credential');

select * from finish();
rollback;
