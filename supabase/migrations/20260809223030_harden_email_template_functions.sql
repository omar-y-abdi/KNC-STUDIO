-- Supabase's project default privileges explicitly grant newly-created public functions to API
-- roles. Revoke those role-specific grants as well as PUBLIC; both helpers are server-only.
revoke execute on function public.email_template_for_delivery(text, text)
from public, anon, authenticated;

revoke execute on function public.consume_auth_email_send(text, text)
from public, anon, authenticated;

grant execute on function public.email_template_for_delivery(text, text) to service_role;
grant execute on function public.consume_auth_email_send(text, text) to service_role;
