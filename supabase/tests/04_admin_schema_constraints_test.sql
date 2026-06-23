-- pgTAP — schema presence + every CHECK / FK constraint on the admin tables (ADMIN_SPEC §1).
-- Runs as the table owner (RLS bypassed) so we exercise the raw column/table constraints.
-- check_violation = 23514, foreign_key_violation = 23503, unique/pk_violation = 23505.
-- The 3 seed barbers (hassan/victor/salman) exist (from seed.sql), so FK references resolve.

begin;
select plan(38);

-- ---- objects exist --------------------------------------------------------------------------
select has_table('public', 'barbers',          'table public.barbers exists');
select has_table('public', 'profiles',         'table public.profiles exists');
select has_table('public', 'barber_schedules', 'table public.barber_schedules exists');
select has_table('public', 'barber_time_off',  'table public.barber_time_off exists');
select has_table('public', 'about_content',    'table public.about_content exists');
select has_table('public', 'gallery_images',   'table public.gallery_images exists');

select has_function('public', 'current_role',      'function public.current_role() exists');
select has_function('public', 'is_owner',          'function public.is_owner() exists');
select has_function('public', 'current_barber_id', 'function public.current_barber_id() exists');
select has_function('public', 'admin_cancel_booking', array['uuid'],            'admin_cancel_booking(uuid) exists');
select has_function('public', 'available_slots',      array['text','date','integer'], 'available_slots(text,date,int) exists');

-- ---- barbers --------------------------------------------------------------------------------
select lives_ok(
  $$insert into public.barbers (id, name) values ('test-barber','Test Barber')$$,
  'valid barber inserts (defaults fill ig/roles/bios/active/sort)'
);
select throws_ok(
  $$insert into public.barbers (id, name) values ('Bad_Id','X')$$,
  '23514', null, 'barber id with uppercase/underscore rejected (id ~ ^[a-z0-9-]+$)'
);
select throws_ok(
  $$insert into public.barbers (id, name) values ('','X')$$,
  '23514', null, 'empty barber id rejected (char_length >= 1)'
);
select throws_ok(
  $$insert into public.barbers (id, name) values ('ok','')$$,
  '23514', null, 'empty barber name rejected'
);
select throws_ok(
  $$insert into public.barbers (id, name) values ('hassan','Dup')$$,
  '23505', null, 'duplicate barber id rejected (primary key)'
);

-- ---- profiles -------------------------------------------------------------------------------
-- Need a real auth.users row to satisfy the FK.
select lives_ok(
  $$insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000001','p1@knc.local')$$,
  'seed auth user for profile tests'
);
select lives_ok(
  $$insert into public.profiles (id, role, barber_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','barber','victor')$$,
  'valid barber profile inserts'
);
select throws_ok(
  $$insert into public.profiles (id, role) values ('aaaaaaaa-0000-0000-0000-000000000001','admin')$$,
  '23514', null, 'profile role ''admin'' rejected (role in owner/barber)'
);
select throws_ok(
  $$insert into public.profiles (id, role)
    values ('bbbbbbbb-0000-0000-0000-000000000009','owner')$$,
  '23503', null, 'profile with a non-existent auth user id rejected (FK to auth.users)'
);
select throws_ok(
  $$insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000002','p2@knc.local');
    insert into public.profiles (id, role, barber_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002','barber','ghost')$$,
  '23503', null, 'profile.barber_id referencing a missing barber rejected (FK to barbers)'
);

-- ---- barber_schedules -----------------------------------------------------------------------
select lives_ok(
  $$insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
    values ('test-barber', 1, true, 540, 1080)$$,
  'valid schedule row inserts'
);
select throws_ok(
  $$insert into public.barber_schedules (barber_id, weekday) values ('test-barber', 7)$$,
  '23514', null, 'weekday 7 rejected (between 0 and 6)'
);
select throws_ok(
  $$insert into public.barber_schedules (barber_id, weekday, start_min, end_min)
    values ('test-barber', 2, 1080, 540)$$,
  '23514', null, 'end_min <= start_min rejected (sched_time_order)'
);
select throws_ok(
  $$insert into public.barber_schedules (barber_id, weekday, start_min, end_min)
    values ('test-barber', 3, 0, 2000)$$,
  '23514', null, 'end_min > 1440 rejected (between 0 and 1440)'
);
select throws_ok(
  $$insert into public.barber_schedules (barber_id, weekday) values ('nobody', 1)$$,
  '23503', null, 'schedule for a missing barber rejected (FK)'
);
select throws_ok(
  $$insert into public.barber_schedules (barber_id, weekday) values ('test-barber', 1)$$,
  '23505', null, 'duplicate (barber_id, weekday) rejected (primary key)'
);

-- ---- barber_time_off ------------------------------------------------------------------------
select lives_ok(
  $$insert into public.barber_time_off (barber_id, start_date, end_date, reason)
    values ('test-barber','2099-07-01','2099-07-14','Semester')$$,
  'valid time-off range inserts'
);
select lives_ok(
  $$insert into public.barber_time_off (barber_id, start_date, end_date)
    values ('test-barber','2099-08-01','2099-08-01')$$,
  'single-day time off (start = end) inserts'
);
select throws_ok(
  $$insert into public.barber_time_off (barber_id, start_date, end_date)
    values ('test-barber','2099-09-10','2099-09-01')$$,
  '23514', null, 'end_date < start_date rejected (timeoff_order)'
);
select throws_ok(
  $$insert into public.barber_time_off (barber_id, start_date, end_date)
    values ('nobody','2099-09-01','2099-09-02')$$,
  '23503', null, 'time off for a missing barber rejected (FK)'
);

-- ---- about_content --------------------------------------------------------------------------
-- Every valid (key, lang) is already seeded (14 rows), so prove the PK conflict against a seed
-- row, then prove a fresh insert works after clearing it (all inside this rolled-back tx).
select throws_ok(
  $$insert into public.about_content (key, lang, value) values ('eyebrow','sv','dup')$$,
  '23505', null, 'duplicate (key, lang) rejected (primary key)'
);
select lives_ok(
  $$delete from public.about_content where key='eyebrow' and lang='sv';
    insert into public.about_content (key, lang, value) values ('eyebrow','sv','OM OSS 2')$$,
  'valid about_content row inserts (after removing the seed row for this key/lang)'
);
select throws_ok(
  $$insert into public.about_content (key, lang, value) values ('banana','sv','x')$$,
  '23514', null, 'unknown about key rejected'
);
select throws_ok(
  $$insert into public.about_content (key, lang, value) values ('heading','de','x')$$,
  '23514', null, 'lang ''de'' rejected (lang in sv/en)'
);

-- ---- gallery_images -------------------------------------------------------------------------
select lives_ok(
  $$insert into public.gallery_images (kind, storage_path, alt, sort_order)
    values ('salon','gallery/salon/abc.jpg','Salongen',0)$$,
  'valid gallery image inserts'
);
select throws_ok(
  $$insert into public.gallery_images (kind, storage_path) values ('lobby','gallery/x.jpg')$$,
  '23514', null, 'gallery kind ''lobby'' rejected (kind in salon/cuts)'
);
select throws_ok(
  $$insert into public.gallery_images (kind, storage_path) values ('cuts','')$$,
  '23514', null, 'empty storage_path rejected (char_length >= 1)'
);

select * from finish();
rollback;
