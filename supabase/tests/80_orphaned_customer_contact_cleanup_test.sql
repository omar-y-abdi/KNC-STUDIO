-- pgTAP: orphaned customer contact data (migration 20261110120300).
-- cleanup_customer_booking_access() deletes the access token, the profile membership and the empty
-- profile of an e-mail address only when nothing uses the address or any address linked to it:
-- no booking (any status, any date), no unexpired session, no unused unexpired challenge, no
-- unexpired device receipt, no stored e-mail link. Each boundary has a row just inside and a row
-- just outside. The baseline's four statements still do what they did. A profile whose addresses
-- are not all reached by one run is left whole for a later run.
begin;
select plan(52);

-- Privileges and schedule are what the baseline left.
select is((select pg_catalog.count(*)::int
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role)
  where pg_catalog.has_function_privilege(r.api_role::name,
          'public.cleanup_customer_booking_access()', 'execute')
     or pg_catalog.has_function_privilege(r.api_role::name,
          'public.customer_emails_in_use()', 'execute')), 0,
  'no API role can call the cleanup or its helper');
select ok((select p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid = 'public.cleanup_customer_booking_access()'::regprocedure),
  'the cleanup is security definer with an empty search path');
select ok((select not p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid = 'public.customer_emails_in_use()'::regprocedure),
  'the helper runs with its caller''s rights and an empty search path');
select is((select pg_catalog.array_agg(j.jobname || ' ' || j.schedule || ' ' || j.command)
  from cron.job j where j.command ilike '%cleanup_customer_booking_access%'),
  array['customer-booking-access-cleanup 23 3 * * * select public.cleanup_customer_booking_access()'],
  'the one nightly job that runs the cleanup is unchanged');

-- ---- fixtures ---------------------------------------------------------------------------------
create function pg_temp.hash(p_seed text) returns text language sql as $$
  select md5(p_seed) || md5(p_seed || ':2')
$$;
create function pg_temp.add_token(p_email text) returns void language sql as $$
  insert into public.customer_booking_access_tokens (email, phone, token_hash, token_ciphertext)
  values (p_email, '0708000000', pg_temp.hash('token:' || p_email), 'v1.' || repeat('A', 40))
$$;
create function pg_temp.add_profile(p_id uuid, variadic p_emails text[]) returns void
language sql as $$
  insert into public.customer_profiles (id) values (p_id);
  insert into public.customer_profile_emails (email, profile_id)
  select e, p_id from unnest(p_emails) as e;
$$;
-- 'TM' = token row and membership row present, '--' = both gone.
create function pg_temp.state(p_email text) returns text language sql as $$
  select case when exists (select 1 from public.customer_booking_access_tokens t
                           where t.email = p_email) then 'T' else '-' end
      || case when exists (select 1 from public.customer_profile_emails e
                           where e.email = p_email) then 'M' else '-' end
$$;
create function pg_temp.has_profile(p_id uuid) returns boolean language sql as $$
  select exists (select 1 from public.customer_profiles p where p.id = p_id)
$$;

insert into public.barbers (id, name) values ('orphanbar', 'Orphan Barber');

-- Addresses with a booking. The booking trigger creates each one's profile and membership.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang, status, cancelled_at)
values
  ('80000000-0000-4000-8000-0000000000b1', 'orphanbar', 'h', 'Hår', 350, 45,
   '2020-05-01 09:00+00', '2020-05-01 09:45+00', 'Past Kund', 'email', '0708000001',
   'past@orphan.local', 'sv', 'confirmed', null),
  ('80000000-0000-4000-8000-0000000000b2', 'orphanbar', 'h', 'Hår', 350, 45,
   '2020-05-02 09:00+00', '2020-05-02 09:45+00', 'Cancelled Kund', 'email', '0708000002',
   'cancelled@orphan.local', 'sv', 'cancelled', '2020-04-30 10:00+00'),
  ('80000000-0000-4000-8000-0000000000b3', 'orphanbar', 'h', 'Hår', 350, 45,
   '2098-05-03 09:00+00', '2098-05-03 09:45+00', 'Future Kund', 'email', '0708000003',
   'future@orphan.local', 'sv', 'confirmed', null),
  ('80000000-0000-4000-8000-0000000000b4', 'orphanbar', 'h', 'Hår', 350, 45,
   '2020-05-04 09:00+00', '2020-05-04 09:45+00', 'Spaced Kund', 'email', '0708000004',
   '  Spaced@Orphan.Local ', 'sv', 'confirmed', null),
  ('80000000-0000-4000-8000-0000000000b5', 'orphanbar', 'h', 'Hår', 350, 45,
   '2020-05-05 09:00+00', '2020-05-05 09:45+00', 'Group Kund', 'email', '0708000005',
   'grp-a@orphan.local', 'sv', 'confirmed', null);
select pg_temp.add_token(e) from unnest(array['past@orphan.local', 'cancelled@orphan.local',
  'future@orphan.local', 'spaced@orphan.local', 'grp-a@orphan.local']) as e;
-- A second address linked to the profile of an address that has a booking.
insert into public.customer_profile_emails (email, profile_id)
select 'grp-b@orphan.local', e.profile_id
from public.customer_profile_emails e where e.email = 'grp-a@orphan.local';
select pg_temp.add_token('grp-b@orphan.local');

-- Addresses without a booking.
select pg_temp.add_profile('80000000-0000-4000-8000-000000000101', 'orphan@orphan.local');
select pg_temp.add_token('orphan@orphan.local');
select pg_temp.add_token('orphan-noprofile@orphan.local');

select pg_temp.add_profile('80000000-0000-4000-8000-000000000102', 'session@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000103', 'session-expired@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000104', 'challenge@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000105', 'challenge-open@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000106', 'challenge-used@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000107', 'challenge-expired@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000108', 'receipt@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000109', 'receipt-expired@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000110', 'link-source@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000111', 'link-target@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000112', 'stale-source@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000113', 'stale-target@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000114', 'purged-source@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000115', 'purged-target@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000117',
  'g2-a@orphan.local', 'g2-b@orphan.local');
select pg_temp.add_profile('80000000-0000-4000-8000-000000000119',
  'g3-a@orphan.local', 'g3-b@orphan.local');
insert into public.customer_profiles (id) values ('80000000-0000-4000-8000-000000000118');
select pg_temp.add_token(e) from unnest(array[
  'session@orphan.local', 'session-expired@orphan.local', 'challenge@orphan.local',
  'challenge-open@orphan.local', 'challenge-used@orphan.local', 'challenge-expired@orphan.local',
  'receipt@orphan.local', 'receipt-expired@orphan.local', 'link-source@orphan.local',
  'link-target@orphan.local', 'stale-source@orphan.local', 'stale-target@orphan.local',
  'purged-source@orphan.local', 'purged-target@orphan.local', 'g2-a@orphan.local',
  'g2-b@orphan.local', 'g3-a@orphan.local', 'g3-b@orphan.local']) as e;

insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at) values
  ('0708000000', 'session@orphan.local', pg_temp.hash('s-live'),
   pg_catalog.now() + interval '1 microsecond'),
  ('0708000000', 'session-expired@orphan.local', pg_temp.hash('s-expired'), pg_catalog.now()),
  ('0708000000', 'g3-b@orphan.local', pg_temp.hash('s-group'), pg_catalog.now() + interval '1 hour'),
  ('0708000000', 'old-session@orphan.local', pg_temp.hash('s-old'),
   pg_catalog.now() - interval '1 day' - interval '1 microsecond');
insert into public.customer_booking_access_challenges
  (phone, email, token_hash, expires_at, used_at)
values
  ('0708000000', 'challenge@orphan.local', pg_temp.hash('c-live'),
   pg_catalog.now() + interval '1 microsecond', null),
  ('0708000000', 'challenge-open@orphan.local', pg_temp.hash('c-open'), 'infinity', null),
  ('0708000000', 'challenge-used@orphan.local', pg_temp.hash('c-used'),
   pg_catalog.now() + interval '10 minutes', pg_catalog.now() - interval '1 hour'),
  ('0708000000', 'challenge-expired@orphan.local', pg_temp.hash('c-expired'), pg_catalog.now(), null),
  ('0708000000', 'old-challenge@orphan.local', pg_temp.hash('c-old'),
   pg_catalog.now() - interval '1 day' - interval '1 microsecond', null);
insert into public.customer_booking_receipts (token_hash, expires_at) values
  (pg_temp.hash('r-live'), pg_catalog.now() + interval '1 microsecond'),
  (pg_temp.hash('r-expired'), pg_catalog.now());
insert into public.customer_booking_receipt_bookings (receipt_hash, booking_id, parent_email) values
  (pg_temp.hash('r-live'), '80000000-0000-4000-8000-0000000000b1', 'receipt@orphan.local'),
  (pg_temp.hash('r-expired'), '80000000-0000-4000-8000-0000000000b1', 'receipt-expired@orphan.local');
insert into public.customer_email_links
  (source_email, target_email, source_profile, target_profile, source_version, target_version,
   source_generation, target_generation, source_hash, target_hash, source_ciphertext,
   target_ciphertext, expires_at)
values
  ('link-source@orphan.local', 'link-target@orphan.local',
   '80000000-0000-4000-8000-000000000110', '80000000-0000-4000-8000-000000000111', 1, 1, 1, 1,
   pg_temp.hash('l1s'), pg_temp.hash('l1t'), 'v1.' || repeat('B', 40), 'v1.' || repeat('C', 40),
   pg_catalog.now() + interval '30 minutes'),
  ('stale-source@orphan.local', 'stale-target@orphan.local',
   '80000000-0000-4000-8000-000000000112', '80000000-0000-4000-8000-000000000113', 1, 1, 1, 1,
   pg_temp.hash('l2s'), pg_temp.hash('l2t'), 'v1.' || repeat('B', 40), 'v1.' || repeat('C', 40),
   pg_catalog.now() - interval '1 day'),
  ('purged-source@orphan.local', 'purged-target@orphan.local',
   '80000000-0000-4000-8000-000000000114', '80000000-0000-4000-8000-000000000115', 1, 1, 1, 1,
   pg_temp.hash('l3s'), pg_temp.hash('l3t'), 'v1.' || repeat('B', 40), 'v1.' || repeat('C', 40),
   pg_catalog.now() - interval '1 day' - interval '1 microsecond');

-- The helper names exactly the fixture addresses that something still uses.
select is((select pg_catalog.array_agg(u.email order by u.email collate "C")
  from public.customer_emails_in_use() as u(email) where u.email like '%@orphan.local'),
  array['cancelled@orphan.local', 'challenge-open@orphan.local', 'challenge@orphan.local',
        'future@orphan.local', 'g3-b@orphan.local', 'grp-a@orphan.local',
        'link-source@orphan.local', 'link-target@orphan.local', 'past@orphan.local',
        'purged-source@orphan.local', 'purged-target@orphan.local', 'receipt@orphan.local',
        'session@orphan.local', 'spaced@orphan.local', 'stale-source@orphan.local',
        'stale-target@orphan.local'],
  'before the run: bookings, live sessions, open challenges, unexpired receipts and stored links keep an address in use');

create function pg_temp.cleanup_rows() returns bigint language sql as $$
  select (select count(*) from public.customer_booking_access_challenges)
       + (select count(*) from public.customer_booking_access_sessions)
       + (select count(*) from public.customer_booking_receipts)
       + (select count(*) from public.customer_email_links)
       + (select count(*) from public.customer_booking_access_tokens)
       + (select count(*) from public.customer_profile_emails)
       + (select count(*) from public.customer_profiles)
$$;
select set_config('test.rows_before', pg_temp.cleanup_rows()::text, true);
select set_config('test.bookings_before', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b)
  order by b.id)::text from public.bookings b), true);
select set_config('test.deleted', public.cleanup_customer_booking_access()::text, true);

-- ---- the baseline's four statements still hold -------------------------------------------------
select is((select pg_catalog.array_agg(c.email order by c.email collate "C")
  from public.customer_booking_access_challenges c where c.email like '%@orphan.local'),
  array['challenge-expired@orphan.local', 'challenge-open@orphan.local',
        'challenge-used@orphan.local', 'challenge@orphan.local'],
  'only the challenge that expired more than a day ago is purged');
select is((select pg_catalog.array_agg(s.email order by s.email collate "C")
  from public.customer_booking_access_sessions s where s.email like '%@orphan.local'),
  array['g3-b@orphan.local', 'session-expired@orphan.local', 'session@orphan.local'],
  'only the session that expired more than a day ago is purged');
select is((select pg_catalog.count(*)::int from public.customer_booking_receipts r
  where r.token_hash in (pg_temp.hash('r-live'), pg_temp.hash('r-expired'))), 1,
  'the expired receipt is purged and the live one kept');
select is((select pg_catalog.array_agg(l.source_email order by l.source_email collate "C")
  from public.customer_email_links l where l.source_email like '%@orphan.local'),
  array['link-source@orphan.local', 'stale-source@orphan.local'],
  'only the link that expired more than a day ago is purged');

-- ---- addresses with a booking keep everything --------------------------------------------------
select is(pg_temp.state('past@orphan.local'), 'TM',
  'an address with a past confirmed booking keeps its token and membership');
select is(pg_temp.state('cancelled@orphan.local'), 'TM',
  'an address whose only booking is cancelled keeps its token and membership');
select is(pg_temp.state('future@orphan.local'), 'TM',
  'an address with a future booking keeps its token and membership');
select is(pg_temp.state('spaced@orphan.local'), 'TM',
  'a booking whose address differs only in case and surrounding spaces keeps the address');
select is(pg_temp.state('grp-a@orphan.local') || pg_temp.state('grp-b@orphan.local'), 'TMTM',
  'an address linked to an address with a booking keeps its token and membership too');

-- ---- addresses nothing uses lose all three -----------------------------------------------------
select is(pg_temp.state('orphan@orphan.local'), '--',
  'an address with no booking and no reference loses its token and membership');
select ok(not pg_temp.has_profile('80000000-0000-4000-8000-000000000101'),
  'its emptied profile is deleted');
select is(pg_temp.state('orphan-noprofile@orphan.local'), '--',
  'an unused token without a profile row is deleted');
select is(pg_temp.state('g2-a@orphan.local') || pg_temp.state('g2-b@orphan.local'), '----',
  'linked addresses that are all unused are deleted together');
select ok(not pg_temp.has_profile('80000000-0000-4000-8000-000000000117'),
  'the profile of the unused group is deleted');
select ok(not pg_temp.has_profile('80000000-0000-4000-8000-000000000118'),
  'a profile that already had no address is deleted');

-- ---- sessions ----------------------------------------------------------------------------------
select is(pg_temp.state('session@orphan.local'), 'TM',
  'a session that expires one microsecond from now keeps the address');
select is(pg_temp.state('session-expired@orphan.local'), '--',
  'a session that expires exactly now no longer keeps the address');
select is(pg_temp.state('g3-a@orphan.local') || pg_temp.state('g3-b@orphan.local'), 'TMTM',
  'a live session for one linked address keeps the whole group');
select ok(pg_temp.has_profile('80000000-0000-4000-8000-000000000102')
  and not pg_temp.has_profile('80000000-0000-4000-8000-000000000103')
  and pg_temp.has_profile('80000000-0000-4000-8000-000000000119'),
  'profiles follow their addresses: kept with a live session, deleted without');

-- ---- challenges --------------------------------------------------------------------------------
select is(pg_temp.state('challenge@orphan.local'), 'TM',
  'an unused challenge that expires one microsecond from now keeps the address');
select is(pg_temp.state('challenge-open@orphan.local'), 'TM',
  'an unused challenge that never expires (a pending access e-mail) keeps the address');
select is(pg_temp.state('challenge-used@orphan.local'), '--',
  'a used challenge does not keep the address');
select is(pg_temp.state('challenge-expired@orphan.local'), '--',
  'a challenge that expires exactly now does not keep the address');

-- ---- device receipts ---------------------------------------------------------------------------
select is(pg_temp.state('receipt@orphan.local'), 'TM',
  'an unexpired receipt that names the address as parent keeps it');
select is(pg_temp.state('receipt-expired@orphan.local'), '--',
  'an expired receipt does not keep the address');

-- ---- e-mail links ------------------------------------------------------------------------------
select is(pg_temp.state('link-source@orphan.local') || pg_temp.state('link-target@orphan.local'),
  'TMTM', 'a pending link keeps both of its addresses');
select is(pg_temp.state('stale-source@orphan.local') || pg_temp.state('stale-target@orphan.local'),
  'TMTM', 'an expired link that is still stored keeps both of its addresses');
select is(pg_temp.state('purged-source@orphan.local') || pg_temp.state('purged-target@orphan.local'),
  '----', 'once the link itself is purged its unused addresses are deleted');
select ok(pg_temp.has_profile('80000000-0000-4000-8000-000000000110')
  and pg_temp.has_profile('80000000-0000-4000-8000-000000000113')
  and not pg_temp.has_profile('80000000-0000-4000-8000-000000000114')
  and not pg_temp.has_profile('80000000-0000-4000-8000-000000000115'),
  'profiles named by a stored link stay; those of the purged link are deleted');

-- ---- nothing else is touched -------------------------------------------------------------------
select is((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.id)::text
  from public.bookings b), current_setting('test.bookings_before'),
  'the cleanup changes and deletes no booking');
select is(current_setting('test.deleted')::bigint,
  current_setting('test.rows_before')::bigint - pg_temp.cleanup_rows(),
  'the function returns the number of rows it deleted');
-- 4 by the baseline statements, then 10 tokens, 9 memberships and 9 profiles.
select cmp_ok(current_setting('test.deleted')::integer, '>=', 32,
  'the run deleted at least the 32 fixture rows it must delete');
select is((select pg_catalog.count(*)::int from public.customer_profiles p
  where not exists (select 1 from public.customer_profile_emails e where e.profile_id = p.id)), 0,
  'no profile without an address is left');
select is((select pg_catalog.count(*)::int from public.customer_email_links l
  where not exists (select 1 from public.customer_profile_emails e where e.email = l.source_email)
     or not exists (select 1 from public.customer_profile_emails e where e.email = l.target_email)), 0,
  'every stored link still finds both of its addresses');

-- ---- a customer with a booking still gets in ----------------------------------------------------
-- The gateway role cannot reach this session's temporary functions, so the hashes are read first.
select set_config('test.hash_past', pg_temp.hash('token:past@orphan.local'), true);
select set_config('test.hash_grp_b', pg_temp.hash('token:grp-b@orphan.local'), true);
select set_config('test.hash_orphan', pg_temp.hash('token:orphan@orphan.local'), true);
set local role service_role;
select is(pg_catalog.jsonb_path_query_array(public.list_customer_bookings_for_browser(
    current_setting('test.hash_past'), null), '$.bookings[*].id'),
  '["80000000-0000-4000-8000-0000000000b1"]'::jsonb,
  'the permanent link of an address with a booking still lists that booking');
select is(pg_catalog.jsonb_path_query_array(public.list_customer_bookings_for_browser(
    current_setting('test.hash_grp_b'), null), '$.bookings[*].id'),
  '["80000000-0000-4000-8000-0000000000b5"]'::jsonb,
  'the permanent link of a linked address still lists the booking of its group');
select is(public.list_customer_bookings_for_browser(
    current_setting('test.hash_orphan'), null)->>'error', 'access_denied',
  'the deleted token of an unused address opens nothing');
reset role;

-- ---- a second run finds nothing more; a new booking protects an address at once -----------------
select is(public.cleanup_customer_booking_access(), 0, 'a second run deletes nothing');
update public.customer_booking_access_sessions set expires_at = pg_catalog.now()
where email = 'session@orphan.local';
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('80000000-0000-4000-8000-0000000000b6', 'orphanbar', 'h', 'Hår', 350, 45,
   '2098-06-01 09:00+00', '2098-06-01 09:45+00', 'Ny Kund', 'email', '0708000006',
   'session@orphan.local', 'sv');
select is(public.cleanup_customer_booking_access(), 0,
  'an address whose session just ended but which has a new booking is not cleaned');
select is(pg_temp.state('session@orphan.local'), 'TM',
  'the new booking keeps the token and membership');
update public.booking_email_delivery_jobs set status = 'delivered', completed_at = pg_catalog.now()
where booking_id = '80000000-0000-4000-8000-0000000000b6';
delete from public.bookings where id = '80000000-0000-4000-8000-0000000000b6';
select is(public.cleanup_customer_booking_access(), 3,
  'once its last booking is deleted the address loses token, membership and profile');
select is(pg_temp.state('session@orphan.local'), '--',
  'after the last booking is deleted nothing of the address remains');

-- ---- a profile is handled whole or not at all ---------------------------------------------------
-- One run takes the per-address lock for at most 400 addresses, in address order. An unused profile
-- with the first and the last of 401 unused addresses therefore has one address inside the run and
-- one outside it. Nothing of that profile may go in that run; the 399 addresses between them have
-- a token and no profile and go at once. The next run has both addresses and removes all five rows.
select pg_temp.add_profile('80000000-0000-4000-8000-000000000201',
  'r4a@limit.local', 'r4z@limit.local');
select pg_temp.add_token(e) from unnest(array['r4a@limit.local', 'r4z@limit.local']) as e;
insert into public.customer_booking_access_tokens (email, phone, token_hash, token_ciphertext)
select f.email, '0708000000', pg_temp.hash('token:' || f.email), 'v1.' || repeat('A', 40)
from (
  select 'r4m' || pg_catalog.lpad(g::text, 3, '0') || '@limit.local' as email
  from pg_catalog.generate_series(0, 398) as g
) f;
select is(public.cleanup_customer_booking_access(), 399,
  'a run that reaches only one address of a profile deletes the 399 profile-less tokens and nothing else');
select is(pg_temp.state('r4a@limit.local') || pg_temp.state('r4z@limit.local'), 'TMTM',
  'the address inside the run keeps its token and membership, as the one outside it does');
select ok(pg_temp.has_profile('80000000-0000-4000-8000-000000000201'),
  'the profile is left for a later run');
select is(public.cleanup_customer_booking_access(), 5,
  'the next run reaches both addresses and deletes two tokens, two memberships and the profile');
select is(pg_temp.state('r4a@limit.local') || pg_temp.state('r4z@limit.local')
    || pg_temp.has_profile('80000000-0000-4000-8000-000000000201')::text, '----false',
  'nothing of the profile remains');

select * from finish();
rollback;
