-- pgTAP: admin audit log (migration 20261110120200).
--   * the table is closed to every API role; the trigger function and the service-role RPC are its
--     only writers, and the owner RPC its only reader
--   * a change is recorded only when the request carries the JWT of a staff profile; writes with no
--     JWT, a service-role JWT, malformed claims or a subject that is not staff record nothing and
--     are never refused
--   * a row holds who, what, which table, which primary key and column NAMES; no value of a changed
--     row can be stored, by the table's columns and constraints and by what the writers accept
--   * a publish from CMS Studio (service role, no staff JWT) is recorded once, from the revision row
--     that names the publishing owner; revision rows that are not a staff publish record nothing
--   * owner-only keyset reads; 12-month retention with exact boundaries; one daily purge job
begin;
select plan(109);

-- ---- structure and privileges ----------------------------------------------------------------
select has_table('public', 'admin_audit_log', 'the audit log table exists');
select ok((select relrowsecurity from pg_catalog.pg_class
  where oid = 'public.admin_audit_log'::regclass), 'the audit log has RLS enabled');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_policy
  where polrelid = 'public.admin_audit_log'::regclass), 0, 'the audit log has no policy');
select is((select pg_catalog.array_agg(
    a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.admin_audit_log'::regclass and a.attnum > 0 and not a.attisdropped),
  array['id:uuid', 'created_at:timestamp with time zone', 'actor_id:uuid', 'action:text',
        'target_table:text', 'target_id:text', 'changed_columns:text[]'],
  'the log has exactly these columns, none of which can hold a value of a changed row');
select is((select pg_catalog.count(*)::int
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role),
       pg_catalog.unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references',
                               'trigger', 'maintain']) as p(privilege)
  where pg_catalog.has_table_privilege(r.api_role::name, 'public.admin_audit_log', p.privilege)), 0,
  'no API role holds any privilege on the log table');
select is((select pg_catalog.count(*)::int
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role)
  where pg_catalog.has_function_privilege(r.api_role::name,
          'public.internal_audit_staff_change()', 'execute')
     or pg_catalog.has_function_privilege(r.api_role::name,
          'public.internal_audit_cms_publish()', 'execute')
     or pg_catalog.has_function_privilege(r.api_role::name,
          'public.internal_purge_admin_audit_log()', 'execute')), 0,
  'no API role can call a trigger function or the purge');
select ok(pg_catalog.has_function_privilege('service_role',
  'public.internal_record_admin_action(uuid,text,text,text,jsonb)', 'execute'),
  'the Edge Functions can record an explicit admin action');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.internal_record_admin_action(uuid,text,text,text,jsonb)', 'execute'),
  'anon cannot record an admin action');
select ok(not pg_catalog.has_function_privilege('authenticated',
  'public.internal_record_admin_action(uuid,text,text,text,jsonb)', 'execute'),
  'a browser session cannot record an admin action');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.admin_list_audit_log(timestamptz,integer,uuid)', 'execute'),
  'a staff session may call the audit list');
select ok(not pg_catalog.has_function_privilege('anon',
  'public.admin_list_audit_log(timestamptz,integer,uuid)', 'execute'),
  'anon cannot call the audit list');
select ok(not pg_catalog.has_function_privilege('service_role',
  'public.admin_list_audit_log(timestamptz,integer,uuid)', 'execute'),
  'the service role cannot call the audit list');
select ok((select pg_catalog.bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
  from pg_catalog.pg_proc p
  where p.oid in ('public.internal_audit_staff_change()'::regprocedure,
                  'public.internal_audit_cms_publish()'::regprocedure,
                  'public.internal_record_admin_action(uuid,text,text,text,jsonb)'::regprocedure,
                  'public.admin_list_audit_log(timestamptz,integer,uuid)'::regprocedure,
                  'public.internal_purge_admin_audit_log()'::regprocedure)),
  'the five functions are security definer with an empty search path');
select is((select pg_catalog.array_agg(j.schedule || ' ' || j.command) from cron.job j
  where j.jobname = 'admin-audit-log-purge'),
  array['41 3 * * * select public.internal_purge_admin_audit_log()'],
  'one daily cron job purges the audit log');
select ok(not exists (select 1 from cron.job j
  where j.jobname <> 'admin-audit-log-purge' and j.schedule = '41 3 * * *'),
  'the purge runs at a minute no other job uses');
select is((select j.username::text from cron.job j where j.jobname = 'admin-audit-log-purge'),
  (select pg_catalog.pg_get_userbyid(p.proowner)::text from pg_catalog.pg_proc p
   where p.oid = 'public.internal_purge_admin_audit_log()'::regprocedure),
  'the job runs as the owner of the purge function, the only role that may execute it');

-- ---- the triggers -----------------------------------------------------------------------------
select is((select pg_catalog.array_agg(c.relname::text order by c.relname)
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  where t.tgname = 'admin_audit_log_capture' and not t.tgisinternal),
  array['barber_recurring_breaks', 'barber_schedules', 'barber_slot_blocks', 'barber_time_off',
        'barbers', 'bookings', 'profiles', 'reviews', 'services', 'site_settings'],
  'the audit trigger is attached to exactly the staff-managed tables');
-- tgtype 29 = row-level, after, insert + delete + update.
select is((select pg_catalog.count(*)::int from pg_catalog.pg_trigger t
  where t.tgname = 'admin_audit_log_capture' and not t.tgisinternal
    and (t.tgtype <> 29 or t.tgenabled <> 'O'
      or t.tgfoid <> 'public.internal_audit_staff_change()'::regprocedure)), 0,
  'every audit trigger is an enabled AFTER ROW trigger for insert, update and delete');
select is((select pg_catalog.count(*)::int
  from pg_catalog.pg_trigger t
  where t.tgname = 'admin_audit_log_capture' and not t.tgisinternal
    and pg_catalog.array_remove(
          pg_catalog.string_to_array(pg_catalog.encode(t.tgargs, 'escape'), '\000'), '')
        is distinct from (
          select pg_catalog.array_agg(a.attname::text order by k.ord)
          from pg_catalog.pg_index i
          cross join lateral pg_catalog.unnest(i.indkey::smallint[]) with ordinality as k(attnum, ord)
          join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
          where i.indrelid = t.tgrelid and i.indisprimary)), 0,
  'every audit trigger is given exactly the primary-key columns of its table');
select is((select pg_catalog.count(*)::int
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_attribute a on a.attrelid = t.tgrelid
  where t.tgname = 'admin_audit_log_capture' and not t.tgisinternal
    and a.attnum > 0 and not a.attisdropped
    and a.attname::text !~ '^[a-z_][a-z0-9_]{0,62}$'), 0,
  'every column of an audited table has a name the log accepts, so no change is dropped');
-- tgtype 5 = row-level, after, insert only.
select is((select pg_catalog.array_agg(
    c.relname::text || ':' || t.tgname::text || ':' || t.tgtype::text || ':' || t.tgenabled::text)
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and t.tgfoid = 'public.internal_audit_cms_publish()'::regprocedure),
  array['cms_revisions:admin_audit_log_capture_publish:5:O'],
  'the publish capture is one enabled AFTER INSERT row trigger, on cms_revisions only');

-- ---- fixtures ---------------------------------------------------------------------------------
delete from public.admin_audit_log;
insert into public.barbers (id, name) values ('auditbar', 'Audit Barber');
insert into auth.users (id, email) values
  ('79000000-0000-4000-8000-000000000001', 'owner@audit.local'),
  ('79000000-0000-4000-8000-000000000002', 'barber@audit.local'),
  ('79000000-0000-4000-8000-000000000003', 'forced-owner@audit.local'),
  ('79000000-0000-4000-8000-000000000004', 'disabled-owner@audit.local'),
  ('79000000-0000-4000-8000-000000000009', 'no-profile@audit.local');
insert into public.profiles (id, role, barber_id, account_enabled, must_change_password) values
  ('79000000-0000-4000-8000-000000000001', 'owner', null, true, false),
  ('79000000-0000-4000-8000-000000000002', 'barber', 'auditbar', true, false),
  ('79000000-0000-4000-8000-000000000003', 'owner', null, true, true),
  ('79000000-0000-4000-8000-000000000004', 'owner', null, false, false);
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('79000000-0000-4000-8000-0000000000b1', 'auditbar', 'h', 'Hår', 350, 45,
   '2097-03-01 09:00+00', '2097-03-01 09:45+00',
   'Kundnamn Hemligsson', 'email', '0707900001', 'hemlig.kund@audit.local', 'sv');
select is((select pg_catalog.count(*)::int from public.admin_audit_log), 0,
  'writes made without any JWT record nothing');

-- ---- requests that are not a staff session: nothing recorded, nothing refused ------------------
select set_config('request.jwt.claims', '{"role": "service_role", "iss": "supabase"}', true);
select lives_ok($$update public.bookings set lang = 'en'
  where id = '79000000-0000-4000-8000-0000000000b1'$$,
  'a write under a service-role JWT (the public booking gateway) succeeds');
select set_config('request.jwt.claims', '', true);
select lives_ok($$update public.bookings set lang = 'sv'
  where id = '79000000-0000-4000-8000-0000000000b1'$$, 'a write with empty claims succeeds');
select set_config('request.jwt.claims', 'not json', true);
select lives_ok($$update public.bookings set lang = 'en'
  where id = '79000000-0000-4000-8000-0000000000b1'$$,
  'a write with claims that are not JSON succeeds');
select set_config('request.jwt.claims', '[1, 2]', true);
select lives_ok($$update public.bookings set lang = 'sv'
  where id = '79000000-0000-4000-8000-0000000000b1'$$,
  'a write with claims that are not an object succeeds');
select set_config('request.jwt.claims', '{"sub": "not-a-uuid"}', true);
select lives_ok($$update public.bookings set lang = 'en'
  where id = '79000000-0000-4000-8000-0000000000b1'$$,
  'a write with a subject that is not a UUID succeeds');
select set_config('request.jwt.claims', '{"sub": 42}', true);
select lives_ok($$update public.bookings set lang = 'sv'
  where id = '79000000-0000-4000-8000-0000000000b1'$$,
  'a write with a numeric subject succeeds');
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000009')::text, true);
select lives_ok($$update public.bookings set lang = 'en'
  where id = '79000000-0000-4000-8000-0000000000b1'$$,
  'a write by a signed-in user who is not staff succeeds');
select is((select pg_catalog.count(*)::int from public.admin_audit_log), 0,
  'none of the requests that are not a staff session recorded anything');

-- ---- a staff session: every action on a booking, with column names only ------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000001')::text, true);
insert into public.bookings
  (id, barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('79000000-0000-4000-8000-0000000000b2', 'auditbar', 'h', 'Hår', 350, 45,
   '2097-03-02 09:00+00', '2097-03-02 09:45+00',
   'Kundnamn Hemligsson', 'email', '0707900001', 'hemlig.kund@audit.local', 'sv');
update public.bookings
set customer_name = 'Bytt Namnsson', phone = '0707900002', email = 'ny.adress@audit.local'
where id = '79000000-0000-4000-8000-0000000000b2';
update public.bookings set customer_name = customer_name
where id = '79000000-0000-4000-8000-0000000000b2';
select is((select pg_catalog.array_agg(
    l.action || ':' || coalesce(pg_catalog.array_to_string(l.changed_columns, ','), '-')
    order by l.action)
  from public.admin_audit_log l
  where l.target_table = 'bookings' and l.target_id = '79000000-0000-4000-8000-0000000000b2'),
  array['insert:-', 'update:customer_name,email,phone'],
  'an insert and an update are recorded, the update with the changed column names; an update that changed nothing is not');
select set_config('request.jwt.claims', '', true);
update public.booking_email_delivery_jobs
set status = 'delivered', completed_at = pg_catalog.now()
where booking_id = '79000000-0000-4000-8000-0000000000b2';
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000001')::text, true);
delete from public.bookings where id = '79000000-0000-4000-8000-0000000000b2';
select is((select pg_catalog.array_agg(l.action order by l.action) from public.admin_audit_log l
  where l.target_table = 'bookings' and l.target_id = '79000000-0000-4000-8000-0000000000b2'),
  array['delete', 'insert', 'update'], 'a delete is recorded with the primary key of the deleted row');
select is((select pg_catalog.array_agg(distinct l.actor_id::text) from public.admin_audit_log l),
  array['79000000-0000-4000-8000-000000000001'], 'every entry names the acting staff profile');
select ok((select pg_catalog.bool_and(l.created_at = pg_catalog.now()) from public.admin_audit_log l),
  'an entry is stamped with the transaction time');

-- ---- every other staff-managed table, including the rows a barber delete cascades to -----------
insert into public.barbers (id, name) values ('auditbar2', 'Andra Barberaren');
update public.barbers set name = 'Nytt Namn' where id = 'auditbar2';
insert into public.services (id, barber_id, name, price, duration_min) values
  ('79000000-0000-4000-8000-0000000000e1', 'auditbar2', 'Klippning', 300, 30);
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min) values
  ('auditbar2', 3, true, 540, 1020);
insert into public.barber_time_off (id, barber_id, start_date, end_date, reason) values
  ('79000000-0000-4000-8000-0000000000e2', 'auditbar2', '2097-01-01', '2097-01-02', 'Hemlig orsak');
insert into public.barber_slot_blocks (id, barber_id, block_date, start_min, end_min) values
  ('79000000-0000-4000-8000-0000000000e3', 'auditbar2', '2097-01-03', 600, 660);
insert into public.barber_recurring_breaks (id, barber_id, weekday, start_min, end_min) values
  ('79000000-0000-4000-8000-0000000000e4', 'auditbar2', 2, 720, 780);
insert into public.reviews (id, name, rating, text) values
  ('79000000-0000-4000-8000-0000000000e5', 'Kund K.', 5, 'Hemlig recensionstext');
update public.reviews set published = false where id = '79000000-0000-4000-8000-0000000000e5';
insert into public.site_settings (key, value) values ('audit_test_key', 'hemligt värde');
update public.profiles set auth_sync_version = auth_sync_version + 1
where id = '79000000-0000-4000-8000-000000000002';
delete from public.barbers where id = 'auditbar2';
select is((select pg_catalog.array_agg(
    l.target_table || '|' || l.action || '|' || l.target_id
      || '|' || coalesce(pg_catalog.array_to_string(l.changed_columns, ','), '-')
    order by l.target_table collate "C", l.action collate "C")
  from public.admin_audit_log l where l.target_table <> 'bookings'),
  array[
    'barber_recurring_breaks|delete|79000000-0000-4000-8000-0000000000e4|-',
    'barber_recurring_breaks|insert|79000000-0000-4000-8000-0000000000e4|-',
    'barber_schedules|delete|auditbar2/3|-',
    'barber_schedules|insert|auditbar2/3|-',
    'barber_slot_blocks|delete|79000000-0000-4000-8000-0000000000e3|-',
    'barber_slot_blocks|insert|79000000-0000-4000-8000-0000000000e3|-',
    'barber_time_off|delete|79000000-0000-4000-8000-0000000000e2|-',
    'barber_time_off|insert|79000000-0000-4000-8000-0000000000e2|-',
    'barbers|delete|auditbar2|-',
    'barbers|insert|auditbar2|-',
    'barbers|update|auditbar2|name',
    'profiles|update|79000000-0000-4000-8000-000000000002|auth_sync_version',
    'reviews|insert|79000000-0000-4000-8000-0000000000e5|-',
    'reviews|update|79000000-0000-4000-8000-0000000000e5|published',
    'services|delete|79000000-0000-4000-8000-0000000000e1|-',
    'services|insert|79000000-0000-4000-8000-0000000000e1|-',
    'site_settings|insert|audit_test_key|-'
  ],
  'each staff-managed table records its changes under its primary key, cascaded deletes included');

-- ---- the real staff paths: the trigger fires for a role with no privilege on the log -----------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000002')::text, true);
select is(public.admin_add_time_off('auditbar', '2097-02-01', '2097-02-02', 'Privat anledning')->>'ok',
  'true', 'a barber adds time off through the admin RPC');
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000001')::text, true);
select lives_ok($$update public.site_settings
  set value = case when value = '12' then '13' else '12' end
  where key = 'cancellation_policy_hours'$$, 'the owner changes a setting through RLS');
reset role;
select is((select l.action || '|' || l.target_table from public.admin_audit_log l
  where l.actor_id = '79000000-0000-4000-8000-000000000002'),
  'insert|barber_time_off', 'the change a barber made is recorded under the barber');
select ok((select 'value' = any(l.changed_columns) from public.admin_audit_log l
  where l.target_table = 'site_settings' and l.target_id = 'cancellation_policy_hours'
    and l.action = 'update'),
  'the setting change is recorded with the name of the changed column');

-- The legacy single-claim setting names the subject too, exactly as auth.uid() reads it.
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '79000000-0000-4000-8000-000000000001', true);
update public.barbers set ig = 'auditbar_ig' where id = 'auditbar';
select set_config('request.jwt.claim.sub', '', true);
select is((select pg_catalog.array_to_string(l.changed_columns, ',') from public.admin_audit_log l
  where l.target_table = 'barbers' and l.target_id = 'auditbar'), 'ig',
  'a subject in the legacy claim setting is recognised');

-- ---- no value of a changed row is in the log ---------------------------------------------------
select ok(not exists (select 1 from public.admin_audit_log l
  where pg_catalog.to_jsonb(l)::text ~* ('Hemligsson|Kundnamn|Namnsson|Bytt|070790000|audit\.local'
    || '|Hemlig orsak|Privat anledning|recensionstext|Kund K|hemligt|Barberaren|Nytt Namn|auditbar_ig')),
  'no customer name, phone number, e-mail address or other row value appears in any entry');

-- The table itself refuses what the writers never produce.
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'update', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', array['Anna Svensson'])$$,
  '23514', null, 'a name cannot be stored as a changed column');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'update', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', array['anna@example.com'])$$,
  '23514', null, 'an e-mail address cannot be stored as a changed column');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'update', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', array['0701234567'])$$,
  '23514', null, 'a phone number cannot be stored as a changed column');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'update', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', array['phone', null])$$,
  '23514', null, 'a missing column name is refused');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'update', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', '{}'::text[])$$,
  '23514', null, 'an update without a changed column is refused');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'update', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', null)$$,
  '23514', null, 'an update that names no column is refused');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id, changed_columns) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'bookings',
   '79000000-0000-4000-8000-0000000000b1', array['phone'])$$,
  '23514', null, 'an insert carries no column list');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'bookings', 'anna@example.com')$$,
  '23514', null, 'an e-mail address cannot be stored as a booking target');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'profiles', '0701234567')$$,
  '23514', null, 'a phone number cannot be stored as a profile target');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'Anna Svensson')$$,
  '23514', null, 'a name cannot be stored as a barber target');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'barber_schedules', 'auditbar/9')$$,
  '23514', null, 'a schedule target needs a weekday from 0 to 6');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'customers',
   '79000000-0000-4000-8000-0000000000b1')$$,
  '23514', null, 'a table outside the closed list is refused');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'login', 'profiles',
   '79000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an action outside the closed list is refused');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'cms_revisions', 'Startsida')$$,
  '23514', null, 'a revision target must be a revision number');

-- ---- a publish from CMS Studio: one entry, written from the revision row -----------------------
-- The gateway publishes with the service role and no staff JWT, so the capture on barbers and
-- site_settings, which the publish rewrites, records nothing. In a database that has no revision
-- yet the publish also stores a snapshot of the state before it; that row must not count.
delete from public.admin_audit_log;
select set_config('test.cms_state',
  public.internal_cms_state('79000000-0000-4000-8000-000000000001')::text, true);
set local role service_role;
select lives_ok($$select public.internal_cms_publish('79000000-0000-4000-8000-000000000001',
  current_setting('test.cms_state')::jsonb->'document',
  (current_setting('test.cms_state')::jsonb->>'revision')::bigint,
  current_setting('test.cms_state')::jsonb->>'fingerprint',
  '79000000-0000-4000-8000-0000000000f1')$$,
  'the owner publishes from CMS Studio through the service-role gateway');
reset role;
select is((select pg_catalog.array_agg(
    l.actor_id::text || '|' || l.action || '|' || l.target_table || '|' || l.target_id
      || '|' || coalesce(pg_catalog.array_to_string(l.changed_columns, ','), '-'))
  from public.admin_audit_log l),
  array['79000000-0000-4000-8000-000000000001|insert|cms_revisions|'
    || ((current_setting('test.cms_state')::jsonb->>'revision')::bigint + 1)::text || '|-'],
  'the publish records exactly one entry: the publishing owner and the number of the new revision');
select lives_ok($$insert into public.cms_revisions
    (revision, actor_id, request_id, request_fingerprint, document, fingerprint)
  values
    (900001, null, '79000000-0000-4000-8000-0000000000f2', md5('a'), '{}', md5('{}')),
    (900002, '79000000-0000-4000-8000-000000000009', '79000000-0000-4000-8000-0000000000f3',
     md5('b'), '{}', md5('{}')),
    (900003, '79000000-0000-4000-8000-000000000001', null, null, '{}', md5('{}'))$$,
  'a revision with no actor, one by an actor who is not staff and one without a request are stored');
select is((select pg_catalog.count(*)::int from public.admin_audit_log), 1,
  'none of those three revisions adds an entry');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000001')::text, true);
select is((select e - 'id' - 'created_at'
  from pg_catalog.jsonb_array_elements(public.admin_list_audit_log()->'entries') e
  where e->>'target_table' = 'cms_revisions'),
  pg_catalog.jsonb_build_object(
    'actor_id', '79000000-0000-4000-8000-000000000001', 'actor_role', 'owner',
    'actor_barber_id', null, 'action', 'insert', 'target_table', 'cms_revisions',
    'target_id', ((current_setting('test.cms_state')::jsonb->>'revision')::bigint + 1)::text,
    'changed_columns', null),
  'the owner reads the publish through the audit list like any other entry');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---- the explicit record for service-role Edge Functions ---------------------------------------
delete from public.admin_audit_log;
set local role service_role;
select lives_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'insert', 'profiles',
  '79000000-0000-4000-8000-000000000002', null)$$, 'a profile creation is recorded');
select lives_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'staff_invitations',
  '79000000-0000-4000-8000-0000000000AB', '{"changed": ["token_hash", "token_hash"]}')$$,
  'an invitation renewal is recorded with its changed column');
select lives_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000002', 'delete', 'barber_photos', 'auditbar', null)$$,
  'a barber photo removal is recorded under the barber id');
select lives_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000002', 'update', 'barber_calendar_tokens', 'auditbar',
  '{"changed": ["disconnect_requested_at"]}')$$, 'a calendar disconnect is recorded');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000009', 'insert', 'profiles',
  '79000000-0000-4000-8000-000000000002', null)$$,
  '22023', 'actor is not a staff profile', 'an actor who is not staff is refused');
select throws_ok($$select public.internal_record_admin_action(
  null, 'insert', 'profiles', '79000000-0000-4000-8000-000000000002', null)$$,
  '22023', 'actor is not a staff profile', 'a missing actor is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'login', 'profiles',
  '79000000-0000-4000-8000-000000000002', null)$$,
  '22023', 'unknown action', 'an unknown action is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'insert', 'bookings',
  '79000000-0000-4000-8000-0000000000b1', null)$$,
  '22023', 'unknown target table', 'a table the Edge Functions do not write for staff is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'insert', 'cms_revisions', '7', null)$$,
  '22023', 'unknown target table',
  'a publish cannot be recorded by hand: the revision trigger is its only writer');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'insert', 'profiles', 'hemlig.kund@audit.local', null)$$,
  '22023', 'invalid target id', 'an e-mail address is refused as a profile target');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'insert', 'profiles', null, null)$$,
  '22023', 'invalid target id', 'a missing target is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'delete', 'barber_photos', 'kundnamn-hemligsson', null)$$,
  '22023', 'invalid target id', 'a barber target that is not a barber is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '"fri text"')$$,
  '22023', 'invalid detail', 'a detail that is not an object is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": ["role"], "note": "fri text"}')$$,
  '22023', 'invalid detail', 'a detail with any key but changed is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": "role"}')$$,
  '22023', 'invalid detail', 'a changed value that is not a list is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": ["hemlig.kund@audit.local"]}')$$,
  '22023', 'invalid detail', 'a changed entry that is not a column of the table is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": ["customer_name"]}')$$,
  '22023', 'invalid detail', 'a column of another table is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": [42]}')$$,
  '22023', 'invalid detail', 'a changed entry that is not a string is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": []}')$$,
  '22023', 'invalid detail', 'an empty changed list is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'update', 'profiles',
  '79000000-0000-4000-8000-000000000002', null)$$,
  '22023', 'invalid detail', 'an update without its changed columns is refused');
select throws_ok($$select public.internal_record_admin_action(
  '79000000-0000-4000-8000-000000000001', 'insert', 'profiles',
  '79000000-0000-4000-8000-000000000002', '{"changed": ["role"]}')$$,
  '22023', 'invalid detail', 'an insert with changed columns is refused');
reset role;
select is((select pg_catalog.array_agg(
    l.actor_id::text || '|' || l.action || '|' || l.target_table || '|' || l.target_id
      || '|' || coalesce(pg_catalog.array_to_string(l.changed_columns, ','), '-')
    order by l.target_table collate "C")
  from public.admin_audit_log l),
  array[
    '79000000-0000-4000-8000-000000000002|update|barber_calendar_tokens|auditbar|disconnect_requested_at',
    '79000000-0000-4000-8000-000000000002|delete|barber_photos|auditbar|-',
    '79000000-0000-4000-8000-000000000001|insert|profiles|79000000-0000-4000-8000-000000000002|-',
    '79000000-0000-4000-8000-000000000001|update|staff_invitations|79000000-0000-4000-8000-0000000000ab|token_hash'
  ],
  'the four accepted records are stored, with a canonical target id and each changed column once, and no refused call stored anything');

-- ---- owner-only read with keyset pages ---------------------------------------------------------
delete from public.admin_audit_log;
insert into public.admin_audit_log
  (id, created_at, actor_id, action, target_table, target_id, changed_columns)
values
  ('79000000-0000-4000-8000-0000000000a1', pg_catalog.now() - interval '3 hours',
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'auditbar', null),
  ('79000000-0000-4000-8000-0000000000c1', pg_catalog.now() - interval '2 hours',
   '79000000-0000-4000-8000-000000000002', 'update', 'services',
   '79000000-0000-4000-8000-0000000000e1', array['price']),
  ('79000000-0000-4000-8000-0000000000c2', pg_catalog.now() - interval '2 hours',
   '79000000-0000-4000-8000-000000000001', 'delete', 'bookings',
   '79000000-0000-4000-8000-0000000000b2', null),
  ('79000000-0000-4000-8000-0000000000d1', pg_catalog.now() - interval '1 hour',
   '79000000-0000-4000-8000-0000000000ee', 'update', 'site_settings',
   'cancellation_policy_hours', array['value']);

set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from public.admin_audit_log$$, '42501', null,
  'anon cannot select the log');
select throws_ok($$select public.admin_list_audit_log()$$, '42501', null,
  'anon cannot list the log');
reset role;
set local role service_role;
select throws_ok($$select * from public.admin_audit_log$$, '42501', null,
  'the service role cannot select the log');
select throws_ok($$insert into public.admin_audit_log
  (actor_id, action, target_table, target_id) values
  ('79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'auditbar')$$, '42501', null,
  'the service role cannot write the log directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000002')::text, true);
select throws_ok($$select * from public.admin_audit_log$$, '42501', null,
  'a barber cannot select the log');
select throws_ok($$select public.admin_list_audit_log()$$, '42501', 'owner required',
  'a barber cannot list the log');
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.admin_list_audit_log()$$, '42501', 'owner required',
  'an owner awaiting a forced password change cannot list the log');
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000004')::text, true);
select throws_ok($$select public.admin_list_audit_log()$$, '42501', 'owner required',
  'a disabled owner cannot list the log');

select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000001')::text, true);
select is((select pg_catalog.array_agg(e->>'id' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_audit_log()->'entries')
    with ordinality as page(e, n)),
  array['79000000-0000-4000-8000-0000000000d1', '79000000-0000-4000-8000-0000000000c2',
        '79000000-0000-4000-8000-0000000000c1', '79000000-0000-4000-8000-0000000000a1'],
  'the owner lists every entry, newest first, a time tie broken by id');
select is(public.admin_list_audit_log()->'has_more', 'false'::jsonb,
  'a list that fits one page reports no more rows');
select is((select pg_catalog.array_agg(distinct k collate "C" order by k collate "C")
  from pg_catalog.jsonb_array_elements(public.admin_list_audit_log()->'entries') e,
       pg_catalog.jsonb_object_keys(e) k),
  array['action', 'actor_barber_id', 'actor_id', 'actor_role', 'changed_columns', 'created_at',
        'id', 'target_id', 'target_table'],
  'a list entry has exactly these nine keys');
select is((select e from pg_catalog.jsonb_array_elements(public.admin_list_audit_log()->'entries') e
    where e->>'id' = '79000000-0000-4000-8000-0000000000c1') - 'created_at',
  '{"id": "79000000-0000-4000-8000-0000000000c1",
    "actor_id": "79000000-0000-4000-8000-000000000002", "actor_role": "barber",
    "actor_barber_id": "auditbar", "action": "update", "target_table": "services",
    "target_id": "79000000-0000-4000-8000-0000000000e1", "changed_columns": ["price"]}'::jsonb,
  'an entry carries the actor with the current role and barber, the action, the target and the column names');
select is((select e from pg_catalog.jsonb_array_elements(public.admin_list_audit_log()->'entries') e
    where e->>'id' = '79000000-0000-4000-8000-0000000000d1') - 'created_at',
  '{"id": "79000000-0000-4000-8000-0000000000d1",
    "actor_id": "79000000-0000-4000-8000-0000000000ee", "actor_role": null,
    "actor_barber_id": null, "action": "update", "target_table": "site_settings",
    "target_id": "cancellation_policy_hours", "changed_columns": ["value"]}'::jsonb,
  'an entry of a deleted staff account keeps the actor id and reads no role');
select is((select (e->>'created_at')::timestamptz
  from pg_catalog.jsonb_array_elements(public.admin_list_audit_log()->'entries') e
  where e->>'id' = '79000000-0000-4000-8000-0000000000a1'),
  pg_catalog.now() - interval '3 hours', 'an entry carries its time');
select is((select pg_catalog.array_agg(e->>'id' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_audit_log(p_limit => 2)->'entries')
    with ordinality as page(e, n)),
  array['79000000-0000-4000-8000-0000000000d1', '79000000-0000-4000-8000-0000000000c2'],
  'the first page holds the newest rows');
select is(public.admin_list_audit_log(p_limit => 2)->'has_more', 'true'::jsonb,
  'a full page reports more rows');
select is((select pg_catalog.array_agg(e->>'id' order by n)
  from pg_catalog.jsonb_array_elements(public.admin_list_audit_log(
    p_before => pg_catalog.now() - interval '2 hours', p_limit => 2,
    p_before_id => '79000000-0000-4000-8000-0000000000c2')->'entries')
    with ordinality as page(e, n)),
  array['79000000-0000-4000-8000-0000000000c1', '79000000-0000-4000-8000-0000000000a1'],
  'the cursor continues inside a time tie without skipping a row');
select is(public.admin_list_audit_log(p_before => pg_catalog.now() - interval '2 hours',
  p_limit => 2, p_before_id => '79000000-0000-4000-8000-0000000000c2')->'has_more', 'false'::jsonb,
  'the last page reports no more rows');
select is(pg_catalog.jsonb_array_length(public.admin_list_audit_log(p_limit => 0)->'entries'), 1,
  'the page size is clamped to at least one row');
select throws_ok($$select public.admin_list_audit_log(p_before => pg_catalog.now())$$,
  '22023', null, 'a cursor time without its id is rejected');
select throws_ok($$select public.admin_list_audit_log(
  p_before_id => '79000000-0000-4000-8000-0000000000c2')$$,
  '22023', null, 'a cursor id without its time is rejected');
reset role;
select set_config('request.jwt.claims', '', true);

-- The page size is capped at 100 rows.
insert into public.admin_audit_log (actor_id, action, target_table, target_id)
select '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'auditbar'
from pg_catalog.generate_series(1, 120);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '79000000-0000-4000-8000-000000000001')::text, true);
select is(pg_catalog.jsonb_array_length(public.admin_list_audit_log(p_limit => 500)->'entries'), 100,
  'the page size is capped at 100 rows');
select is(public.admin_list_audit_log(p_limit => 500)->'has_more', 'true'::jsonb,
  'a capped page still reports more rows');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---- 12-month retention is strict: keep the exact cutoff and the row one microsecond newer -----
delete from public.admin_audit_log;
insert into public.admin_audit_log (created_at, actor_id, action, target_table, target_id) values
  (pg_catalog.now() - interval '13 months',
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'r-13'),
  (pg_catalog.now() - interval '11 months',
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'r-11'),
  (pg_catalog.now() - interval '12 months',
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'r-12-exact'),
  (pg_catalog.now() - interval '12 months' - interval '1 microsecond',
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'r-12-older'),
  (pg_catalog.now() - interval '12 months' + interval '1 microsecond',
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'r-12-newer'),
  (pg_catalog.now(),
   '79000000-0000-4000-8000-000000000001', 'insert', 'barbers', 'r-now');
select is(public.internal_purge_admin_audit_log(), 2,
  'the purge deletes the 13-month row and the row one microsecond beyond 12 months');
select is((select pg_catalog.array_agg(l.target_id order by l.target_id) from public.admin_audit_log l),
  array['r-11', 'r-12-exact', 'r-12-newer', 'r-now'],
  'the exact 12-month cutoff and every newer row remain');

-- The scheduling block is idempotent: run twice more, one job with the same schedule and command.
select set_config('test.cron_before', (select j.schedule || ' ' || j.command from cron.job j
  where j.jobname = 'admin-audit-log-purge'), true);
do $$
begin
  for i in 1..2 loop
    if exists (select 1 from cron.job where jobname = 'admin-audit-log-purge') then
      perform cron.unschedule('admin-audit-log-purge');
    end if;
    perform cron.schedule('admin-audit-log-purge', '41 3 * * *',
      'select public.internal_purge_admin_audit_log()');
  end loop;
end;
$$;
select is((select pg_catalog.count(*)::int from cron.job where jobname = 'admin-audit-log-purge'), 1,
  'the purge job exists exactly once after re-running its scheduling block twice');
select is((select j.schedule || ' ' || j.command from cron.job j
  where j.jobname = 'admin-audit-log-purge'), current_setting('test.cron_before'),
  'the re-run block schedules exactly what the migration scheduled');

select * from finish();
rollback;
