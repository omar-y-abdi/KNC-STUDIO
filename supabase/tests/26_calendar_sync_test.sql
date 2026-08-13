-- pgTAP — calendar_sync (migration 20260724170000). Proves the least-privilege lockdown that the
-- earlier definer-grant regressions (0019 / 0020 / 0031) taught this codebase:
--   * the 8 service_role-only calendar RPCs are NOT executable by anon OR authenticated (a
--     `revoke ... from public` alone leaves Supabase's per-role default grant in place — this asserts
--     the explicit `revoke ... from anon, authenticated` actually stripped it), and ARE executable by
--     service_role (the edge-function credential);
--   * calendar_connection_status() is executable by authenticated (self-scoped) but not anon;
--   * barber_calendar_tokens + calendar_event_map have RLS enabled with NO policies, so the browser
--     (anon/authenticated) can never reach the refresh_token or the event map directly.
--
-- NOTE (mirrors the other suites' headers): this suite was NOT executed here — the local
-- Supabase/Docker stack is down in this environment. Assertions are written against the migration's
-- contract; the parent runs `supabase test db`. The anon/authenticated lockout is asserted against the
-- catalog (has_function_privilege / pg_class.relrowsecurity / pg_policies).

begin;
select plan(32);

-- ---- Tables: RLS on, no policies (service_role-only) ------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.barber_calendar_tokens'::regclass),
  'barber_calendar_tokens has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'barber_calendar_tokens'),
  0, 'barber_calendar_tokens has NO policies (anon/authenticated cannot read the refresh_token)'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.calendar_event_map'::regclass),
  'calendar_event_map has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'calendar_event_map'),
  0, 'calendar_event_map has NO policies (service_role only)'
);

-- ---- The 8 service_role RPCs: anon has NO execute --------------------------------------------
select ok(not has_function_privilege('anon', 'public.calendar_sync_source(uuid)', 'EXECUTE'),
  'anon cannot execute calendar_sync_source');
select ok(not has_function_privilege('anon', 'public.calendar_deletion_context(uuid)', 'EXECUTE'),
  'anon cannot execute calendar_deletion_context');
select ok(not has_function_privilege('anon', 'public.calendar_backfill_source(text)', 'EXECUTE'),
  'anon cannot execute calendar_backfill_source (would leak refresh_token + PII)');
select ok(not has_function_privilege('anon', 'public.calendar_record_event(uuid, text, text)', 'EXECUTE'),
  'anon cannot execute calendar_record_event');
select ok(not has_function_privilege('anon', 'public.calendar_forget_event(uuid)', 'EXECUTE'),
  'anon cannot execute calendar_forget_event');
select ok(not has_function_privilege('anon', 'public.calendar_record_error(text, text)', 'EXECUTE'),
  'anon cannot execute calendar_record_error');
select ok(not has_function_privilege('anon', 'public.calendar_store_token(text, text, text, text)', 'EXECUTE'),
  'anon cannot execute calendar_store_token (would allow calendar hijack)');
select ok(not has_function_privilege('anon', 'public.calendar_delete_token(text)', 'EXECUTE'),
  'anon cannot execute calendar_delete_token');

-- ---- The 8 service_role RPCs: authenticated has NO execute -----------------------------------
select ok(not has_function_privilege('authenticated', 'public.calendar_sync_source(uuid)', 'EXECUTE'),
  'authenticated cannot execute calendar_sync_source');
select ok(not has_function_privilege('authenticated', 'public.calendar_deletion_context(uuid)', 'EXECUTE'),
  'authenticated cannot execute calendar_deletion_context');
select ok(not has_function_privilege('authenticated', 'public.calendar_backfill_source(text)', 'EXECUTE'),
  'authenticated cannot execute calendar_backfill_source');
select ok(not has_function_privilege('authenticated', 'public.calendar_record_event(uuid, text, text)', 'EXECUTE'),
  'authenticated cannot execute calendar_record_event');
select ok(not has_function_privilege('authenticated', 'public.calendar_forget_event(uuid)', 'EXECUTE'),
  'authenticated cannot execute calendar_forget_event');
select ok(not has_function_privilege('authenticated', 'public.calendar_record_error(text, text)', 'EXECUTE'),
  'authenticated cannot execute calendar_record_error');
select ok(not has_function_privilege('authenticated', 'public.calendar_store_token(text, text, text, text)', 'EXECUTE'),
  'authenticated cannot execute calendar_store_token');
select ok(not has_function_privilege('authenticated', 'public.calendar_delete_token(text)', 'EXECUTE'),
  'authenticated cannot execute calendar_delete_token');

-- ---- The 8 service_role RPCs: service_role CAN execute (the grant works) ----------------------
select ok(has_function_privilege('service_role', 'public.calendar_sync_source(uuid)', 'EXECUTE'),
  'service_role can execute calendar_sync_source');
select ok(has_function_privilege('service_role', 'public.calendar_deletion_context(uuid)', 'EXECUTE'),
  'service_role can execute calendar_deletion_context');
select ok(has_function_privilege('service_role', 'public.calendar_backfill_source(text)', 'EXECUTE'),
  'service_role can execute calendar_backfill_source');
select ok(has_function_privilege('service_role', 'public.calendar_record_event(uuid, text, text)', 'EXECUTE'),
  'service_role can execute calendar_record_event');
select ok(has_function_privilege('service_role', 'public.calendar_forget_event(uuid)', 'EXECUTE'),
  'service_role can execute calendar_forget_event');
select ok(has_function_privilege('service_role', 'public.calendar_record_error(text, text)', 'EXECUTE'),
  'service_role can execute calendar_record_error');
select ok(has_function_privilege('service_role', 'public.calendar_store_token(text, text, text, text)', 'EXECUTE'),
  'service_role can execute calendar_store_token');
select ok(has_function_privilege('service_role', 'public.calendar_delete_token(text)', 'EXECUTE'),
  'service_role can execute calendar_delete_token');

-- ---- calendar_connection_status: authenticated yes, anon no ----------------------------------
select ok(has_function_privilege('authenticated', 'public.calendar_connection_status()', 'EXECUTE'),
  'authenticated can execute calendar_connection_status (self-scoped to their own row)');
select ok(not has_function_privilege('anon', 'public.calendar_connection_status()', 'EXECUTE'),
  'anon cannot execute calendar_connection_status');

insert into public.barbers (id, name)
values ('calendar-test', 'Calendar Test');

insert into public.barber_calendar_tokens (barber_id, refresh_token)
values ('calendar-test', 'test-refresh-token');

insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('26000000-0000-0000-0000-000000000001', 'calendar-test', 'past', 'Past', 100, 30,
   '2001-01-01 09:00+00', '2001-01-01 09:30+00',
   'Past Customer', 'email', null, 'past@example.com', 'sv'),
  ('26000000-0000-0000-0000-000000000002', 'calendar-test', 'future', 'Future', 100, 30,
   '2099-01-01 09:00+00', '2099-01-01 09:30+00',
   'Future Customer', 'email', null, 'future@example.com', 'sv');

select is(
  (select pg_catalog.count(*)::integer
   from pg_catalog.jsonb_array_elements(
     public.calendar_backfill_source('calendar-test')->'bookings'
   ) booking
   where booking->>'id' = '26000000-0000-0000-0000-000000000001'),
  0,
  'calendar backfill excludes completed bookings'
);

select is(
  (select pg_catalog.count(*)::integer
   from pg_catalog.jsonb_array_elements(
     public.calendar_backfill_source('calendar-test')->'bookings'
   ) booking
   where booking->>'id' = '26000000-0000-0000-0000-000000000002'),
  1,
  'calendar backfill includes future confirmed bookings'
);

select * from finish();
rollback;
