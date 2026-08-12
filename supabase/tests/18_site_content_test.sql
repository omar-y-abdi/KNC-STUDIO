-- pgTAP — site_content + site_settings (Task 2 §2, migration 0018).
-- Verifies the tables exist with expected constraints and shipped CMS defaults. RLS mirrors the
-- audited about_content posture (anon read / owner write) and is covered structurally by 05_admin_rls.

begin;
select plan(6);

select is((select count(*)::int from public.site_content), 2, 'site_content has bilingual confirmation defaults');
select is((select count(*)::int from public.site_settings), 13, 'site_settings has shipped business and SEO defaults');

-- site_content: (key,lang) PK + lang check + value length.
insert into public.site_content (key, lang, value) values ('test_kicker', 'sv', 'BARBERSHOP · GÖTEBORG');
select is(
  (select value from public.site_content where key = 'test_kicker' and lang = 'sv'),
  'BARBERSHOP · GÖTEBORG', 'a homepage string round-trips');
select throws_ok(
  $$ insert into public.site_content (key, lang, value) values ('kicker', 'de', 'x') $$,
  '23514', null, 'an unsupported lang is rejected');

-- site_settings: single-row-per-key.
insert into public.site_settings (key, value) values ('test_homepage_scale', 'lg');
select is(
  (select value from public.site_settings where key = 'test_homepage_scale'), 'lg',
  'a setting round-trips');
select throws_ok(
  $$ insert into public.site_settings (key, value) values ('test_homepage_scale', 'md') $$,
  '23505', null, 'a duplicate settings key is rejected (primary key)');

select * from finish();
rollback;
