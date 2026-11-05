-- LIFE-15 / OPS-5: site, About, email-copy and content-setting writes use the CMS validation/CAS.
-- Keep every existing SELECT policy/grant and the SECURITY DEFINER/service-role capabilities.
-- Cancellation enforcement is operational state, deliberately absent from internal_cms_document.
begin;

revoke insert, update, delete on table public.site_content, public.about_content, public.email_templates
  from authenticated;

drop policy site_content_insert_owner on public.site_content;
drop policy site_content_update_owner on public.site_content;
drop policy site_content_delete_owner on public.site_content;
drop policy about_insert_owner on public.about_content;
drop policy about_update_owner on public.about_content;
drop policy about_delete_owner on public.about_content;
drop policy email_templates_insert_owner on public.email_templates;
drop policy email_templates_update_owner on public.email_templates;
drop policy email_templates_delete_owner on public.email_templates;

alter policy site_settings_insert_owner on public.site_settings
  with check (public.is_owner() and key = 'cancellation_policy_hours');
alter policy site_settings_update_owner on public.site_settings
  using (public.is_owner() and key = 'cancellation_policy_hours')
  with check (public.is_owner() and key = 'cancellation_policy_hours');
alter policy site_settings_delete_owner on public.site_settings
  using (public.is_owner() and key = 'cancellation_policy_hours');

-- Direct owner writes accepted any site_content key, and publication is now the only writer. Read
-- only the keys publication owns (SITE_KEYS in shared/cms.ts), as settings already do: a retired
-- key neither blocks Studio nor reaches the public site, and the next publication deletes its rows.
create or replace function public.internal_cms_document() returns jsonb
language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'schema',1,
 'site',coalesce((select jsonb_object_agg(key,langs order by key) from (select key,jsonb_object_agg(lang,value order by lang) langs from public.site_content
   where key=any(array['kicker','hours','yourDetails','summary','fBarber','fWhen','fService','fTotal','name','namePh','phone','phonePh','policy','bookedTitle','confirmSent','addToCal'])
   group by key) s),'{}'::jsonb),
 'about',coalesce((select jsonb_object_agg(key,langs order by key) from (select key,jsonb_object_agg(lang,value order by lang) langs from public.about_content group by key) s),'{}'::jsonb),
 'settings',coalesce((select jsonb_object_agg(key,value order by key) from public.site_settings where key=any(array['homepage_scale','about_scale','homepage_logo_path','homepage_logo_scale','homepage_logo_style','business_name','business_legal_name','business_org_number','business_email','business_phone_display','business_phone_tel','business_street','business_postal_code','business_city','business_maps_href','seo_title_sv','seo_description_sv','seo_title_en','seo_description_en'])),'{}'::jsonb),
 'barbers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'ig',ig,'role_sv',role_sv,'role_en',role_en,'bio_sv',bio_sv,'bio_en',bio_en,'sort_order',sort_order) order by id) from public.barbers),'[]'::jsonb),
 'photos',coalesce((select jsonb_object_agg(barber_id,storage_path order by barber_id) from public.barber_photos),'{}'::jsonb),
 'gallery',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'storage_path',storage_path,'alt',alt,'sort_order',sort_order) order by id) from public.gallery_images),'[]'::jsonb),
 'emails',coalesce((select jsonb_agg((to_jsonb(t)-'updated_at') || jsonb_build_object('design',d.design) order by t.template,t.lang) from public.email_templates t left join public.cms_email_designs d using(template,lang)),'[]'::jsonb),
 'presentation',(select presentation from public.cms_site where id)
) $$;
revoke all on function public.internal_cms_document() from public,anon,authenticated;
grant execute on function public.internal_cms_document() to service_role;

commit;
