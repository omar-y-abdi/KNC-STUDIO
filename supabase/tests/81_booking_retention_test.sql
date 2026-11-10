-- pgTAP: booking retention (migration 20261110120400).
-- internal_purge_expired_bookings() deletes a booking when its appointment ended more than 12
-- months before the transaction time and none of its confirmation or cancellation e-mails is
-- pending or being sent. A failed e-mail of such a booking is dismissed first (its job becomes
-- 'skipped') and no longer holds the booking; a failed e-mail of a younger booking stays failed.
-- Cancelled and confirmed bookings are treated alike; a run deletes at most 500, oldest first, and
-- held bookings do not use up that batch. Each boundary has a row just inside and a row just
-- outside. What a purge leaves of the rows that hang off a booking is compared with what the
-- owner's own delete (admin_delete_bookings) leaves.
begin;
select plan(41);

-- ---- privileges and schedule ------------------------------------------------------------------
select is((select pg_catalog.count(*)::int
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role)
  where pg_catalog.has_function_privilege(r.api_role::name,
          'public.internal_purge_expired_bookings()', 'execute')), 0,
  'no API role can run the retention purge');
select ok((select p.proacl is not null
    and not exists (select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee = 0)
  from pg_catalog.pg_proc p
  where p.oid = 'public.internal_purge_expired_bookings()'::regprocedure),
  'PUBLIC has no execute on the retention purge');
select ok((select p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid = 'public.internal_purge_expired_bookings()'::regprocedure),
  'the purge is security definer with an empty search path');

set local role anon;
select throws_ok($$select public.internal_purge_expired_bookings()$$, '42501', null,
  'anon is refused the purge');
reset role;
set local role authenticated;
select throws_ok($$select public.internal_purge_expired_bookings()$$, '42501', null,
  'a signed-in session is refused the purge');
reset role;
set local role service_role;
select throws_ok($$select public.internal_purge_expired_bookings()$$, '42501', null,
  'the service role is refused the purge');
reset role;

select is((select pg_catalog.array_agg(j.schedule || ' ' || j.command) from cron.job j
  where j.jobname = 'booking-retention-purge'),
  array['11 3 * * * select public.internal_purge_expired_bookings()'],
  'one daily cron job runs the purge');
select is((select pg_catalog.array_agg(j.jobname::text) from cron.job j
  where j.command ilike '%internal_purge_expired_bookings%'),
  array['booking-retention-purge'],
  'no other cron job runs the purge');
select ok(not exists (select 1 from cron.job j
  where j.jobname <> 'booking-retention-purge' and j.schedule = '11 3 * * *'),
  'the purge runs at a minute no other job uses');
select ok((select pg_catalog.split_part(r.schedule, ' ', 2) = pg_catalog.split_part(c.schedule, ' ', 2)
    and pg_catalog.split_part(r.schedule, ' ', 1)::int < pg_catalog.split_part(c.schedule, ' ', 1)::int
  from cron.job r, cron.job c
  where r.jobname = 'booking-retention-purge'
    and c.jobname = 'customer-booking-access-cleanup'),
  'the purge runs before the contact-data cleanup of the same night');
select is((select j.username::text from cron.job j where j.jobname = 'booking-retention-purge'),
  (select pg_catalog.pg_get_userbyid(p.proowner)::text from pg_catalog.pg_proc p
   where p.oid = 'public.internal_purge_expired_bookings()'::regprocedure),
  'the job runs as the owner of the function, the only role that may execute it');

-- The predicate reads three columns. None can be NULL, so there is no NULL case to decide.
select is((select pg_catalog.array_agg(c.relname || '.' || a.attname order by c.relname, a.attname)
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  where a.attnotnull
    and (c.oid, a.attname::text) in (
      ('public.bookings'::regclass, 'end_at'),
      ('public.booking_email_delivery_jobs'::regclass, 'booking_id'),
      ('public.booking_email_delivery_jobs'::regclass, 'status'))),
  array['booking_email_delivery_jobs.booking_id', 'booking_email_delivery_jobs.status',
        'bookings.end_at'],
  'every column the purge decides on is NOT NULL');

-- ---- fixtures ---------------------------------------------------------------------------------
-- The purge works on the whole table: start from an empty one (everything here is rolled back).
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where status in ('pending', 'dispatching', 'failed');
delete from public.bookings;

create function pg_temp.bid(p_n integer) returns uuid language sql immutable as $$
  select ('81000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.hash(p_seed text) returns text language sql immutable as $$
  select md5(p_seed) || md5(p_seed || ':2')
$$;
-- A 30-minute booking that ends at p_end. A cancelled one was cancelled two years before its end,
-- so the time of cancellation is always far older than 12 months.
create function pg_temp.add_booking(
  p_n integer, p_barber text, p_end timestamptz, p_status text, p_method text, p_email text
) returns void language sql as $$
  insert into public.bookings
    (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
     customer_name, method, phone, email, lang, status, cancelled_at)
  values
    (pg_temp.bid(p_n), p_barber, 'h', 'Hår', 350, 30, p_end - interval '30 minutes', p_end,
     'Retention ' || p_n, p_method,
     case when p_method = 'walkin' then null else '07' || lpad(p_n::text, 8, '0') end,
     p_email, 'sv', p_status,
     case when p_status = 'cancelled' then p_end - interval '2 years' end)
$$;
-- The numbers of the bookings that exist, in order.
create function pg_temp.survivors() returns bigint[] language sql stable as $$
  select coalesce(array_agg(s.n order by s.n), '{}')
  from (select right(b.id::text, 12)::bigint as n from public.bookings b) s
$$;
-- What is left of booking p_n and of the rows that hang off it.
create function pg_temp.effects(p_n integer) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'booking', (select count(*) from public.bookings b where b.id = pg_temp.bid(p_n)),
    'delivery_jobs', (select count(*) from public.booking_email_delivery_jobs j
                      where j.booking_id = pg_temp.bid(p_n)),
    'reminders', (select count(*) from public.booking_reminders r
                  where r.booking_id = pg_temp.bid(p_n)),
    'receipt_grants', (select count(*) from public.customer_booking_receipt_bookings g
                       where g.booking_id = pg_temp.bid(p_n)),
    'receipts', (select count(*) from public.customer_booking_receipts r
                 where r.token_hash = pg_temp.hash('receipt:' || p_n)),
    'reviews', (select jsonb_agg(to_jsonb(r.booking_id)) from public.reviews r
                where r.text = 'Retention review ' || p_n),
    'log_rows', (select jsonb_agg(to_jsonb(l.booking_id)) from public.email_send_log l
                 where l.dedupe_key = pg_temp.hash('log:' || p_n)),
    'calendar_map', (select count(*) from public.calendar_event_map m
                     where m.booking_id = pg_temp.bid(p_n)),
    'calendar_delete_jobs', (
      select jsonb_agg(jsonb_build_object('status', j.status,
                                          'event', j.payload ->> 'google_event_id'))
      from public.external_action_jobs j
      where j.action_type = 'calendar_event_delete'
        and j.dedupe_key = pg_temp.bid(p_n)::text)
  )
$$;

insert into public.barbers (id, name) values
  ('retain-a', 'Retain A'), ('retain-b', 'Retain B'), ('retain-c', 'Retain C');
insert into auth.users (id, email) values
  ('81000000-0000-4000-8000-0000000000f1', 'owner@retain.local');
insert into public.profiles (id, role, barber_id) values
  ('81000000-0000-4000-8000-0000000000f1', 'owner', null);

select pg_temp.add_booking(v.n, v.barber, v.end_at, v.status, v.method, v.email)
from (values
  -- The 12-month boundary, on three barbers so the confirmed rows cannot overlap.
  ( 1, 'retain-a', pg_catalog.now() - interval '12 months', 'confirmed', 'phone', null::text),
  ( 2, 'retain-b', pg_catalog.now() - interval '12 months' - interval '1 microsecond',
       'confirmed', 'phone', null),
  ( 3, 'retain-c', pg_catalog.now() - interval '12 months' + interval '1 microsecond',
       'confirmed', 'phone', null),
  -- Older and younger than 12 months, confirmed and cancelled.
  ( 4, 'retain-a', pg_catalog.now() - interval '13 months', 'confirmed', 'phone', null),
  ( 5, 'retain-a', pg_catalog.now() - interval '13 months', 'cancelled', 'phone', null),
  ( 6, 'retain-a', pg_catalog.now() - interval '11 months', 'confirmed', 'phone', null),
  ( 7, 'retain-a', pg_catalog.now() - interval '11 months', 'cancelled', 'phone', null),
  -- Not ended, and ended a moment ago.
  ( 8, 'retain-a', pg_catalog.now() + interval '30 days', 'confirmed', 'phone', null),
  ( 9, 'retain-a', pg_catalog.now() + interval '30 days', 'cancelled', 'phone', null),
  (10, 'retain-a', pg_catalog.now() - interval '1 microsecond', 'confirmed', 'phone', null),
  -- Old, with a delivery job in each state (set below).
  (11, 'retain-b', pg_catalog.now() - interval '14 months', 'confirmed', 'phone', null),
  (12, 'retain-b', pg_catalog.now() - interval '15 months', 'confirmed', 'phone', null),
  (13, 'retain-b', pg_catalog.now() - interval '16 months', 'confirmed', 'phone', null),
  (14, 'retain-b', pg_catalog.now() - interval '17 months', 'confirmed', 'phone', null),
  (15, 'retain-b', pg_catalog.now() - interval '18 months', 'confirmed', 'phone', null),
  (16, 'retain-b', pg_catalog.now() - interval '19 months', 'confirmed', 'phone', null),
  (17, 'retain-c', pg_catalog.now() - interval '20 months', 'cancelled', 'phone', null),
  -- Old, with every kind of row that hangs off a booking (added below).
  (18, 'retain-c', pg_catalog.now() - interval '21 months', 'confirmed', 'phone', null),
  -- Old walk-in: no phone, no e-mail.
  (19, 'retain-c', pg_catalog.now() - interval '22 months', 'confirmed', 'walkin', null),
  -- Ended 10 months ago; the row itself is made three years old below.
  (20, 'retain-c', pg_catalog.now() - interval '10 months', 'confirmed', 'phone', null),
  -- Old, and the only booking of its e-mail address.
  (21, 'retain-c', pg_catalog.now() - interval '23 months', 'confirmed', 'email',
       'old-only@retain.local'),
  -- The twin of 18. Its e-mail stays pending, so the purge leaves it for the owner to delete.
  (22, 'retain-c', pg_catalog.now() - interval '24 months', 'confirmed', 'phone', null),
  -- Ends tomorrow; its start is moved two years back below.
  (23, 'retain-a', pg_catalog.now() + interval '1 day', 'cancelled', 'phone', null),
  -- 13 months old: one whose e-mail failed, one whose e-mail is pending.
  (24, 'retain-b', pg_catalog.now() - interval '13 months', 'confirmed', 'phone', null),
  (25, 'retain-c', pg_catalog.now() - interval '13 months', 'confirmed', 'phone', null),
  -- 11 months old, e-mail failed.
  (26, 'retain-b', pg_catalog.now() - interval '11 months', 'confirmed', 'phone', null),
  -- Old and cancelled: its confirmation failed, its cancellation e-mail is pending (set below).
  (27, 'retain-c', pg_catalog.now() - interval '25 months', 'cancelled', 'phone', null)
) as v(n, barber, end_at, status, method, email);

update public.bookings set created_at = pg_catalog.now() - interval '3 years'
where id = pg_temp.bid(20);
update public.bookings set start_at = pg_catalog.now() - interval '2 years'
where id = pg_temp.bid(23);

-- Every booking got a pending confirmation job from its insert trigger. Mark them delivered, then
-- give 11 to 16 and 24 to 27 one state each and leave 22 pending. A failed job carries what the
-- delivery worker leaves on it: the time it failed and an error code.
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where booking_id <> pg_temp.bid(22);
update public.booking_email_delivery_jobs j
set status = s.status,
    completed_at = case when s.status in ('skipped', 'superseded') then pg_catalog.now() end,
    failed_at = case when s.status = 'failed' then pg_catalog.now() - interval '1 hour' end,
    last_error_code = case when s.status = 'failed' then 'send_failed_permanent' end
from (values (11, 'pending'), (12, 'dispatching'), (13, 'failed'),
             (15, 'skipped'), (16, 'superseded'),
             (24, 'failed'), (25, 'pending'), (26, 'failed'), (27, 'failed')) as s(n, status)
where j.booking_id = pg_temp.bid(s.n);
-- As after the 90-day job cleanup: no job row at all.
delete from public.booking_email_delivery_jobs
where booking_id in (pg_temp.bid(2), pg_temp.bid(4), pg_temp.bid(5));
-- 17 and 27 are cancelled and their cancellation e-mail has not gone out. The confirmation of 17
-- was delivered; that of 27 failed.
insert into public.booking_email_delivery_jobs (booking_id, event, status)
values (pg_temp.bid(17), 'booking_cancelled', 'pending'),
       (pg_temp.bid(27), 'booking_cancelled', 'pending');

-- 18 and 22: a review, an e-mail log row, a reminder, a device-receipt grant and a calendar event.
insert into public.reviews (name, rating, text, published, booking_id)
select 'Retention', 5, 'Retention review ' || n, true, pg_temp.bid(n)
from unnest(array[18, 22]) as n;
insert into public.email_send_log
  (dedupe_key, kind, recipient, subject, html, text_body, status, booking_id)
select pg_temp.hash('log:' || n), 'customer_confirmation', 'retain' || n || '@retain.local',
       'Bokning', '<p>Bokning</p>', 'Bokning', 'sent', pg_temp.bid(n)
from unnest(array[18, 22]) as n;
insert into public.booking_reminders (booking_id, due_at)
select pg_temp.bid(n), pg_catalog.now() - interval '2 years' from unnest(array[18, 22]) as n;
insert into public.customer_booking_receipts (token_hash)
select pg_temp.hash('receipt:' || n) from unnest(array[18, 22]) as n;
insert into public.customer_booking_receipt_bookings (receipt_hash, booking_id)
select pg_temp.hash('receipt:' || n), pg_temp.bid(n) from unnest(array[18, 22]) as n;
insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
select pg_temp.bid(n), 'retain-c', 'retain-calendar', 'retain-event'
from unnest(array[18, 22]) as n;

select is((select pg_catalog.array_agg(distinct right(j.booking_id::text, 12)::bigint
             order by right(j.booking_id::text, 12)::bigint)
  from public.booking_email_delivery_jobs j
  where j.status in ('pending', 'dispatching', 'failed')),
  array[11, 12, 13, 17, 22, 24, 25, 26, 27]::bigint[],
  'before: exactly nine bookings have a pending, dispatching or failed e-mail');
select is(pg_temp.effects(18), jsonb_build_object(
    'booking', 1, 'delivery_jobs', 1, 'reminders', 1, 'receipt_grants', 1, 'receipts', 1,
    'reviews', jsonb_build_array(pg_temp.bid(18)), 'log_rows', jsonb_build_array(pg_temp.bid(18)),
    'calendar_map', 1, 'calendar_delete_jobs', null),
  'before: booking 18 has one of each dependent row and no calendar deletion queued');
select is(pg_temp.effects(22), jsonb_build_object(
    'booking', 1, 'delivery_jobs', 1, 'reminders', 1, 'receipt_grants', 1, 'receipts', 1,
    'reviews', jsonb_build_array(pg_temp.bid(22)), 'log_rows', jsonb_build_array(pg_temp.bid(22)),
    'calendar_map', 1, 'calendar_delete_jobs', null),
  'before: its twin 22 has the same');
select ok(exists (select 1 from public.customer_profile_emails e
  where e.email = 'old-only@retain.local'),
  'before: the address of booking 21 has a profile membership');
select set_config('test.old_profile', coalesce((select e.profile_id::text
  from public.customer_profile_emails e where e.email = 'old-only@retain.local'), ''), true);
select set_config('test.audit_before',
  (select pg_catalog.count(*)::text from public.admin_audit_log), true);

-- ---- the purge --------------------------------------------------------------------------------
-- No JWT has been set in this session, as in the cron worker.
select is(public.internal_purge_expired_bookings(), 11,
  'the purge deletes the eleven bookings that ended more than 12 months ago and whose e-mails are '
  || 'neither pending nor being sent');
select is(pg_temp.survivors(),
  array[1, 3, 6, 7, 8, 9, 10, 11, 12, 17, 20, 22, 23, 25, 26, 27]::bigint[],
  'kept: the exact 12-month cutoff and one microsecond inside it, 11 months confirmed and cancelled, '
  || 'bookings that have not ended, an old row that ended 10 months ago, '
  || 'and every old booking with a pending or dispatching e-mail');
select ok(not exists (select 1 from public.bookings b
    where b.id in (pg_temp.bid(13), pg_temp.bid(24))),
  'a 13-month-old and a 16-month-old booking whose e-mail failed are purged in the same run');
select is((select pg_catalog.array_agg(
      right(j.booking_id::text, 12)::bigint || ':' || j.event || ':' || j.status
      order by right(j.booking_id::text, 12)::bigint, j.event)
  from public.booking_email_delivery_jobs j
  where j.status in ('pending', 'dispatching', 'failed')),
  array['11:booking_confirmed:pending', '12:booking_confirmed:dispatching',
        '17:booking_cancelled:pending', '22:booking_confirmed:pending',
        '25:booking_confirmed:pending', '26:booking_confirmed:failed',
        '27:booking_cancelled:pending'],
  'pending and dispatching e-mails are untouched, the 13-month-old booking with a pending e-mail '
  || 'stays, and the failed e-mail of the 11-month-old booking is still failed');
select is((select j.status || '|' || (j.completed_at = pg_catalog.now())::text
      || '|' || coalesce(j.last_error_code, '-') || '|' || (j.failed_at is not null)::text
  from public.booking_email_delivery_jobs j
  where j.booking_id = pg_temp.bid(27) and j.event = 'booking_confirmed'),
  'skipped|true|send_failed_permanent|true',
  'the failed e-mail of an old booking is dismissed as the owner would: skipped, completed now, '
  || 'its error left in place');
select is(pg_temp.effects(18), jsonb_build_object(
    'booking', 0, 'delivery_jobs', 0, 'reminders', 0, 'receipt_grants', 0, 'receipts', 1,
    'reviews', jsonb_build_array(null), 'log_rows', jsonb_build_array(null),
    'calendar_map', 1,
    'calendar_delete_jobs', jsonb_build_array(
      jsonb_build_object('status', 'pending', 'event', 'retain-event'))),
  'the purge cascades jobs, reminder and receipt grant, unlinks the review and the e-mail log row, '
  || 'and queues the calendar event for removal');
select is((select pg_catalog.count(*)::text from public.admin_audit_log),
  current_setting('test.audit_before'),
  'the purge writes nothing to the staff audit log');
select ok(not exists (select 1 from public.customer_emails_in_use() as u(email)
  where u.email = 'old-only@retain.local'),
  'the address whose only booking was purged is no longer in use');
select public.cleanup_customer_booking_access();
select ok(not exists (select 1 from public.customer_profile_emails e
    where e.email = 'old-only@retain.local')
  and not exists (select 1 from public.customer_profiles p
    where p.id::text = current_setting('test.old_profile')),
  'the contact-data cleanup that follows removes that address and its profile');
select is(public.internal_purge_expired_bookings(), 0,
  'a second run right away deletes nothing');

-- ---- the same effects as the owner's delete ---------------------------------------------------
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where booking_id = pg_temp.bid(22);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '81000000-0000-4000-8000-0000000000f1')::text, true);
select set_config('test.owner_delete', public.admin_delete_bookings(
  array['81000000-0000-4000-8000-000000000022'::uuid])::text, true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(current_setting('test.owner_delete')::jsonb, '{"ok": true, "count": 1}'::jsonb,
  'the owner deletes the twin booking with admin_delete_bookings');
select is(pg_temp.effects(18), pg_temp.effects(22),
  'the purge leaves exactly what the owner''s delete leaves');
select is((select pg_catalog.count(*)::int from public.admin_audit_log l
  where l.actor_id = '81000000-0000-4000-8000-0000000000f1'
    and l.action = 'delete' and l.target_table = 'bookings'
    and l.target_id = '81000000-0000-4000-8000-000000000022'), 1,
  'the audit trigger is live: it recorded the owner''s delete, and nothing for the purge');

-- ---- held bookings go once their e-mail is no longer pending or being sent ----------------------
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where status in ('pending', 'dispatching');
select is(public.internal_purge_expired_bookings(), 5,
  'with their e-mails delivered the five held bookings are deleted');
select is(pg_temp.survivors(), array[1, 3, 6, 7, 8, 9, 10, 20, 23, 26]::bigint[],
  'only bookings that ended within 12 months or have not ended remain');

-- ---- bounded batches, oldest first; held bookings do not use up the batch ----------------------
-- 500 bookings older than every other one, each held by the pending e-mail its insert queued. A
-- purge that took its 500 oldest candidates first and looked at their e-mails afterwards would
-- find only these and delete nothing.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, cancelled_at)
select ('81000000-0000-4000-8000-2' || lpad(g::text, 11, '0'))::uuid, 'retain-a', 'h', 'Hår', 350, 30,
       pg_catalog.now() - interval '30 months' - g * interval '1 minute' - interval '30 minutes',
       pg_catalog.now() - interval '30 months' - g * interval '1 minute',
       'Held ' || g, 'phone', '07' || lpad(g::text, 8, '0'), null, 'sv', 'cancelled',
       pg_catalog.now()
from generate_series(1, 500) as g;
-- 503 younger ones that nothing holds.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, cancelled_at)
select ('81000000-0000-4000-8000-1' || lpad(g::text, 11, '0'))::uuid, 'retain-a', 'h', 'Hår', 350, 30,
       pg_catalog.now() - interval '13 months' - g * interval '1 minute' - interval '30 minutes',
       pg_catalog.now() - interval '13 months' - g * interval '1 minute',
       'Bulk ' || g, 'phone', '07' || lpad(g::text, 8, '0'), null, 'sv', 'cancelled',
       pg_catalog.now()
from generate_series(1, 503) as g;
delete from public.booking_email_delivery_jobs j
using public.bookings b
where b.id = j.booking_id and b.customer_name like 'Bulk %';

select is(public.internal_purge_expired_bookings(), 500,
  'one run deletes at most 500 bookings, and the 500 older held bookings do not use up the batch');
select is((select pg_catalog.array_agg(b.customer_name order by b.end_at desc)
  from public.bookings b where b.customer_name like 'Bulk %'),
  array['Bulk 1', 'Bulk 2', 'Bulk 3'],
  'the oldest go first: the three that ended last are left for the next run');
select is(public.internal_purge_expired_bookings(), 3, 'the next run deletes the rest');
select is(public.internal_purge_expired_bookings(), 0, 'and the run after that deletes nothing');
select is((select pg_catalog.count(*)::int
  from public.bookings b
  join public.booking_email_delivery_jobs j on j.booking_id = b.id
  where b.customer_name like 'Held %' and j.status = 'pending'), 500,
  'the 500 held bookings and their pending e-mails are untouched by all three runs');
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where status = 'pending';
select is(public.internal_purge_expired_bookings(), 500,
  'once their e-mails are delivered the held bookings are deleted');
select is(pg_temp.survivors(), array[1, 3, 6, 7, 8, 9, 10, 20, 23, 26]::bigint[],
  'no run touched a booking that ended within 12 months or has not ended');
select is((select j.status from public.booking_email_delivery_jobs j
  where j.booking_id = pg_temp.bid(26)), 'failed',
  'through every run the failed e-mail of the 11-month-old booking stayed failed');

-- ---- the scheduling block is idempotent --------------------------------------------------------
select set_config('test.cron_before', (select j.schedule || ' ' || j.command from cron.job j
  where j.jobname = 'booking-retention-purge'), true);
do $$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'booking-retention-purge') then
      perform cron.unschedule('booking-retention-purge');
    end if;
    perform cron.schedule('booking-retention-purge', '11 3 * * *',
      'select public.internal_purge_expired_bookings()');
  end loop;
end;
$$;
select is((select pg_catalog.count(*)::int from cron.job where jobname = 'booking-retention-purge'), 1,
  'the purge job exists exactly once after re-running its scheduling block twice');
select is((select j.schedule || ' ' || j.command from cron.job j
  where j.jobname = 'booking-retention-purge'), current_setting('test.cron_before'),
  'the re-run block schedules exactly what the migration scheduled');

select * from finish();
rollback;
