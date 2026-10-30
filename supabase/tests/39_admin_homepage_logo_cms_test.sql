begin;
select plan(18);

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
select hasnt_function('public', 'internal_replace_homepage_logo', array['text','text'],
  'the legacy homepage logo replacement RPC is retired');
select hasnt_function('public', 'internal_remove_homepage_logo', array['text'],
  'the legacy homepage logo removal RPC is retired');
select ok(
  has_function_privilege('service_role', 'public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)', 'execute'),
  'the CMS publisher remains the service-role content writer'
);
select ok(
  not has_function_privilege('authenticated', 'public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)', 'execute'),
  'browser sessions cannot bypass the CMS gateway publication boundary'
);
insert into auth.users (id, email)
values ('39000000-0000-4000-8000-000000000001', 'owner@homepage-logo.test');
insert into public.profiles (id, role, barber_id)
values ('39000000-0000-4000-8000-000000000001', 'owner', null);
select set_config('test.contacts_before',(select jsonb_object_agg(key,value)::text
 from public.site_settings
 where key = any (array['business_phone_display', 'business_phone_tel', 'business_maps_href'])),true);
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
  (select jsonb_object_agg(key,value) from public.site_settings
   where key = any (array['business_phone_display', 'business_phone_tel', 'business_maps_href'])),
  current_setting('test.contacts_before')::jsonb,
  'owner REST cannot bypass CMS publication to change phone and maps contacts'
);
update public.site_settings
set value = 'logo/223e4567-e89b-42d3-a456-426614174000.webp'
where key = 'homepage_logo_path';
select is(
  (select value from public.site_settings where key = 'homepage_logo_path'),
  '', 'owner browser cannot bypass CMS publication to replace the logo'
);
reset role;
select is(
  (select value from public.site_settings where key = 'business_phone_tel'),
  current_setting('test.contacts_before')::jsonb->>'business_phone_tel',
  'the denied REST update preserves the public phone link'
);
select is(
  (select value from public.site_settings where key = 'business_maps_href'),
  current_setting('test.contacts_before')::jsonb->>'business_maps_href',
  'the denied REST update preserves the public maps link'
);
-- Seed the canonical public read model as the publisher does, without restoring a retired writer.
update public.site_settings
set value = 'logo/123e4567-e89b-42d3-a456-426614174000.webp'
where key = 'homepage_logo_path';
select is(
  (select value from public.site_settings where key = 'homepage_logo_path'),
  'logo/123e4567-e89b-42d3-a456-426614174000.webp',
  'public chrome now references processed logo path'
);

insert into storage.objects (bucket_id, name, created_at)
values ('gallery', 'logo/123e4567-e89b-42d3-a456-426614174000.webp', pg_catalog.now() - interval '31 minutes');
-- Remove the upload-trigger registry pin so this assertion specifically proves the public logo
-- setting protects the object, rather than succeeding because every registered asset is retained.
delete from public.cms_assets
where bucket = 'gallery' and path = 'logo/123e4567-e89b-42d3-a456-426614174000.webp';
select is(
  public.queue_orphaned_storage_objects(),
  0, 'reconciler preserves Storage object while homepage setting references it'
);

update public.site_settings set value = '' where key = 'homepage_logo_path';
select is(
  (select value from public.site_settings where key = 'homepage_logo_path'),
  '', 'the canonical public read model still supports the vector fallback'
);
-- Existing logo cleanup intents use the generic queue, independently of the retired producer.
set local role service_role;
select set_config('test.logo_job', public.internal_queue_storage_deletion(
  'gallery', 'logo/123e4567-e89b-42d3-a456-426614174000.webp'
)::text, true);
reset role;
select is(
  (select payload->>'path' from public.external_action_jobs
   where id = current_setting('test.logo_job')::uuid),
  'logo/123e4567-e89b-42d3-a456-426614174000.webp',
  'the retained queue preserves the exact logo cleanup target'
);
select is(
  (select count(*)::integer from public.external_action_jobs
   where action_type = 'storage_object_delete'
     and dedupe_key = 'gallery:logo/123e4567-e89b-42d3-a456-426614174000.webp'),
  1, 'logo cleanup retains one durable Storage action'
);
set local role service_role;
select set_config('test.logo_claim', public.claim_external_action(
  current_setting('test.logo_job')::uuid
)::text, true);
select is(current_setting('test.logo_claim')::jsonb ->> 'path',
  'logo/123e4567-e89b-42d3-a456-426614174000.webp',
  'a queued legacy logo deletion remains claimable');
select is(public.complete_external_action(
  current_setting('test.logo_job')::uuid,
  (current_setting('test.logo_claim')::jsonb ->> 'dispatch_token')::uuid
), true, 'a queued legacy logo deletion still completes through the fenced worker');
reset role;

select * from finish();
rollback;
