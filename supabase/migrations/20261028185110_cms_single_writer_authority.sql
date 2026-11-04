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

commit;
