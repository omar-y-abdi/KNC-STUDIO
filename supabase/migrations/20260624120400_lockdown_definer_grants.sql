-- Least-privilege hardening — closes a post-deploy advisor finding (0028/0029).
--
-- Three SECURITY DEFINER functions are meant to be callable ONLY by the service_role (the edge
-- functions). The original migrations revoked EXECUTE only `from public`, but Supabase grants the
-- `anon` and `authenticated` roles EXECUTE via DEFAULT PRIVILEGES — a SEPARATE grant that
-- `revoke ... from public` does not remove. So those roles were left able to call:
--   - create_booking               — `authenticated` could bypass the submit-booking gateway
--   - booking_confirmation_details — `anon` could read booking PII (phone/name) by booking uuid
--   - recent_booking_count_by_phone — `anon` could enumerate the per-phone booking count
--
-- None are called by the browser or the admin UI — verified: the client only POSTs to the
-- submit-booking edge function, and the edge functions call these three as service_role (which keeps
-- its EXECUTE grant from the earlier migrations). Revoke the residual anon/authenticated grants so
-- the three are service_role-only, matching the intended design. `revoke` is idempotent.

revoke execute on function public.create_booking(
  text, text, text, int, int, timestamptz, text, text, text
) from authenticated;

revoke execute on function public.booking_confirmation_details(uuid) from anon, authenticated;

revoke execute on function public.recent_booking_count_by_phone(text, timestamptz) from anon, authenticated;
