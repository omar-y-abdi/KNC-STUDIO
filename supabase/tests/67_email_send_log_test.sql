begin;
select plan(46);

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

select * from finish();
rollback;
