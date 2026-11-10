-- pgTAP: owner review moderation (migration 20261110120100).
--   * only an enabled owner who is not awaiting a forced password change may list, hide or delete
--   * the list carries published and hidden reviews with exactly six keys and no contact data
--   * a hidden review is gone from every public read (the table through RLS is the only one)
--   * a hidden review still blocks a second review of its booking; a deleted one frees the booking
--   * deleting a review leaves its booking untouched
--   * a page that holds exactly the remaining rows reports no more; a page never exceeds 100 rows
begin;
select plan(64);

-- Only the staff session role may call the three RPCs; the owner check is inside them.
select ok(not pg_catalog.has_function_privilege('anon',
  'public.admin_list_reviews(timestamptz,integer,uuid)', 'execute'), 'anon cannot list reviews');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.admin_set_review_published(uuid,boolean)', 'execute'), 'anon cannot hide a review');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.admin_delete_review(uuid)', 'execute'), 'anon cannot delete a review');
select ok(not pg_catalog.has_function_privilege('service_role',
  'public.admin_list_reviews(timestamptz,integer,uuid)', 'execute'),
  'the service role cannot list reviews for moderation');
select ok(not pg_catalog.has_function_privilege('service_role',
  'public.admin_set_review_published(uuid,boolean)', 'execute'),
  'the service role cannot hide a review');
select ok(not pg_catalog.has_function_privilege('service_role',
  'public.admin_delete_review(uuid)', 'execute'), 'the service role cannot delete a review');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.admin_list_reviews(timestamptz,integer,uuid)', 'execute'),
  'a staff session may call the list');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.admin_set_review_published(uuid,boolean)', 'execute'),
  'a staff session may call hide and publish');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.admin_delete_review(uuid)', 'execute'), 'a staff session may call delete');
select ok((select pg_catalog.bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
  from pg_catalog.pg_proc p
  where p.oid in ('public.admin_list_reviews(timestamptz,integer,uuid)'::regprocedure,
                  'public.admin_set_review_published(uuid,boolean)'::regprocedure,
                  'public.admin_delete_review(uuid)'::regprocedure)),
  'the three RPCs are security definer with an empty search path');

-- Fixtures. Reviews left by anything else would disturb the exact list assertions below.
delete from public.reviews;
insert into public.barbers (id, name) values ('recmod', 'Rec Mod');
insert into auth.users (id, email) values
  ('78000000-0000-4000-8000-000000000001', 'owner@review-mod.local'),
  ('78000000-0000-4000-8000-000000000002', 'barber@review-mod.local'),
  ('78000000-0000-4000-8000-000000000003', 'forced-owner@review-mod.local'),
  ('78000000-0000-4000-8000-000000000004', 'disabled-owner@review-mod.local');
insert into public.profiles (id, role, barber_id, account_enabled, must_change_password) values
  ('78000000-0000-4000-8000-000000000001', 'owner', null, true, false),
  ('78000000-0000-4000-8000-000000000002', 'barber', 'recmod', true, false),
  ('78000000-0000-4000-8000-000000000003', 'owner', null, true, true),
  ('78000000-0000-4000-8000-000000000004', 'owner', null, false, false);

-- Two finished bookings of one customer and one of another.
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('78000000-0000-4000-8000-0000000000b1', 'recmod', 'h', 'Hår', 350, 45,
   pg_catalog.now() - interval '3 days', pg_catalog.now() - interval '3 days' + interval '45 minutes',
   'Anna Andersson', 'email', '0707800001', 'anna@review-mod.local', 'sv'),
  ('78000000-0000-4000-8000-0000000000b2', 'recmod', 'h', 'Hår', 350, 45,
   pg_catalog.now() - interval '2 days', pg_catalog.now() - interval '2 days' + interval '45 minutes',
   'Bo Berg', 'email', '0707800002', 'bo@review-mod.local', 'sv');
insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at) values
  ('0707800001', 'anna@review-mod.local', repeat('a', 64), pg_catalog.now() + interval '20 minutes');
insert into public.reviews (id, name, rating, text, published, created_at, booking_id) values
  ('78000000-0000-4000-8000-0000000000a1', 'Anna A.', 5, 'T-anna', true,
   pg_catalog.now() - interval '3 hours', '78000000-0000-4000-8000-0000000000b1'),
  ('78000000-0000-4000-8000-0000000000c1', 'Bo B.', 4, 'T-tie-low', true,
   pg_catalog.now() - interval '2 hours', '78000000-0000-4000-8000-0000000000b2'),
  ('78000000-0000-4000-8000-0000000000c2', 'Cilla C.', 3, 'T-tie-high', true,
   pg_catalog.now() - interval '2 hours', null),
  ('78000000-0000-4000-8000-0000000000d1', 'Dan D.', 1, 'T-hidden', false,
   pg_catalog.now() - interval '1 hour', null);

-- Nobody but the owner the Studio accepts gets past the gate, and nothing changes when they try.
set local role anon;
select throws_ok($$select public.admin_list_reviews()$$, '42501', null, 'anon is refused the list');
select throws_ok($$select public.admin_set_review_published(
  '78000000-0000-4000-8000-0000000000a1', false)$$, '42501', null, 'anon is refused hiding');
select throws_ok($$select public.admin_delete_review('78000000-0000-4000-8000-0000000000a1')$$,
  '42501', null, 'anon is refused deleting');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select public.admin_list_reviews()$$, '42501', 'owner required',
  'a barber cannot list reviews for moderation');
select throws_ok($$select public.admin_set_review_published(
  '78000000-0000-4000-8000-0000000000a1', false)$$, '42501', 'owner required',
  'a barber cannot hide a review');
select throws_ok($$select public.admin_delete_review('78000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'owner required', 'a barber cannot delete a review');
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.admin_list_reviews()$$, '42501', 'owner required',
  'an owner awaiting a forced password change cannot list reviews');
select throws_ok($$select public.admin_set_review_published(
  '78000000-0000-4000-8000-0000000000a1', false)$$, '42501', 'owner required',
  'an owner awaiting a forced password change cannot hide a review');
select throws_ok($$select public.admin_delete_review('78000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'owner required', 'an owner awaiting a forced password change cannot delete a review');
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_list_reviews()$$, '42501', 'owner required',
  'a disabled owner cannot list reviews');
select throws_ok($$select public.admin_set_review_published(
  '78000000-0000-4000-8000-0000000000a1', false)$$, '42501', 'owner required',
  'a disabled owner cannot hide a review');
select throws_ok($$select public.admin_delete_review('78000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'owner required', 'a disabled owner cannot delete a review');
reset role;
select is((select pg_catalog.array_agg(r.text || ':' || r.published order by r.text) from public.reviews r),
  array['T-anna:true', 'T-hidden:false', 'T-tie-high:true', 'T-tie-low:true'],
  'the refused callers changed no review');

-- The owner lists everything, newest first, with (created_at, id) keyset pages.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000001')::text, true);
select is((select pg_catalog.array_agg(e->>'text' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_reviews()->'entries')
    with ordinality as page(e, n)),
  array['T-hidden', 'T-tie-high', 'T-tie-low', 'T-anna'],
  'the owner lists published and hidden reviews, newest first, a time tie broken by id');
select is(public.admin_list_reviews()->'has_more', 'false'::jsonb,
  'a list that fits one page reports no more rows');
select is((select pg_catalog.array_agg(distinct k order by k)
  from pg_catalog.jsonb_array_elements(public.admin_list_reviews()->'entries') e,
       pg_catalog.jsonb_object_keys(e) k),
  array['created_at', 'id', 'name', 'published', 'rating', 'text'],
  'a list entry has exactly the six moderation keys');
select is((select e from pg_catalog.jsonb_array_elements(public.admin_list_reviews()->'entries') e
    where e->>'id' = '78000000-0000-4000-8000-0000000000a1') - 'created_at',
  '{"id": "78000000-0000-4000-8000-0000000000a1", "name": "Anna A.", "rating": 5,
    "text": "T-anna", "published": true}'::jsonb,
  'an entry carries the stored display name, rating, text and flag');
select ok(public.admin_list_reviews()::text !~ '0707800001|0707800002|review-mod\.local|Andersson|Berg',
  'the list carries no phone number, e-mail address or full customer name');
select is((select pg_catalog.array_agg(e->>'text' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_reviews(p_limit => 2)->'entries')
    with ordinality as page(e, n)),
  array['T-hidden', 'T-tie-high'], 'the first page holds the newest rows');
select is(public.admin_list_reviews(p_limit => 2)->'has_more', 'true'::jsonb,
  'a full page reports more rows');
select is((select pg_catalog.array_agg(e->>'text' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_reviews(
    p_before => pg_catalog.now() - interval '2 hours', p_limit => 2,
    p_before_id => '78000000-0000-4000-8000-0000000000c2')->'entries')
    with ordinality as page(e, n)),
  array['T-tie-low', 'T-anna'], 'the cursor continues inside a time tie without skipping a row');
select is(public.admin_list_reviews(p_before => pg_catalog.now() - interval '2 hours', p_limit => 2,
  p_before_id => '78000000-0000-4000-8000-0000000000c2')->'has_more', 'false'::jsonb,
  'a cursor page that holds exactly the remaining rows reports no more rows');
select is(public.admin_list_reviews(p_limit => 4)->'has_more', 'false'::jsonb,
  'a first page that holds exactly every row reports no more rows');
select is(pg_catalog.jsonb_array_length(public.admin_list_reviews(p_limit => 0)->'entries'), 1,
  'the page size is clamped to at least one row');
select throws_ok($$select public.admin_list_reviews(p_before => pg_catalog.now())$$,
  '22023', null, 'a cursor time without its id is rejected');
select throws_ok($$select public.admin_list_reviews(
  p_before_id => '78000000-0000-4000-8000-0000000000c2')$$,
  '22023', null, 'a cursor id without its time is rejected');

-- Hiding: typed outcomes, and the flag is the only thing that changes.
select is(public.admin_set_review_published(null, false),
  '{"ok": false, "error": "invalid"}'::jsonb, 'a missing review id is invalid');
select is(public.admin_set_review_published('78000000-0000-4000-8000-0000000000a1', null),
  '{"ok": false, "error": "invalid"}'::jsonb, 'a missing flag is invalid');
select is(public.admin_set_review_published('78000000-0000-4000-8000-0000000000ff', false),
  '{"ok": false, "error": "not_found"}'::jsonb, 'an unknown review is not found');
select is(public.admin_set_review_published('78000000-0000-4000-8000-0000000000a1', false),
  '{"ok": true}'::jsonb, 'the owner hides a published review');
select is(public.admin_set_review_published('78000000-0000-4000-8000-0000000000a1', false),
  '{"ok": true}'::jsonb, 'hiding an already hidden review succeeds');
select is((select e->'published'
  from pg_catalog.jsonb_array_elements(public.admin_list_reviews()->'entries') e
  where e->>'id' = '78000000-0000-4000-8000-0000000000a1'), 'false'::jsonb,
  'the moderation list still shows the hidden review, flagged hidden');
reset role;
select is((select r.name || '|' || r.rating || '|' || r.text || '|' || r.booking_id
  from public.reviews r where r.id = '78000000-0000-4000-8000-0000000000a1'),
  'Anna A.|5|T-anna|78000000-0000-4000-8000-0000000000b1',
  'hiding changed nothing but the flag');

-- The table through RLS is the only public read path, and the hidden review is gone from it.
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select pg_catalog.array_agg(r.text order by r.text) from public.reviews r),
  array['T-tie-high', 'T-tie-low'], 'an anonymous visitor reads only published reviews');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000002')::text, true);
select is((select pg_catalog.array_agg(r.text order by r.text) from public.reviews r),
  array['T-tie-high', 'T-tie-low'], 'a signed-in non-owner reads only published reviews');
reset role;
select is((select pg_catalog.array_agg(p.polname::text || ':' || p.polcmd::text order by p.polname)
  from pg_catalog.pg_policy p where p.polrelid = 'public.reviews'::regclass),
  array['reviews_select_published:r'], 'the published-only policy is the only policy on reviews');
select is((select pg_catalog.array_agg(p.proname::text order by p.proname)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ilike '%public.reviews%'),
  array['admin_delete_review', 'admin_list_reviews', 'admin_set_review_published',
        'create_review_for_browser', 'create_review_with_access'],
  'no other database function reads or writes reviews');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_views v
  where v.schemaname = 'public' and v.definition ilike '%reviews%'), 0,
  'no view exposes reviews');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_publication_tables t
  where t.schemaname = 'public' and t.tablename = 'reviews'), 0,
  'reviews are not broadcast over realtime');

-- A hidden review still occupies its booking: the customer cannot review it a second time.
set local role service_role;
select is(public.create_review_with_access(repeat('a', 64), '0707800001', 4, 'En gång till')->>'error',
  'no_booking', 'the customer cannot write a second review for a booking whose review is hidden');
reset role;
select throws_ok($$insert into public.reviews (name, rating, text, booking_id)
  values ('Anna A.', 4, 'T-second', '78000000-0000-4000-8000-0000000000b1')$$,
  '23505', null, 'the one-review-per-booking constraint still holds for a hidden review');

-- Publishing again restores the public read.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000001')::text, true);
select is(public.admin_set_review_published('78000000-0000-4000-8000-0000000000a1', true),
  '{"ok": true}'::jsonb, 'the owner publishes the hidden review again');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select pg_catalog.array_agg(r.text order by r.text) from public.reviews r),
  array['T-anna', 'T-tie-high', 'T-tie-low'], 'a re-published review is public again');
reset role;

-- Deleting removes the review only: the booking is byte-for-byte what it was.
select set_config('test.booking_before', (select pg_catalog.to_jsonb(b)::text from public.bookings b
  where b.id = '78000000-0000-4000-8000-0000000000b1'), true);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000001')::text, true);
select is(public.admin_delete_review(null),
  '{"ok": false, "error": "invalid"}'::jsonb, 'deleting without an id is invalid');
select is(public.admin_delete_review('78000000-0000-4000-8000-0000000000ff'),
  '{"ok": false, "error": "not_found"}'::jsonb, 'deleting an unknown review is not found');
select is(public.admin_delete_review('78000000-0000-4000-8000-0000000000a1'),
  '{"ok": true}'::jsonb, 'the owner deletes a review');
select is(public.admin_delete_review('78000000-0000-4000-8000-0000000000a1'),
  '{"ok": false, "error": "not_found"}'::jsonb, 'deleting it a second time is not found');
select is(pg_catalog.jsonb_array_length(public.admin_list_reviews()->'entries'), 3,
  'the deleted review is gone from the moderation list');
reset role;
select is((select pg_catalog.count(*)::int from public.reviews
  where id = '78000000-0000-4000-8000-0000000000a1'), 0, 'the review row is deleted');
select is((select pg_catalog.to_jsonb(b)::text from public.bookings b
  where b.id = '78000000-0000-4000-8000-0000000000b1'),
  current_setting('test.booking_before'), 'the booking of a deleted review is unchanged');
select is((select pg_catalog.count(*)::int from public.reviews
  where id <> '78000000-0000-4000-8000-0000000000a1'), 3, 'no other review was deleted');

-- Unlike hiding, deleting frees the booking: the customer may review it again.
set local role service_role;
select is(public.create_review_with_access(repeat('a', 64), '0707800001', 4, 'Ny recension')->>'ok',
  'true', 'after the owner deleted the review the customer can review that booking again');
reset role;

-- The page size is capped at 100 rows. The rows are added last, so no list above sees them.
select set_config('request.jwt.claims', '', true);
insert into public.reviews (name, rating, text)
select 'Kund K.', 5, 'T-bulk-' || g::text
from pg_catalog.generate_series(1, 120) as g;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '78000000-0000-4000-8000-000000000001')::text, true);
select is(pg_catalog.jsonb_array_length(public.admin_list_reviews(p_limit => 500)->'entries'), 100,
  'a page size above 100 returns 100 rows');
select is(public.admin_list_reviews(p_limit => 500)->'has_more', 'true'::jsonb,
  'a capped page still reports more rows');
reset role;

select * from finish();
rollback;
