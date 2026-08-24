-- pgTAP — site_content + site_settings (Task 2 §2, migration 0018).
-- Verifies the tables exist with expected constraints and shipped CMS defaults. RLS mirrors the
-- audited about_content posture (anon read / owner write) and is covered structurally by 05_admin_rls.

begin;
select plan(11);

select is((select count(*)::int from public.site_content), 2, 'site_content has bilingual confirmation defaults');
select is((select count(*)::int from public.site_settings), 16, 'site_settings has shipped business, SEO, and logo defaults');

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
insert into public.site_settings (key, value) values ('test_unrecognized_setting', '  value  ');
select is(
  (select value from public.site_settings where key = 'test_unrecognized_setting'), 'value',
  'unknown settings retain prior trim-and-accept normalizer behavior'
);
select throws_ok(
  $$ insert into public.site_settings (key, value) values ('test_homepage_scale', 'md') $$,
  '23505', null, 'a duplicate settings key is rejected (primary key)');

update public.site_settings set value = 'BOOKING@EXAMPLE.TEST' where key = 'business_email';
select is(
  (select value from public.site_settings where key = 'business_email'),
  'booking@example.test',
  'business email is normalized at the database write boundary'
);
update public.site_settings set value = '41134' where key = 'business_postal_code';
select is(
  (select value from public.site_settings where key = 'business_postal_code'),
  '411 34',
  'postal code is normalized at the database write boundary'
);
select throws_ok(
  $$ update public.site_settings set value = 'http://maps.example.test' where key = 'business_maps_href' $$,
  '22023', null, 'business maps URL must use HTTPS for website and email links'
);
select throws_ok(
  $$ update public.site_settings set value = '0' where key = 'cancellation_policy_hours' $$,
  '22023', null, 'cancellation policy must remain within the enforced business range'
);

select * from finish();
rollback;
