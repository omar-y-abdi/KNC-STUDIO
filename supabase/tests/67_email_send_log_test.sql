begin;
select plan(83);

-- The log is reachable only through the narrow RPCs.
select has_table('public', 'email_send_log', 'the email delivery log table exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.email_send_log'::regclass),
  'the email delivery log has RLS enabled');
select ok(not pg_catalog.has_table_privilege('service_role', 'public.email_send_log', 'select'),
  'service role cannot read the log directly');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.internal_record_email_send(text,text,text,text,text,text,text,text,uuid)', 'execute'),
  'anon cannot write log rows');
select ok(not pg_catalog.has_function_privilege('authenticated',
  'public.internal_record_email_send(text,text,text,text,text,text,text,text,uuid)', 'execute'),
  'browser sessions cannot write log rows');
select ok(pg_catalog.has_function_privilege('service_role',
  'public.internal_record_email_send(text,text,text,text,text,text,text,text,uuid)', 'execute'),
  'the Edge senders can write log rows');
select ok(not pg_catalog.has_function_privilege('anon', 'public.internal_purge_email_send_log()', 'execute'),
  'anon cannot purge the log');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.internal_purge_email_send_log()', 'execute'),
  'browser sessions cannot purge the log');
select ok(not pg_catalog.has_function_privilege('service_role', 'public.internal_purge_email_send_log()', 'execute'),
  'service role cannot bypass the cron-owned purge');
select is((select pg_catalog.array_agg(j.schedule || ' ' || j.command) from cron.job j
  where j.jobname = 'email-send-log-purge'),
  array['29 3 * * * select public.internal_purge_email_send_log()'],
  'one daily cron job purges the log');

-- One row per message: retries under the same dedupe key update it, and sent is final.
set local role service_role;
select lives_ok($$select public.internal_record_email_send(repeat('a', 64), 'auth_recovery',
  'kund@email-log.local', 'S-now', '<p>now</p>', 'now', 'failed', 'send_failed_transient', null)$$,
  'a failed attempt is recorded');
select lives_ok($$select public.internal_record_email_send(repeat('a', 64), 'auth_recovery',
  'kund@email-log.local', 'S-now', '<p>now</p>', 'now', 'sent', null, null)$$,
  'the retry of the same message is recorded');
reset role;
select is((select pg_catalog.count(*)::int from public.email_send_log where dedupe_key = repeat('a', 64)),
  1, 'a retried message keeps one row');
select is((select status || ':' || coalesce(error_code, '') || ':' || attempt_count
  from public.email_send_log where dedupe_key = repeat('a', 64)),
  'sent::2', 'the row carries the latest status and counts the attempt');
set local role service_role;
select lives_ok($$select public.internal_record_email_send(repeat('a', 64), 'auth_recovery',
  'kund@email-log.local', 'S-now', '<p>now</p>', 'now', 'failed', 'send_failed_permanent', null)$$,
  'a later failed attempt of a delivered message is accepted');
reset role;
select is((select status || ':' || coalesce(error_code, '') || ':' || attempt_count
  from public.email_send_log where dedupe_key = repeat('a', 64)),
  'sent::2', 'a later failure cannot turn a delivered message back into a failure');
set local role service_role;
select throws_ok($$select public.internal_record_email_send('auth-recovery/token-hash-prefix',
  'auth_recovery', 'kund@email-log.local', 'S', '<p></p>', '', 'sent', null, null)$$,
  '23514', null, 'a raw idempotency key cannot be stored as the dedupe key');
select throws_ok($$select public.internal_record_email_send(repeat('c', 64), 'newsletter',
  'kund@email-log.local', 'S', '<p></p>', '', 'sent', null, null)$$,
  '23514', null, 'an unknown email kind is rejected');
select throws_ok($$select public.internal_record_email_send(repeat('d', 64), 'auth_invite',
  'kund@email-log.local', 'S', '<p></p>', '', 'failed', null, null)$$,
  '23514', null, 'a failure without a reason is rejected');
reset role;

-- Read access is owner-only.
insert into public.barbers (id, name) values ('mejllogg', 'Mejl Logg');
insert into auth.users (id, email) values
  ('67000000-0000-4000-8000-000000000001', 'owner@email-log.local'),
  ('67000000-0000-4000-8000-000000000002', 'barber@email-log.local');
insert into public.profiles (id, role, barber_id) values
  ('67000000-0000-4000-8000-000000000001', 'owner', null),
  ('67000000-0000-4000-8000-000000000002', 'barber', 'mejllogg');

set local role anon;
select throws_ok($$select * from public.email_send_log$$, '42501', null,
  'anon cannot select the log');
select throws_ok($$select public.admin_list_email_send_log()$$, '42501', null,
  'anon cannot list the log');
select throws_ok($$select public.admin_get_email_send_log_entry('67000000-0000-4000-8000-0000000000ff')$$,
  '42501', null, 'anon cannot read a stored copy');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select * from public.email_send_log$$, '42501', null,
  'a barber cannot select the log');
select throws_ok($$select public.admin_list_email_send_log()$$, '42501', 'owner required',
  'a barber cannot list the log');
select throws_ok($$select public.admin_get_email_send_log_entry('67000000-0000-4000-8000-0000000000ff')$$,
  '42501', 'owner required', 'a barber cannot read a stored copy');
select throws_ok($$select public.admin_list_failed_booking_email_deliveries()$$, '42501',
  'owner required', 'a barber cannot list failed deliveries');
reset role;

-- Newest first, (created_at, id) keyset pages, no bodies in the list.
insert into public.email_send_log
  (id, dedupe_key, kind, recipient, subject, html, text_body, status, created_at)
values
  ('67000000-0000-4000-8000-0000000000a1', md5('old') || md5('old'), 'barber_confirmation',
   'barber@email-log.local', 'S-old', '<p>old</p>', 'old', 'sent', pg_catalog.now() - interval '2 hours'),
  ('67000000-0000-4000-8000-0000000000b1', md5('tie-low') || md5('tie-low'), 'customer_cancellation',
   'kund@email-log.local', 'S-tie-low', '<p>low</p>', 'low', 'sent', pg_catalog.now() - interval '1 hour'),
  ('67000000-0000-4000-8000-0000000000b2', md5('tie-high') || md5('tie-high'), 'customer_cancellation',
   'kund@email-log.local', 'S-tie-high', '<p>high</p>', 'high', 'sent', pg_catalog.now() - interval '1 hour');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000001')::text, true);
select is(pg_catalog.jsonb_array_length(public.admin_list_email_send_log()->'entries'), 4,
  'the owner lists every logged message');
select ok(not exists (select 1
  from pg_catalog.jsonb_array_elements(public.admin_list_email_send_log()->'entries') e
  where e ? 'html' or e ? 'text_body'), 'the list carries no bodies');
select is((select pg_catalog.array_agg(e->>'subject' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_email_send_log(p_limit => 2)->'entries')
    with ordinality as page(e, n)),
  array['S-now', 'S-tie-high'], 'the first page is newest first and breaks a time tie by id');
select is(public.admin_list_email_send_log(p_limit => 2)->'has_more', 'true'::jsonb,
  'a full page reports more rows');
select is((select pg_catalog.array_agg(e->>'subject' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_email_send_log(
    p_before => pg_catalog.now() - interval '1 hour', p_limit => 2,
    p_before_id => '67000000-0000-4000-8000-0000000000b2')->'entries')
    with ordinality as page(e, n)),
  array['S-tie-low', 'S-old'], 'the cursor continues inside a time tie without skipping a row');
select is(public.admin_list_email_send_log(p_before => pg_catalog.now() - interval '1 hour',
  p_limit => 2, p_before_id => '67000000-0000-4000-8000-0000000000b2')->'has_more', 'false'::jsonb,
  'the last page reports no more rows');
select is(pg_catalog.jsonb_array_length(public.admin_list_email_send_log(p_limit => 0)->'entries'), 1,
  'the page size is clamped to at least one row');
select is(public.admin_get_email_send_log_entry('67000000-0000-4000-8000-0000000000a1'),
  '{"id": "67000000-0000-4000-8000-0000000000a1", "subject": "S-old", "html": "<p>old</p>", "text_body": "old"}'::jsonb,
  'the owner reads one stored copy by id');
select ok(public.admin_get_email_send_log_entry('67000000-0000-4000-8000-0000000000ff') is null,
  'a purged or unknown copy reads as null');
reset role;

-- The failed list adds whom and when to every earlier key.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('67000000-0000-4000-8000-000000000011', 'mejllogg', 'h', 'Hår', 350, 45,
   '2096-01-02 09:00+00', '2096-01-02 09:45+00',
   'Leverans Kund', 'email', '0706700001', 'kund@email-log.local', 'sv'),
  ('67000000-0000-4000-8000-000000000012', 'mejllogg', 'h', 'Hår', 350, 45,
   '2096-01-02 10:00+00', '2096-01-02 10:45+00',
   'Raderad Kund', 'email', '0706700002', 'raderad@email-log.local', 'sv');
update public.booking_email_delivery_jobs
set status = 'failed', attempt_count = 1, failed_at = pg_catalog.now(),
    last_error_code = 'send_failed_permanent', sent_kinds = array['barber']
where booking_id = '67000000-0000-4000-8000-000000000011' and event = 'booking_confirmed';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000001')::text, true);
select set_config('test.failed_row', (select e::text
  from pg_catalog.jsonb_array_elements(public.admin_list_failed_booking_email_deliveries()) e
  where e->>'booking_id' = '67000000-0000-4000-8000-000000000011'), true);
reset role;
select ok(current_setting('test.failed_row')::jsonb
  ?& array['id', 'booking_id', 'event', 'attempt_count', 'last_error_code', 'failed_at'],
  'every earlier failed-list key is still returned');
select is((select e->>'customer_name' || '|' || (e->>'customer_email') || '|' || (e->>'customer_phone')
  from (select current_setting('test.failed_row')::jsonb as e) r),
  'Leverans Kund|kund@email-log.local|0706700001', 'the failed list names the customer and contact');
select is((current_setting('test.failed_row')::jsonb->>'booking_start_at')::timestamptz,
  '2096-01-02 09:00+00'::timestamptz, 'the failed list carries the booking time');
select is((select e->>'barber_name' || '|' || (e->>'barber_email')
  from (select current_setting('test.failed_row')::jsonb as e) r),
  'Mejl Logg|barber@email-log.local', 'the failed list names the barber and the barber address');
select is(current_setting('test.failed_row')::jsonb->'sent_kinds', '["barber"]'::jsonb,
  'the failed list shows which recipients were already reached');

-- 30-day retention is strict: keep the exact cutoff and the row one microsecond newer.
insert into public.email_send_log
  (dedupe_key, kind, recipient, subject, html, text_body, status, created_at)
values
  (md5('31') || md5('31'), 'auth_invite', 'barber@email-log.local', 'S-31', '<p></p>', '', 'sent',
   pg_catalog.now() - interval '31 days'),
  (md5('29') || md5('29'), 'auth_invite', 'barber@email-log.local', 'S-29', '<p></p>', '', 'sent',
   pg_catalog.now() - interval '29 days'),
  (md5('30-exact') || md5('30-exact'), 'auth_invite', 'barber@email-log.local', 'S-30-exact',
   '<p></p>', '', 'sent', pg_catalog.now() - interval '30 days'),
  (md5('30-older') || md5('30-older'), 'auth_invite', 'barber@email-log.local', 'S-30-older',
   '<p></p>', '', 'sent', pg_catalog.now() - interval '30 days' - interval '1 microsecond'),
  (md5('30-newer') || md5('30-newer'), 'auth_invite', 'barber@email-log.local', 'S-30-newer',
   '<p></p>', '', 'sent', pg_catalog.now() - interval '30 days' + interval '1 microsecond');
select is(public.internal_purge_email_send_log(), 2,
  'the purge deletes the 31-day row and the row one microsecond beyond 30 days');
select is((select pg_catalog.array_agg(subject order by subject) from public.email_send_log
  where subject in ('S-31', 'S-29', 'S-30-exact', 'S-30-older', 'S-30-newer')),
  array['S-29', 'S-30-exact', 'S-30-newer'],
  'the exact 30-day cutoff and all newer rows remain');

-- A hard-deleted booking keeps its log rows, unlinked.
insert into public.email_send_log
  (dedupe_key, kind, recipient, subject, html, text_body, status, booking_id)
values
  (md5('deleted') || md5('deleted'), 'customer_confirmation', 'raderad@email-log.local',
   'S-booking', '<p></p>', '', 'sent', '67000000-0000-4000-8000-000000000012');
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where booking_id = '67000000-0000-4000-8000-000000000012';
delete from public.bookings where id = '67000000-0000-4000-8000-000000000012';
select is((select pg_catalog.count(*)::int from public.email_send_log
  where subject = 'S-booking' and booking_id is null), 1,
  'deleting a booking keeps its log row and clears the link');

-- A booking deleted while its email was in flight: the attempt is still recorded, unlinked.
set local role service_role;
select lives_ok($$select public.internal_record_email_send(md5('in-flight') || md5('in-flight'),
  'customer_reminder', 'raderad@email-log.local', 'S-in-flight', '<p></p>', '', 'sent', null,
  '67000000-0000-4000-8000-000000000012')$$,
  'an email whose booking was deleted mid-send is still recorded');
select lives_ok($$select public.internal_record_email_send(md5('linked') || md5('linked'),
  'customer_reminder', 'kund@email-log.local', 'S-linked', '<p></p>', '', 'sent', null,
  '67000000-0000-4000-8000-000000000011')$$,
  'an email of a live booking is recorded');
reset role;
select is((select pg_catalog.array_agg(subject || ':' || coalesce(booking_id::text, 'none')
    order by subject)
  from public.email_send_log where subject in ('S-in-flight', 'S-linked')),
  array['S-in-flight:none', 'S-linked:67000000-0000-4000-8000-000000000011'],
  'a deleted booking is recorded as no booking and a live booking stays linked');

-- Delivery data and actions need the owner the Studio accepts: enabled and not awaiting a forced
-- password change. Each action has its own failed job, so a wrongly allowed retry cannot change
-- the job the discard checks; each caller is compared with the jobs as it found them, and the
-- enabled owner acts on two further failed jobs.
insert into auth.users (id, email) values
  ('67000000-0000-4000-8000-000000000003', 'forced-owner@email-log.local'),
  ('67000000-0000-4000-8000-000000000004', 'disabled-owner@email-log.local');
insert into public.profiles (id, role, barber_id, account_enabled, must_change_password) values
  ('67000000-0000-4000-8000-000000000003', 'owner', null, true, true),
  ('67000000-0000-4000-8000-000000000004', 'owner', null, false, false);
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('67000000-0000-4000-8000-000000000013', 'mejllogg', 'h', 'Hår', 350, 45,
   '2096-01-02 11:00+00', '2096-01-02 11:45+00',
   'Retry Kund', 'email', '0706700003', 'retry@email-log.local', 'sv'),
  ('67000000-0000-4000-8000-000000000014', 'mejllogg', 'h', 'Hår', 350, 45,
   '2096-01-02 12:00+00', '2096-01-02 12:45+00',
   'Discard Kund', 'email', '0706700004', 'discard@email-log.local', 'sv'),
  ('67000000-0000-4000-8000-000000000015', 'mejllogg', 'h', 'Hår', 350, 45,
   '2096-01-02 13:00+00', '2096-01-02 13:45+00',
   'Kontroll Kund', 'email', '0706700005', 'control-retry@email-log.local', 'sv'),
  ('67000000-0000-4000-8000-000000000016', 'mejllogg', 'h', 'Hår', 350, 45,
   '2096-01-02 14:00+00', '2096-01-02 14:45+00',
   'Kontroll Kund', 'email', '0706700006', 'control-discard@email-log.local', 'sv');
update public.booking_email_delivery_jobs
set status = 'failed', attempt_count = 5, failed_at = pg_catalog.now(),
    last_error_code = 'send_failed_permanent'
where booking_id in ('67000000-0000-4000-8000-000000000013', '67000000-0000-4000-8000-000000000014',
                     '67000000-0000-4000-8000-000000000015', '67000000-0000-4000-8000-000000000016')
  and event = 'booking_confirmed';
select set_config('test.retry_job', (select id::text from public.booking_email_delivery_jobs
  where booking_id = '67000000-0000-4000-8000-000000000013' and event = 'booking_confirmed'), true);
select set_config('test.discard_job', (select id::text from public.booking_email_delivery_jobs
  where booking_id = '67000000-0000-4000-8000-000000000014' and event = 'booking_confirmed'), true);
select set_config('test.control_retry_job', (select id::text from public.booking_email_delivery_jobs
  where booking_id = '67000000-0000-4000-8000-000000000015' and event = 'booking_confirmed'), true);
select set_config('test.control_discard_job', (select id::text from public.booking_email_delivery_jobs
  where booking_id = '67000000-0000-4000-8000-000000000016' and event = 'booking_confirmed'), true);
create function pg_temp.job_state(p_id uuid) returns text language sql as $$
  select status || ':' || attempt_count || ':' || coalesce(last_error_code, '')
    || ':' || (failed_at is not null)::text || ':' || (completed_at is null)::text
  from public.booking_email_delivery_jobs where id = p_id
$$;
create function pg_temp.action_jobs() returns text language sql as $$
  select pg_temp.job_state(current_setting('test.retry_job')::uuid) || ','
    || pg_temp.job_state(current_setting('test.discard_job')::uuid)
$$;
select set_config('test.jobs_before', pg_temp.action_jobs(), true);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.admin_list_email_send_log()$$, '42501', null,
  'an owner awaiting a forced password change cannot list the log');
select throws_ok($$select public.admin_get_email_send_log_entry('67000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'an owner awaiting a forced password change cannot read a stored copy');
select throws_ok($$select public.admin_list_failed_booking_email_deliveries()$$, '42501', null,
  'an owner awaiting a forced password change cannot list failed deliveries');
select throws_ok($$select public.admin_retry_failed_booking_email_delivery(
  current_setting('test.retry_job')::uuid)$$, '42501', null,
  'an owner awaiting a forced password change cannot retry a failed delivery');
select throws_ok($$select public.admin_discard_failed_booking_email_delivery(
  current_setting('test.discard_job')::uuid)$$, '42501', null,
  'an owner awaiting a forced password change cannot mark a failed delivery handled');
reset role;
select is(pg_temp.action_jobs(), current_setting('test.jobs_before'),
  'the forced-change owner left both failed jobs as they were');

select set_config('test.jobs_before', pg_temp.action_jobs(), true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_list_email_send_log()$$, '42501', null,
  'a disabled owner cannot list the log');
select throws_ok($$select public.admin_get_email_send_log_entry('67000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'a disabled owner cannot read a stored copy');
select throws_ok($$select public.admin_list_failed_booking_email_deliveries()$$, '42501', null,
  'a disabled owner cannot list failed deliveries');
select throws_ok($$select public.admin_retry_failed_booking_email_delivery(
  current_setting('test.retry_job')::uuid)$$, '42501', null,
  'a disabled owner cannot retry a failed delivery');
select throws_ok($$select public.admin_discard_failed_booking_email_delivery(
  current_setting('test.discard_job')::uuid)$$, '42501', null,
  'a disabled owner cannot mark a failed delivery handled');
reset role;
select is(pg_temp.action_jobs(), current_setting('test.jobs_before'),
  'the disabled owner left both jobs as they were');

select set_config('test.jobs_before', pg_temp.action_jobs(), true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.admin_retry_failed_booking_email_delivery(
  current_setting('test.retry_job')::uuid)$$, '42501', null,
  'a barber cannot retry a failed delivery');
select throws_ok($$select public.admin_discard_failed_booking_email_delivery(
  current_setting('test.discard_job')::uuid)$$, '42501', null,
  'a barber cannot mark a failed delivery handled');
reset role;
select is(pg_temp.action_jobs(), current_setting('test.jobs_before'),
  'the barber left both jobs as they were');

select set_config('test.jobs_before', pg_temp.action_jobs(), true);
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.admin_list_failed_booking_email_deliveries()$$, '42501', null,
  'anon cannot list failed deliveries');
select throws_ok($$select public.admin_retry_failed_booking_email_delivery(
  current_setting('test.retry_job')::uuid)$$, '42501', null,
  'anon cannot retry a failed delivery');
select throws_ok($$select public.admin_discard_failed_booking_email_delivery(
  current_setting('test.discard_job')::uuid)$$, '42501', null,
  'anon cannot mark a failed delivery handled');
reset role;
select is(pg_temp.action_jobs(), current_setting('test.jobs_before'),
  'anon left both jobs as they were');

-- Control: the enabled owner retries and marks handled failed jobs of the same kind.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000001')::text, true);
select is(public.admin_retry_failed_booking_email_delivery(
  current_setting('test.control_retry_job')::uuid)->>'ok', 'true',
  'the enabled owner retries a failed delivery');
select is(public.admin_discard_failed_booking_email_delivery(
  current_setting('test.control_discard_job')::uuid)->>'ok', 'true',
  'the enabled owner marks another failed delivery handled');
reset role;
select is(pg_catalog.split_part(pg_temp.job_state(current_setting('test.control_retry_job')::uuid),
    ':', 1) || ',' || pg_catalog.split_part(pg_temp.job_state(
    current_setting('test.control_discard_job')::uuid), ':', 1),
  'pending,skipped', 'the owner actions moved those jobs to pending and skipped');

-- A retry that succeeds under the same dedupe key rewrites the failed row's recipient, subject,
-- status and body together. The stored copy is that row as one snapshot, which agrees with the
-- row's list entry.
set local role service_role;
select lives_ok($$select public.internal_record_email_send(md5('copy') || md5('copy'),
  'barber_confirmation', 'former@email-log.local', 'OLD failed', '<p>Old recipient copy</p>',
  'Old recipient copy', 'failed', 'send_failed_transient', null)$$,
  'the first attempt to the former recipient failed');
select lives_ok($$select public.internal_record_email_send(md5('copy') || md5('copy'),
  'barber_confirmation', 'new@email-log.local', 'NEW accepted', '<p>New recipient copy</p>',
  'New recipient copy', 'sent', null, null)$$,
  'the retry to the corrected recipient was delivered');
reset role;
select set_config('test.copy_row', (select id::text from public.email_send_log
  where dedupe_key = md5('copy') || md5('copy')), true);
select set_config('test.copy_stored', (select (pg_catalog.to_jsonb(l) - 'dedupe_key')::text
  from public.email_send_log l where l.dedupe_key = md5('copy') || md5('copy')), true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000001')::text, true);
select is(public.admin_get_email_send_log_entry(current_setting('test.copy_row')::uuid),
  current_setting('test.copy_stored')::jsonb,
  'the stored copy carries the recipient, subject, status and body of one row');
select ok((select e from pg_catalog.jsonb_array_elements(public.admin_list_email_send_log()->'entries') e
    where e->>'id' = current_setting('test.copy_row'))
  <@ public.admin_get_email_send_log_entry(current_setting('test.copy_row')::uuid),
  'the stored copy agrees with every field of its list entry');
reset role;

-- The subject bound the senders must respect, in characters as char_length counts them.
set local role service_role;
select lives_ok($$select public.internal_record_email_send(md5('998') || md5('998'),
  'auth_invite', 'kund@email-log.local', repeat('s', 998), '<p></p>', '', 'sent', null, null)$$,
  'a 998-character subject is stored');
select lives_ok($$select public.internal_record_email_send(md5('998-astral') || md5('998-astral'),
  'auth_invite', 'kund@email-log.local', repeat(U&'\+01F4E8', 998), '<p></p>', '', 'sent', null,
  null)$$, 'a subject of 998 astral characters is stored');
select throws_ok($$select public.internal_record_email_send(md5('999') || md5('999'),
  'auth_invite', 'kund@email-log.local', repeat('s', 999), '<p></p>', '', 'sent', null, null)$$,
  '23514', null, 'a 999-character subject is rejected');
reset role;

-- Deep pages seek in the listing index. Pairs of rows share a microsecond, so ties straddle page
-- boundaries; the reads a page costs are counted from this transaction's table and index stats.
insert into public.email_send_log
  (id, dedupe_key, kind, recipient, subject, html, text_body, status, created_at)
select md5('page-id-' || i)::uuid, md5('page-' || i) || md5('page-' || i), 'auth_invite',
  'page@email-log.local', 'P-' || i, '<p></p>', '', 'sent',
  pg_catalog.now() - interval '1 day' - ((i + 1) / 2) * interval '1 microsecond'
from pg_catalog.generate_series(1, 10000) as s(i);
analyze public.email_send_log;
select set_config('request.jwt.claims',
  json_build_object('sub', '67000000-0000-4000-8000-000000000001')::text, true);

create function pg_temp.walk_log(out ids uuid[], out pages integer) language plpgsql as $$
declare
  v_page jsonb;
  v_before timestamptz;
  v_before_id uuid;
begin
  ids := '{}';
  pages := 0;
  loop
    v_page := public.admin_list_email_send_log(v_before, 50, v_before_id);
    pages := pages + 1;
    ids := ids || array(select (e->>'id')::uuid
      from pg_catalog.jsonb_array_elements(v_page->'entries') with ordinality as p(e, n) order by n);
    exit when not (v_page->>'has_more')::boolean;
    v_before := (v_page->'entries'->-1->>'created_at')::timestamptz;
    v_before_id := (v_page->'entries'->-1->>'id')::uuid;
  end loop;
end $$;
create function pg_temp.log_reads() returns bigint language sql as $$
  select coalesce((select t.seq_tup_read + coalesce(t.idx_tup_fetch, 0)
      from pg_catalog.pg_stat_xact_user_tables t where t.relid = 'public.email_send_log'::regclass), 0)
    + pg_catalog.pg_stat_get_xact_tuples_returned('public.email_send_log_listing_idx'::regclass)
$$;
create function pg_temp.page_reads(p_before timestamptz, p_before_id uuid) returns bigint
language plpgsql as $$
declare
  v_start bigint := pg_temp.log_reads();
begin
  perform public.admin_list_email_send_log(p_before, 50, p_before_id);
  return pg_temp.log_reads() - v_start;
end $$;
create function pg_temp.full_read() returns bigint language plpgsql as $$
declare
  v_start bigint := pg_temp.log_reads();
begin
  perform pg_catalog.count(*) from public.email_send_log;
  return pg_temp.log_reads() - v_start;
end $$;
-- The middle row whose successor shares its microsecond.
select set_config('test.deep_cursor', (select created_at::text || '|' || id::text from (
  select l.created_at, l.id, pg_catalog.row_number() over w as position,
         pg_catalog.lead(l.created_at) over w as next_at
  from public.email_send_log l window w as (order by l.created_at desc, l.id desc)) ranked
  where ranked.next_at = ranked.created_at and ranked.position >= 5000
  order by ranked.position limit 1), true);

create temporary table walked as select * from pg_temp.walk_log();
select is((select ids from walked),
  (select pg_catalog.array_agg(l.id order by l.created_at desc, l.id desc) from public.email_send_log l),
  'walking every page with the returned cursor lists each row once, newest first');
select is((select pages from walked),
  (select ((pg_catalog.count(*) + 49) / 50)::integer from public.email_send_log),
  'every page but the last is full and the last reports no more rows');
select is((select (e->>'created_at')::timestamptz || '|' || (e->>'id')
    from pg_catalog.jsonb_array_elements(public.admin_list_email_send_log(
      split_part(current_setting('test.deep_cursor'), '|', 1)::timestamptz, 1,
      split_part(current_setting('test.deep_cursor'), '|', 2)::uuid)->'entries') e),
  (select l.created_at::text || '|' || l.id::text from public.email_send_log l
   where l.created_at = split_part(current_setting('test.deep_cursor'), '|', 1)::timestamptz
     and l.id < split_part(current_setting('test.deep_cursor'), '|', 2)::uuid
   order by l.id desc limit 1),
  'a page after a cursor starts with the row sharing its microsecond');
select is(pg_catalog.jsonb_array_length(public.admin_list_email_send_log(p_limit => 500)->'entries'),
  100, 'the page size is capped at 100 rows');
select is(public.admin_list_email_send_log(p_limit => 500)->'has_more', 'true'::jsonb,
  'a capped page still reports more rows');
select cmp_ok(pg_temp.full_read(), '>=', 10000::bigint,
  'the read counter sees a full read of the log');
set local plan_cache_mode = force_generic_plan;
select cmp_ok(pg_temp.page_reads(split_part(current_setting('test.deep_cursor'), '|', 1)::timestamptz,
    split_part(current_setting('test.deep_cursor'), '|', 2)::uuid), '<', 1000::bigint,
  'a deep page reads about one page of rows under a generic plan');
set local plan_cache_mode = force_custom_plan;
select cmp_ok(pg_temp.page_reads(split_part(current_setting('test.deep_cursor'), '|', 1)::timestamptz,
    split_part(current_setting('test.deep_cursor'), '|', 2)::uuid), '<', 1000::bigint,
  'a deep page reads about one page of rows under a custom plan');
set local plan_cache_mode = auto;

select * from finish();
rollback;
