-- Retire unused compatibility helpers (OPS-6). The active Calendar worker uses the conditional
-- record/exact-identity cleanup RPCs; CMS callers use internal_cms_document_media_placements.
-- No policy or runtime caller needs current_role(), so remove browser execution without changing
-- its SECURITY DEFINER lookup semantics or the grants on the active authorization helpers.
begin;

drop function public.calendar_deletion_context(uuid) restrict;
drop function public.calendar_forget_event(uuid) restrict;
drop function public.calendar_record_event(uuid, text, text) restrict;
drop function public.internal_cms_document_media(jsonb) restrict;

revoke execute on function public.current_role() from public, anon, authenticated;

commit;
