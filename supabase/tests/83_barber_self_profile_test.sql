-- pgTAP: barber self-service profile and work pictures (migration 20261111121000).
begin;
select plan(126);

-- ---- the tiktok column ------------------------------------------------------------------------
select has_column('public', 'barbers', 'tiktok', 'barbers has a tiktok column');
select is((select pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
    || ':' || pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.barbers'::regclass and a.attname = 'tiktok'),
  'text:true:''''::text', 'tiktok is text, not null, with an empty default');
select is((select pg_catalog.count(*)::int from public.barbers b where b.tiktok <> ''), 0,
  'every barber that already existed has an empty TikTok handle');

-- ---- the work picture table -------------------------------------------------------------------
select has_table('public', 'barber_work_photos', 'the work picture table exists');
select is((select pg_catalog.array_agg(
    a.attname::text || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod)
      || ':' || a.attnotnull::text order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.barber_work_photos'::regclass and a.attnum > 0 and not a.attisdropped),
  array['id:uuid:true', 'barber_id:text:true', 'storage_path:text:true', 'hidden:boolean:true',
        'created_at:timestamp with time zone:true'],
  'the work picture table has exactly these columns, none of them nullable');
select col_is_pk('public', 'barber_work_photos', 'id', 'id is the primary key');
select col_is_unique('public', 'barber_work_photos', 'storage_path',
  'a storage path is stored at most once');
select ok(exists (select 1 from pg_catalog.pg_constraint c
  where c.conrelid = 'public.barber_work_photos'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.barbers'::regclass
    and c.confdeltype = 'c'
    and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
      where a.attrelid = 'public.barber_work_photos'::regclass and a.attname = 'barber_id')]
    and c.confkey = array[(select a.attnum from pg_catalog.pg_attribute a
      where a.attrelid = 'public.barbers'::regclass and a.attname = 'id')]),
  'barber_id references barbers(id) and its rows are deleted with the barber');
select ok(pg_catalog.pg_get_indexdef('public.barber_work_photos_barber_created_idx'::regclass)
    ~ ' USING btree \(barber_id, created_at DESC\)$',
  'an index serves one barber''s pictures newest first');
select ok((select relrowsecurity from pg_catalog.pg_class
  where oid = 'public.barber_work_photos'::regclass), 'the work picture table has RLS enabled');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_policy
  where polrelid = 'public.barber_work_photos'::regclass), 0,
  'the work picture table has no policy');
select is((select pg_catalog.count(*)::int from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.barber_work_photos'::regclass and not t.tgisinternal), 0,
  'no trigger is attached to the work picture table, so the admin log does not record it');
select is((select pg_catalog.count(*)::int
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role),
       pg_catalog.unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references',
                               'trigger', 'maintain']) as p(privilege)
  where pg_catalog.has_table_privilege(r.api_role::name, 'public.barber_work_photos',
          p.privilege)), 0,
  'no API role holds any privilege on the work picture table');

-- ---- the functions ----------------------------------------------------------------------------
select is((select pg_catalog.array_agg(
    p.proname::text || '(' || pg_catalog.pg_get_function_arguments(p.oid) || ') -> '
      || pg_catalog.pg_get_function_result(p.oid) order by p.proname)
  from pg_catalog.pg_proc p
  where p.oid in ('public.staff_barber_profile(text)'::regprocedure,
                  'public.staff_update_barber_profile(text,text,text,text,text,text)'::regprocedure,
                  'public.staff_set_barber_work_photo_hidden(uuid,boolean)'::regprocedure,
                  'public.internal_add_barber_work_photo(text,text)'::regprocedure,
                  'public.internal_delete_barber_work_photo(text,text)'::regprocedure,
                  'public.public_booking_catalog()'::regprocedure)),
  array['internal_add_barber_work_photo(p_barber_id text, p_path text) -> jsonb',
        'internal_delete_barber_work_photo(p_barber_id text, p_path text) -> jsonb',
        'public_booking_catalog() -> jsonb',
        'staff_barber_profile(p_barber_id text) -> jsonb',
        'staff_set_barber_work_photo_hidden(p_id uuid, p_hidden boolean) -> jsonb',
        'staff_update_barber_profile(p_barber_id text, p_name text, p_ig text, p_tiktok text, '
          || 'p_bio_sv text, p_bio_en text) -> jsonb'],
  'the six functions take these arguments and return jsonb');
select ok((select pg_catalog.bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
  from pg_catalog.pg_proc p
  where p.oid in ('public.staff_barber_profile(text)'::regprocedure,
                  'public.staff_update_barber_profile(text,text,text,text,text,text)'::regprocedure,
                  'public.staff_set_barber_work_photo_hidden(uuid,boolean)'::regprocedure,
                  'public.internal_add_barber_work_photo(text,text)'::regprocedure,
                  'public.internal_delete_barber_work_photo(text,text)'::regprocedure,
                  'public.public_booking_catalog()'::regprocedure)),
  'the six functions are security definer with an empty search path');
select is((select pg_catalog.array_agg(
    p.proname::text || ':' || l.lanname::text || ':' || p.provolatile::text order by p.proname)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid in ('public.staff_barber_profile(text)'::regprocedure,
                  'public.staff_update_barber_profile(text,text,text,text,text,text)'::regprocedure,
                  'public.staff_set_barber_work_photo_hidden(uuid,boolean)'::regprocedure,
                  'public.internal_add_barber_work_photo(text,text)'::regprocedure,
                  'public.internal_delete_barber_work_photo(text,text)'::regprocedure,
                  'public.public_booking_catalog()'::regprocedure)),
  array['internal_add_barber_work_photo:plpgsql:v', 'internal_delete_barber_work_photo:plpgsql:v',
        'public_booking_catalog:sql:s', 'staff_barber_profile:plpgsql:s',
        'staff_set_barber_work_photo_hidden:plpgsql:v', 'staff_update_barber_profile:plpgsql:v'],
  'the reads are stable, the writes volatile, and the catalog is still a stable SQL function');
select is((select pg_catalog.pg_get_userbyid(p.proowner)::text || ':'
    || coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '-')
  from pg_catalog.pg_proc p where p.oid = 'public.public_booking_catalog()'::regprocedure),
  'postgres:-', 'the catalog keeps its owner and still has no comment');
select is((select pg_catalog.array_agg(f.signature || ' ' || r.api_role
    order by f.signature collate "C", r.api_role collate "C")
  from pg_catalog.unnest(array[
         'public.internal_add_barber_work_photo(text,text)',
         'public.internal_delete_barber_work_photo(text,text)',
         'public.public_booking_catalog()',
         'public.staff_barber_profile(text)',
         'public.staff_set_barber_work_photo_hidden(uuid,boolean)',
         'public.staff_update_barber_profile(text,text,text,text,text,text)']) as f(signature),
       pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as r(api_role)
  where pg_catalog.has_function_privilege(r.api_role::name, f.signature, 'execute')),
  array['public.internal_add_barber_work_photo(text,text) service_role',
        'public.internal_delete_barber_work_photo(text,text) service_role',
        'public.public_booking_catalog() anon',
        'public.public_booking_catalog() authenticated',
        'public.public_booking_catalog() service_role',
        'public.staff_barber_profile(text) authenticated',
        'public.staff_set_barber_work_photo_hidden(uuid,boolean) authenticated',
        'public.staff_update_barber_profile(text,text,text,text,text,text) authenticated'],
  'staff functions run for staff sessions only, internal ones for the service role only, '
    || 'and the catalog keeps its three callers');
select ok(not exists (select 1
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) acl
  where p.oid in ('public.staff_barber_profile(text)'::regprocedure,
                  'public.staff_update_barber_profile(text,text,text,text,text,text)'::regprocedure,
                  'public.staff_set_barber_work_photo_hidden(uuid,boolean)'::regprocedure,
                  'public.internal_add_barber_work_photo(text,text)'::regprocedure,
                  'public.internal_delete_barber_work_photo(text,text)'::regprocedure,
                  'public.public_booking_catalog()'::regprocedure)
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute on any of the six functions');

-- ---- the bucket -------------------------------------------------------------------------------
select is((select b.name || ':' || b.public::text || ':' || b.file_size_limit::text || ':'
    || pg_catalog.array_to_string(b.allowed_mime_types, ',')
  from storage.buckets b where b.id = 'barber-work'),
  'barber-work:true:512000:image/webp',
  'the barber-work bucket is public and takes only WebP of at most 512000 bytes');
-- pg_policy.polcmd: 'a'=INSERT, 'w'=UPDATE, 'd'=DELETE, '*'=ALL.
select is((select pg_catalog.count(*)::int from pg_catalog.pg_policy
  where polrelid = 'storage.objects'::regclass and polcmd in ('a', 'w', 'd', '*')), 0,
  'no policy lets a client role write, change or delete a Storage object in any bucket');

-- ---- fixtures ---------------------------------------------------------------------------------
insert into public.barbers (id, name, ig, bio_sv, bio_en, active, sort_order) values
  ('selfprof-a', 'Self A', 'self_a', 'Bio A', 'Bio A en', true, 950),
  ('selfprof-b', 'Self B', 'self_b', 'Bio B', 'Bio B en', true, 951),
  ('selfprof-d', 'Self D', '', '', '', true, 952),
  ('selfprof-h', 'Self H', 'self_h', '', '', false, 949),
  ('selfprof-x', 'Self X', '', '', '', true, 953);
insert into public.barber_photos (barber_id, storage_path) values
  ('selfprof-a', 'selfprof-a/photo.webp');
insert into public.barber_work_photos (id, barber_id, storage_path, hidden, created_at) values
  ('83000000-0000-4000-8000-0000000000a1', 'selfprof-a', 'selfprof-a/old.webp', false,
   pg_catalog.now() - interval '3 days'),
  ('83000000-0000-4000-8000-0000000000a2', 'selfprof-a', 'selfprof-a/mid.webp', true,
   pg_catalog.now() - interval '2 days'),
  ('83000000-0000-4000-8000-0000000000a3', 'selfprof-a', 'selfprof-a/new.webp', false,
   pg_catalog.now() - interval '1 day'),
  ('83000000-0000-4000-8000-0000000000c1', 'selfprof-h', 'selfprof-h/work.webp', false,
   pg_catalog.now() - interval '1 day'),
  ('83000000-0000-4000-8000-0000000000e1', 'selfprof-x', 'selfprof-x/one.webp', false,
   pg_catalog.now() - interval '1 day'),
  ('83000000-0000-4000-8000-0000000000e2', 'selfprof-x', 'selfprof-x/two.webp', true,
   pg_catalog.now() - interval '2 days');
insert into auth.users (id, email) values
  ('83000000-0000-4000-8000-000000000001', 'owner@selfprof.local'),
  ('83000000-0000-4000-8000-000000000002', 'barber-a@selfprof.local'),
  ('83000000-0000-4000-8000-000000000003', 'barber-b@selfprof.local'),
  ('83000000-0000-4000-8000-000000000004', 'barber-h@selfprof.local'),
  ('83000000-0000-4000-8000-000000000005', 'disabled-barber@selfprof.local'),
  ('83000000-0000-4000-8000-000000000006', 'unlinked-barber@selfprof.local'),
  ('83000000-0000-4000-8000-000000000007', 'disabled-owner@selfprof.local'),
  ('83000000-0000-4000-8000-000000000009', 'no-profile@selfprof.local');
insert into public.profiles (id, role, barber_id, account_enabled, must_change_password) values
  ('83000000-0000-4000-8000-000000000001', 'owner', null, true, false),
  ('83000000-0000-4000-8000-000000000002', 'barber', 'selfprof-a', true, false),
  ('83000000-0000-4000-8000-000000000003', 'barber', 'selfprof-b', true, false),
  ('83000000-0000-4000-8000-000000000004', 'barber', 'selfprof-h', true, false),
  ('83000000-0000-4000-8000-000000000005', 'barber', 'selfprof-d', false, false),
  ('83000000-0000-4000-8000-000000000006', 'barber', null, true, false),
  ('83000000-0000-4000-8000-000000000007', 'owner', null, false, false);

select throws_ok($$update public.barbers set tiktok = pg_catalog.repeat('t', 61)
  where id = 'selfprof-d'$$, '23514', null, 'the table refuses a TikTok handle over 60 characters');
select throws_ok($$insert into public.barber_work_photos (barber_id, storage_path)
  values ('selfprof-d', '')$$, '23514', null, 'the table refuses an empty storage path');
select throws_ok($$insert into public.barber_work_photos (barber_id, storage_path)
  values ('selfprof-d', 'selfprof-d/' || pg_catalog.repeat('p', 290))$$, '23514', null,
  'the table refuses a storage path over 300 characters');

select set_config('selfprof.row_a',
  (select pg_catalog.to_jsonb(b)::text from public.barbers b where b.id = 'selfprof-a'), true);
select set_config('selfprof.row_b',
  (select pg_catalog.to_jsonb(b)::text from public.barbers b where b.id = 'selfprof-b'), true);

-- ---- the bucket from the client roles ---------------------------------------------------------
insert into storage.objects (bucket_id, name) values ('barber-work', 'selfprof-a/stored.webp');
select is((select pg_catalog.count(*)::int from public.cms_assets a where a.bucket = 'barber-work'),
  0, 'an object in barber-work is not registered as a CMS asset');
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select pg_catalog.count(*)::int from storage.objects o where o.bucket_id = 'barber-work'),
  0, 'anon sees no object row of barber-work, so it cannot list the bucket');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('barber-work', 'selfprof-a/anon.webp')$$, '42501', null,
  'anon cannot write an object into barber-work');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000002')::text, true);
select is((select pg_catalog.count(*)::int from storage.objects o where o.bucket_id = 'barber-work'),
  0, 'a signed-in barber sees no object row of barber-work either');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('barber-work', 'selfprof-a/direct.webp')$$, '42501', null,
  'a signed-in barber cannot write an object into barber-work directly');
reset role;
set local role service_role;
select is((select pg_catalog.count(*)::int from storage.objects o
  where o.bucket_id = 'barber-work' and o.name = 'selfprof-a/stored.webp'), 1,
  'the service role, which upload-image uses, sees the object');
reset role;

-- ---- staff_barber_profile ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000001')::text, true);
select is(public.staff_barber_profile('selfprof-a'),
  '{"ok": true,
    "profile": {"name": "Self A", "ig": "self_a", "tiktok": "", "bio_sv": "Bio A",
                "bio_en": "Bio A en"},
    "work": [
      {"id": "83000000-0000-4000-8000-0000000000a3", "path": "selfprof-a/new.webp", "hidden": false},
      {"id": "83000000-0000-4000-8000-0000000000a2", "path": "selfprof-a/mid.webp", "hidden": true},
      {"id": "83000000-0000-4000-8000-0000000000a1", "path": "selfprof-a/old.webp", "hidden": false}
    ]}'::jsonb,
  'the owner reads a barber''s profile and every work picture, newest first, with its hidden flag');
select is(public.staff_barber_profile('selfprof-h') -> 'profile' ->> 'name', 'Self H',
  'the owner reads the profile of a barber hidden from the site');
select is(public.staff_barber_profile('selfprof-d') -> 'work', '[]'::jsonb,
  'a barber without work pictures has an empty list');
select is(public.staff_barber_profile('selfprof-nobody'),
  '{"ok": false, "error": "not_found"}'::jsonb, 'the owner asking for an unknown barber gets not_found');

select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000002')::text, true);
select is(public.staff_barber_profile('selfprof-a') -> 'profile',
  '{"name": "Self A", "ig": "self_a", "tiktok": "", "bio_sv": "Bio A", "bio_en": "Bio A en"}'::jsonb,
  'a barber reads their own profile');
select is(pg_catalog.jsonb_array_length(public.staff_barber_profile('selfprof-a') -> 'work'), 3,
  'a barber also sees their own hidden pictures');
select is(public.staff_barber_profile('selfprof-b'), '{"ok": false, "error": "forbidden"}'::jsonb,
  'a barber cannot read another barber''s profile');
select is(public.staff_barber_profile('selfprof-nobody'),
  '{"ok": false, "error": "forbidden"}'::jsonb,
  'a barber asking for an unknown barber is refused, not told whether it exists');
select is(public.staff_barber_profile(null), '{"ok": false, "error": "forbidden"}'::jsonb,
  'a barber passing no id is refused');

select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000004')::text, true);
select is(public.staff_barber_profile('selfprof-h') ->> 'ok', 'true',
  'a barber hidden from the site still reads their own profile');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000005')::text, true);
select is(public.staff_barber_profile('selfprof-d'), '{"ok": false, "error": "forbidden"}'::jsonb,
  'a disabled barber account cannot read its own profile');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000006')::text, true);
select is(public.staff_barber_profile('selfprof-a'), '{"ok": false, "error": "forbidden"}'::jsonb,
  'a barber account linked to no barber is refused');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000007')::text, true);
select is(public.staff_barber_profile('selfprof-a'), '{"ok": false, "error": "forbidden"}'::jsonb,
  'a disabled owner account is refused');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000009')::text, true);
select is(public.staff_barber_profile('selfprof-a'), '{"ok": false, "error": "forbidden"}'::jsonb,
  'a signed-in user without a staff profile is refused');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.staff_barber_profile('selfprof-a')$$, '42501', null,
  'anon cannot call the profile read');
reset role;
set local role service_role;
select throws_ok($$select public.staff_barber_profile('selfprof-a')$$, '42501', null,
  'the service role cannot call the profile read');
reset role;

-- ---- staff_update_barber_profile: refused calls -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000002')::text, true);
select is(public.staff_update_barber_profile('selfprof-a', null, 'self_a', '', 'Bio A', 'Bio A en'),
  '{"ok": false, "error": "invalid_name"}'::jsonb, 'a missing name is invalid_name');
select is(public.staff_update_barber_profile('selfprof-a', '   ', 'self_a', '', 'Bio A', 'Bio A en'),
  '{"ok": false, "error": "invalid_name"}'::jsonb, 'a name of spaces only is invalid_name');
select is(public.staff_update_barber_profile('selfprof-a', pg_catalog.repeat('n', 61), 'self_a', '',
    'Bio A', 'Bio A en'),
  '{"ok": false, "error": "invalid_name"}'::jsonb, 'a name over 60 characters is invalid_name');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', null, '', 'Bio A', 'Bio A en'),
  '{"ok": false, "error": "invalid_handle"}'::jsonb, 'a missing Instagram handle is invalid_handle');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', null, 'Bio A',
    'Bio A en'),
  '{"ok": false, "error": "invalid_handle"}'::jsonb, 'a missing TikTok handle is invalid_handle');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self a', '', 'Bio A',
    'Bio A en'),
  '{"ok": false, "error": "invalid_handle"}'::jsonb, 'a handle with a space is invalid_handle');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a',
    pg_catalog.repeat('t', 31), 'Bio A', 'Bio A en'),
  '{"ok": false, "error": "invalid_handle"}'::jsonb, 'a handle of 31 characters is invalid_handle');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', '@@self_a', '', 'Bio A',
    'Bio A en'),
  '{"ok": false, "error": "invalid_handle"}'::jsonb, 'only one leading @ is removed');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'åsa', '', 'Bio A', 'Bio A en'),
  '{"ok": false, "error": "invalid_handle"}'::jsonb,
  'a handle with a letter outside A to Z is invalid_handle');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '', null, 'Bio A en'),
  '{"ok": false, "error": "invalid_bio"}'::jsonb, 'a missing Swedish bio is invalid_bio');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '', 'Bio A', null),
  '{"ok": false, "error": "invalid_bio"}'::jsonb, 'a missing English bio is invalid_bio');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '',
    pg_catalog.repeat('b', 601), 'Bio A en'),
  '{"ok": false, "error": "invalid_bio"}'::jsonb, 'a Swedish bio of 601 characters is invalid_bio');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '', 'Bio A',
    pg_catalog.repeat('b', 601)),
  '{"ok": false, "error": "invalid_bio"}'::jsonb, 'an English bio of 601 characters is invalid_bio');
select is(public.staff_update_barber_profile('selfprof-a', '', 'self a', '', null, ''),
  '{"ok": false, "error": "invalid_name"}'::jsonb,
  'the name is checked before the handles and the bios');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self a', '', null, ''),
  '{"ok": false, "error": "invalid_handle"}'::jsonb, 'the handles are checked before the bios');
select is(public.staff_update_barber_profile('selfprof-b', 'Self B', 'self_b', '', 'Bio B',
    'Bio B en'),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a barber cannot change another barber''s profile');
select is(public.staff_update_barber_profile('selfprof-nobody', 'Nobody', '', '', '', ''),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a barber naming an unknown barber is refused');
reset role;
select is((select pg_catalog.to_jsonb(b) from public.barbers b where b.id = 'selfprof-a'),
  pg_catalog.current_setting('selfprof.row_a')::jsonb, 'no refused call changed the barber''s row');

-- ---- staff_update_barber_profile: a barber's own save -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000002')::text, true);
select is(public.staff_update_barber_profile('selfprof-a', '  Ny Anna  ', ' @anna.cuts ', '@anna_tt',
    ' Svensk bio ', 'English bio '),
  '{"ok": true,
    "profile": {"name": "Ny Anna", "ig": "anna.cuts", "tiktok": "anna_tt", "bio_sv": " Svensk bio ",
                "bio_en": "English bio "}}'::jsonb,
  'a barber saves their own profile: name and handles trimmed, one leading @ removed, bios as given');
reset role;
select is((select pg_catalog.jsonb_build_object('name', b.name, 'ig', b.ig, 'tiktok', b.tiktok,
    'bio_sv', b.bio_sv, 'bio_en', b.bio_en)
  from public.barbers b where b.id = 'selfprof-a'),
  '{"name": "Ny Anna", "ig": "anna.cuts", "tiktok": "anna_tt", "bio_sv": " Svensk bio ",
    "bio_en": "English bio "}'::jsonb,
  'the row holds exactly the values the function returned');
select is((select pg_catalog.to_jsonb(b) - array['name', 'ig', 'tiktok', 'bio_sv', 'bio_en']
  from public.barbers b where b.id = 'selfprof-a'),
  pg_catalog.current_setting('selfprof.row_a')::jsonb
    - array['name', 'ig', 'tiktok', 'bio_sv', 'bio_en'],
  'every other column of the row, id, active, sort_order and both roles included, is unchanged');
select is((select pg_catalog.to_jsonb(b) from public.barbers b where b.id = 'selfprof-b'),
  pg_catalog.current_setting('selfprof.row_b')::jsonb, 'another barber''s row is untouched');
select is((select pg_catalog.array_agg(
    l.actor_id::text || '|' || l.action || '|' || pg_catalog.array_to_string(l.changed_columns, ','))
  from public.admin_audit_log l
  where l.target_table = 'barbers' and l.target_id = 'selfprof-a'),
  array['83000000-0000-4000-8000-000000000002|update|bio_en,bio_sv,ig,name,tiktok'],
  'the admin log records the save under the barber, with the changed columns, tiktok included');

set local role authenticated;
select is(public.staff_update_barber_profile('selfprof-a',
    ' ' || pg_catalog.repeat('n', 60) || ' ', pg_catalog.repeat('i', 30),
    '@' || pg_catalog.repeat('t', 30), pg_catalog.repeat('s', 600), '') -> 'profile',
  pg_catalog.jsonb_build_object('name', pg_catalog.repeat('n', 60), 'ig', pg_catalog.repeat('i', 30),
    'tiktok', pg_catalog.repeat('t', 30), 'bio_sv', pg_catalog.repeat('s', 600), 'bio_en', ''),
  'the longest values are accepted: a 60-character name, 30-character handles, a 600-character bio');
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '@self_tt', 'Bio A',
    'Bio A en'),
  '{"ok": true,
    "profile": {"name": "Self A", "ig": "self_a", "tiktok": "self_tt", "bio_sv": "Bio A",
                "bio_en": "Bio A en"}}'::jsonb,
  'a later save replaces the earlier values');

select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000004')::text, true);
select is(public.staff_update_barber_profile('selfprof-h', 'Self H', 'self_h', '', '', '') ->> 'ok',
  'true', 'a barber hidden from the site can still save their own profile');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000005')::text, true);
select is(public.staff_update_barber_profile('selfprof-d', 'Self D', '', '', '', ''),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a disabled barber account cannot save');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000006')::text, true);
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '', 'Bio A',
    'Bio A en'),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a barber account linked to no barber cannot save');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000007')::text, true);
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '', 'Bio A',
    'Bio A en'),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a disabled owner account cannot save');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000009')::text, true);
select is(public.staff_update_barber_profile('selfprof-a', 'Self A', 'self_a', '', 'Bio A',
    'Bio A en'),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a signed-in user without a staff profile cannot save');

-- ---- staff_update_barber_profile: the owner ---------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000001')::text, true);
select is(public.staff_update_barber_profile('selfprof-b', 'Self B2', '', '@', 'Bio B', 'Bio B en'),
  '{"ok": true,
    "profile": {"name": "Self B2", "ig": "", "tiktok": "", "bio_sv": "Bio B",
                "bio_en": "Bio B en"}}'::jsonb,
  'the owner saves any barber''s profile, and empty handles are allowed');
select is(public.staff_update_barber_profile('selfprof-nobody', 'Nobody', '', '', '', ''),
  '{"ok": false, "error": "not_found"}'::jsonb, 'the owner naming an unknown barber gets not_found');
select is(public.staff_update_barber_profile('selfprof-nobody', '', 'a b', '', null, ''),
  '{"ok": false, "error": "not_found"}'::jsonb,
  'an unknown barber is reported before invalid fields');
reset role;
select is((select pg_catalog.to_jsonb(b) - array['name', 'ig', 'tiktok', 'bio_sv', 'bio_en']
  from public.barbers b where b.id = 'selfprof-b'),
  pg_catalog.current_setting('selfprof.row_b')::jsonb
    - array['name', 'ig', 'tiktok', 'bio_sv', 'bio_en'],
  'the owner''s save changes no other column either');
select is((select l.actor_id::text || '|' || pg_catalog.array_to_string(l.changed_columns, ',')
  from public.admin_audit_log l
  where l.target_table = 'barbers' and l.target_id = 'selfprof-b'),
  '83000000-0000-4000-8000-000000000001|ig,name', 'the owner''s save is recorded under the owner');
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.staff_update_barber_profile('selfprof-a', 'X', '', '', '', '')$$,
  '42501', null, 'anon cannot call the profile save');
reset role;
set local role service_role;
select throws_ok($$select public.staff_update_barber_profile('selfprof-a', 'X', '', '', '', '')$$,
  '42501', null, 'the service role cannot call the profile save');
reset role;

-- ---- staff_set_barber_work_photo_hidden -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000002')::text, true);
select is(public.staff_set_barber_work_photo_hidden('83000000-0000-4000-8000-0000000000a1', true),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a barber cannot hide a picture, not even their own');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000007')::text, true);
select is(public.staff_set_barber_work_photo_hidden('83000000-0000-4000-8000-0000000000a1', true),
  '{"ok": false, "error": "forbidden"}'::jsonb, 'a disabled owner account cannot hide a picture');
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000001')::text, true);
select is(public.staff_set_barber_work_photo_hidden('83000000-0000-4000-8000-0000000000a1', true),
  '{"ok": true}'::jsonb, 'the owner hides a picture');
select is(public.staff_set_barber_work_photo_hidden('83000000-0000-4000-8000-0000000000a2', false),
  '{"ok": true}'::jsonb, 'the owner shows a hidden picture again');
select is(public.staff_set_barber_work_photo_hidden('83000000-0000-4000-8000-0000000000ff', true),
  '{"ok": false, "error": "not_found"}'::jsonb, 'an unknown picture is not_found');
select throws_ok($$select public.staff_set_barber_work_photo_hidden(
    '83000000-0000-4000-8000-0000000000a3', null)$$,
  '23502', null, 'a missing hidden flag is refused');
reset role;
select is((select pg_catalog.array_agg(w.storage_path || ':' || w.hidden::text
    order by w.created_at desc)
  from public.barber_work_photos w where w.barber_id = 'selfprof-a'),
  array['selfprof-a/new.webp:false', 'selfprof-a/mid.webp:false', 'selfprof-a/old.webp:true'],
  'only the owner''s two calls changed a picture');
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.staff_set_barber_work_photo_hidden(
    '83000000-0000-4000-8000-0000000000a1', false)$$,
  '42501', null, 'anon cannot call the hide function');
reset role;

-- ---- internal_add_barber_work_photo and internal_delete_barber_work_photo ---------------------
set local role service_role;
select is(public.internal_add_barber_work_photo('selfprof-b', 'selfprof-a/x.webp'),
  '{"ok": false, "error": "invalid_path"}'::jsonb, 'a path in another barber''s folder is invalid_path');
select is(public.internal_add_barber_work_photo('selfprof-b', 'selfprof-bb/x.webp'),
  '{"ok": false, "error": "invalid_path"}'::jsonb,
  'a folder whose name only starts with the barber id is invalid_path');
select is(public.internal_add_barber_work_photo('selfprof-b', 'selfprof-b.webp'),
  '{"ok": false, "error": "invalid_path"}'::jsonb, 'a path outside any folder is invalid_path');
select is(public.internal_add_barber_work_photo('selfprof-b', null),
  '{"ok": false, "error": "invalid_path"}'::jsonb, 'a missing path is invalid_path');
select is(public.internal_add_barber_work_photo(null, 'selfprof-b/x.webp'),
  '{"ok": false, "error": "invalid_path"}'::jsonb, 'a missing barber id is invalid_path');
select is(public.internal_add_barber_work_photo('selfprof-b',
    'selfprof-b/' || pg_catalog.repeat('p', 290)),
  '{"ok": false, "error": "invalid_path"}'::jsonb, 'a path over 300 characters is invalid_path');
select is(public.internal_add_barber_work_photo('selfprof-nobody', 'selfprof-nobody/x.webp'),
  '{"ok": false, "error": "not_found"}'::jsonb, 'an unknown barber is not_found');
select set_config('selfprof.added',
  public.internal_add_barber_work_photo('selfprof-b', 'selfprof-b/one.webp')::text, true);
select is(pg_catalog.current_setting('selfprof.added')::jsonb ->> 'ok', 'true',
  'the service role adds a picture in the barber''s folder');
reset role;
select is((select w.barber_id || '|' || w.storage_path || '|' || w.hidden::text
    || '|' || (w.created_at = pg_catalog.now())::text
  from public.barber_work_photos w
  where w.id = (pg_catalog.current_setting('selfprof.added')::jsonb ->> 'id')::uuid),
  'selfprof-b|selfprof-b/one.webp|false|true',
  'the returned id names the new row: shown on the site and stamped with the time of the insert');
select is((select pg_catalog.count(*)::int from public.barber_work_photos w
  where w.barber_id in ('selfprof-b', 'selfprof-nobody')), 1, 'no refused call stored a row');
update public.barber_work_photos set created_at = pg_catalog.now() - interval '1 minute'
where storage_path = 'selfprof-b/one.webp';
set local role service_role;
select is(public.internal_add_barber_work_photo('selfprof-b', 'selfprof-b/two.webp') ->> 'ok', 'true',
  'the service role adds a second picture');
select throws_ok($$select public.internal_add_barber_work_photo('selfprof-b', 'selfprof-b/two.webp')$$,
  '23505', null, 'the same path cannot be stored twice');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000001')::text, true);
select is(public.staff_barber_profile('selfprof-b') -> 'work' -> 0 ->> 'path', 'selfprof-b/two.webp',
  'the picture added last is listed first');
reset role;
set local role service_role;
select is(public.internal_delete_barber_work_photo('selfprof-a', 'selfprof-b/two.webp'),
  '{"ok": true}'::jsonb, 'a delete that names another barber answers ok');
select is(public.internal_delete_barber_work_photo('selfprof-b', 'selfprof-b/one.webp'),
  '{"ok": true}'::jsonb, 'the service role deletes a picture');
select is(public.internal_delete_barber_work_photo('selfprof-b', 'selfprof-b/one.webp'),
  '{"ok": true}'::jsonb, 'deleting it again also answers ok');
reset role;
select is((select pg_catalog.array_agg(w.storage_path) from public.barber_work_photos w
  where w.barber_id = 'selfprof-b'),
  array['selfprof-b/two.webp'], 'only the picture named with its own barber was deleted');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000003')::text, true);
select throws_ok($$select public.internal_add_barber_work_photo('selfprof-b',
    'selfprof-b/three.webp')$$, '42501', null, 'a staff session cannot call the internal add');
select throws_ok($$select public.internal_delete_barber_work_photo('selfprof-b',
    'selfprof-b/two.webp')$$, '42501', null, 'a staff session cannot call the internal delete');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.internal_add_barber_work_photo('selfprof-b',
    'selfprof-b/three.webp')$$, '42501', null, 'anon cannot call the internal add');
select throws_ok($$select public.internal_delete_barber_work_photo('selfprof-b',
    'selfprof-b/two.webp')$$, '42501', null, 'anon cannot call the internal delete');
reset role;

-- ---- the CMS document does not see the new column or table ------------------------------------
select set_config('selfprof.cms', pg_catalog.md5(public.internal_cms_document()::text), true);
update public.barbers set tiktok = 'cms_check' where id = 'selfprof-x';
insert into public.barber_work_photos (barber_id, storage_path)
values ('selfprof-x', 'selfprof-x/cms.webp');
select is(pg_catalog.md5(public.internal_cms_document()::text),
  pg_catalog.current_setting('selfprof.cms'),
  'a TikTok handle and a work picture leave the CMS document and its fingerprint unchanged');
select ok(not exists (select 1
  from pg_catalog.jsonb_array_elements(public.internal_cms_document() -> 'barbers') as e(value)
  where e.value ? 'tiktok' or e.value ? 'work'),
  'no barber in the CMS document carries tiktok or work');

-- ---- public_booking_catalog -------------------------------------------------------------------
select is(
  (select pg_catalog.jsonb_build_object(
     'barbers', coalesce((
       select pg_catalog.jsonb_agg(e.value - 'tiktok' - 'work' order by e.n)
       from pg_catalog.jsonb_array_elements(c.value -> 'barbers') with ordinality as e(value, n)
     ), '[]'::jsonb),
     'services', c.value -> 'services')
   from (select public.public_booking_catalog() as value) c),
  (select pg_catalog.jsonb_build_object(
    'barbers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'ig', b.ig,
        'role_sv', b.role_sv,
        'role_en', b.role_en,
        'bio_sv', b.bio_sv,
        'bio_en', b.bio_en,
        'active', b.active,
        'sort_order', b.sort_order,
        'photo_path', p.storage_path
      ) order by b.sort_order, b.name)
      from public.barbers b
      left join public.barber_photos p on p.barber_id = b.id
      where b.active
    ), '[]'::jsonb),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', s.id,
        'barber_id', s.barber_id,
        'name', s.name,
        'price', s.price,
        'duration_min', s.duration_min,
        'active', s.active,
        'sort_order', s.sort_order,
        'available_weekdays', s.available_weekdays
      ) order by s.barber_id, s.sort_order, s.name)
      from public.services s
      join public.barbers b on b.id = s.barber_id and b.active
      where s.active
    ), '[]'::jsonb)
  )),
  'without tiktok and work the catalog is exactly what the baseline definition returns');
select is((select pg_catalog.array_agg(k.key order by k.key collate "C")
  from pg_catalog.jsonb_object_keys(public.public_booking_catalog()) as k(key)),
  array['barbers', 'services'], 'the catalog still has only barbers and services');
select is((select pg_catalog.count(*)::int
  from pg_catalog.jsonb_array_elements(public.public_booking_catalog() -> 'barbers') as e(value)
  where (select pg_catalog.array_agg(k.key order by k.key collate "C")
         from pg_catalog.jsonb_object_keys(e.value) as k(key))
    is distinct from array['active', 'bio_en', 'bio_sv', 'id', 'ig', 'name', 'photo_path',
                           'role_en', 'role_sv', 'sort_order', 'tiktok', 'work']), 0,
  'every barber in the catalog has its ten earlier keys plus tiktok and work, and nothing else');
select is((select e.value - 'tiktok' - 'work'
  from pg_catalog.jsonb_array_elements(public.public_booking_catalog() -> 'barbers') as e(value)
  where e.value ->> 'id' = 'selfprof-a'),
  '{"id": "selfprof-a", "name": "Self A", "ig": "self_a", "role_sv": "Barberare",
    "role_en": "Barber", "bio_sv": "Bio A", "bio_en": "Bio A en", "active": true,
    "sort_order": 950, "photo_path": "selfprof-a/photo.webp"}'::jsonb,
  'a fixture barber keeps every earlier key with its value');
select is((select pg_catalog.jsonb_build_object('tiktok', e.value -> 'tiktok', 'work', e.value -> 'work')
  from pg_catalog.jsonb_array_elements(public.public_booking_catalog() -> 'barbers') as e(value)
  where e.value ->> 'id' = 'selfprof-a'),
  '{"tiktok": "self_tt", "work": ["selfprof-a/new.webp", "selfprof-a/mid.webp"]}'::jsonb,
  'the catalog carries the TikTok handle and the shown work pictures, newest first, without the hidden one');
select is((select e.value -> 'work'
  from pg_catalog.jsonb_array_elements(public.public_booking_catalog() -> 'barbers') as e(value)
  where e.value ->> 'id' = 'selfprof-d'),
  '[]'::jsonb, 'a barber without work pictures has an empty work list');
select is((select pg_catalog.count(*)::int
  from pg_catalog.jsonb_array_elements(public.public_booking_catalog() -> 'barbers') as e(value)
  where e.value ->> 'id' = 'selfprof-h'),
  0, 'a barber hidden from the site is still left out, with their work pictures');
select set_config('selfprof.catalog', public.public_booking_catalog()::text, true);
set local role anon;
select set_config('request.jwt.claims', '', true);
select is(public.public_booking_catalog(), pg_catalog.current_setting('selfprof.catalog')::jsonb,
  'anon gets the same catalog');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '83000000-0000-4000-8000-000000000002')::text, true);
select is(public.public_booking_catalog(), pg_catalog.current_setting('selfprof.catalog')::jsonb,
  'a staff session gets the same catalog');
reset role;
set local role service_role;
select is(public.public_booking_catalog(), pg_catalog.current_setting('selfprof.catalog')::jsonb,
  'the service role gets the same catalog');
reset role;

-- ---- deleting a barber deletes their work pictures --------------------------------------------
select set_config('request.jwt.claims', '', true);
delete from public.barbers where id = 'selfprof-x';
select is((select pg_catalog.count(*)::int from public.barber_work_photos w
  where w.barber_id = 'selfprof-x'), 0, 'deleting a barber deletes their work pictures');
select is((select pg_catalog.count(*)::int from public.barber_work_photos w
  where w.barber_id = 'selfprof-a'), 3, 'the pictures of other barbers stay');

select * from finish();
rollback;
