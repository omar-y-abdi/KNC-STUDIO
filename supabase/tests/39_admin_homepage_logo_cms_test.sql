begin;
select plan(17);

select is(
  (select value from public.site_settings where key = 'homepage_logo_path'),
  '', 'homepage logo path starts on shipped vector fallback'
);
select is(
  (select value from public.site_settings where key = 'homepage_logo_scale'),
  'md', 'homepage logo scale starts at faithful default'
);
select is(
  (select value from public.site_settings where key = 'homepage_logo_style'),
  'classic', 'homepage logo style starts at faithful default'
);
select ok(
  has_function_privilege('service_role', 'public.internal_replace_homepage_logo(text,text)', 'execute'),
  'service role can atomically replace homepage logo metadata'
);
select ok(
  not has_function_privilege('authenticated', 'public.internal_replace_homepage_logo(text,text)', 'execute'),
  'authenticated browser cannot bypass upload gateway replacement RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.internal_remove_homepage_logo(text)', 'execute'),
  'authenticated browser cannot bypass upload gateway deletion RPC'
);
insert into auth.users (id, email)
values ('39000000-0000-4000-8000-000000000001', 'owner@homepage-logo.test');
insert into public.profiles (id, role, barber_id)
values ('39000000-0000-4000-8000-000000000001', 'owner', null);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  pg_catalog.json_build_object('sub', '39000000-0000-4000-8000-000000000001')::text,
  true
);
update public.site_settings
set value = ''
where key = any (array['business_phone_display', 'business_phone_tel', 'business_maps_href']);
select is(
  (select count(*)::integer from public.site_settings
   where key = any (array['business_phone_display', 'business_phone_tel', 'business_maps_href'])
     and value = ''),
  3, 'owner CMS may remove phone and maps contacts'
);
update public.site_settings
set value = 'logo/223e4567-e89b-42d3-a456-426614174000.webp'
where key = 'homepage_logo_path';
select is(
  (select value from public.site_settings where key = 'homepage_logo_path'),
  '', 'owner browser cannot bypass logo gateway storage lifecycle'
);
reset role;
select is(
  (select value from public.site_settings where key = 'business_phone_tel'),
  '', 'blank phone link persists as an omitted contact method'
);
select is(
  (select value from public.site_settings where key = 'business_maps_href'),
  '', 'blank maps link persists as an omitted contact method'
);
set local role service_role;
select is(
  public.internal_replace_homepage_logo(
    'salon/not-a-logo.webp', 'logo/123e4567-e89b-42d3-a456-426614174000.webp'
  ) ->> 'error',
  'invalid', 'replacement refuses arbitrary client-provided old-object paths'
);
select is(
  public.internal_remove_homepage_logo('salon/not-a-logo.webp') ->> 'error',
  'invalid', 'removal refuses arbitrary client-provided object paths'
);
reset role;

set local role service_role;
select set_config(
  'test.logo_replace',
  public.internal_replace_homepage_logo(
    '', 'logo/123e4567-e89b-42d3-a456-426614174000.webp'
  )::text,
  true
);
reset role;
select is(
  current_setting('test.logo_replace')::jsonb ->> 'ok',
  'true', 'replacement compares expected path and atomically updates the setting'
);
select is(
  (select value from public.site_settings where key = 'homepage_logo_path'),
  'logo/123e4567-e89b-42d3-a456-426614174000.webp',
  'public chrome now references processed logo path'
);

insert into storage.objects (bucket_id, name, created_at)
values ('gallery', 'logo/123e4567-e89b-42d3-a456-426614174000.webp', pg_catalog.now() - interval '31 minutes');
select is(
  public.queue_orphaned_storage_objects(),
  0, 'reconciler preserves Storage object while homepage setting references it'
);

set local role service_role;
select set_config(
  'test.logo_remove',
  public.internal_remove_homepage_logo('logo/123e4567-e89b-42d3-a456-426614174000.webp')::text,
  true
);
reset role;
select is(
  current_setting('test.logo_remove')::jsonb ->> 'path',
  'logo/123e4567-e89b-42d3-a456-426614174000.webp',
  'removal returns exact durable Storage cleanup target'
);
select is(
  (select count(*)::integer from public.external_action_jobs
   where action_type = 'storage_object_delete'
     and dedupe_key = 'gallery:logo/123e4567-e89b-42d3-a456-426614174000.webp'),
  1, 'removal queues one durable Storage cleanup action'
);

select * from finish();
rollback;
