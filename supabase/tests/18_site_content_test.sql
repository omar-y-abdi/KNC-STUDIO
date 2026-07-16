-- pgTAP — site_content + site_settings (Task 2 §2, migration 0018).
-- Verifies the tables exist with the expected constraints and default-empty behavior. RLS mirrors the
-- audited about_content posture (anon read / owner write) and is covered structurally by 05_admin_rls.

begin;
select plan(6);

-- Both tables start empty (no seed) — the public site falls back to i18n + 1.0× scale.
select is((select count(*)::int from public.site_content), 0, 'site_content starts empty');
select is((select count(*)::int from public.site_settings), 0, 'site_settings starts empty');

-- site_content: (key,lang) PK + lang check + value length.
insert into public.site_content (key, lang, value) values ('kicker', 'sv', 'BARBERSHOP · GÖTEBORG');
select is(
  (select value from public.site_content where key = 'kicker' and lang = 'sv'),
  'BARBERSHOP · GÖTEBORG', 'a homepage string round-trips');
select throws_ok(
  $$ insert into public.site_content (key, lang, value) values ('kicker', 'de', 'x') $$,
  '23514', null, 'an unsupported lang is rejected');

-- site_settings: single-row-per-key.
insert into public.site_settings (key, value) values ('homepage_scale', 'lg');
select is(
  (select value from public.site_settings where key = 'homepage_scale'), 'lg',
  'a setting round-trips');
select throws_ok(
  $$ insert into public.site_settings (key, value) values ('homepage_scale', 'md') $$,
  '23505', null, 'a duplicate settings key is rejected (primary key)');

select * from finish();
rollback;
