-- pgTAP — Calendar reassignment lifecycle.
--
-- The map is an immutable cleanup identity until Google deletion succeeds.  All credentials below
-- are test fixtures only; production job payloads are checked to contain identifiers, never tokens
-- or booking PII.

begin;
select plan(36);

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

select * from finish();
rollback;
