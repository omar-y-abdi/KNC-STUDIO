-- EXPAND phase for public booking gateway rollout.
--
-- Keep currently deployed direct-RPC clients working while the protected Edge Function and switched
-- frontend deploy. This compatibility window must be short: run the contract migration only after
-- gateway smoke checks pass. service_role remains the gateway's database identity throughout.

grant execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) to anon, service_role;
grant execute on function public.lookup_booking(text) to anon, service_role;
grant execute on function public.list_bookings_by_phone(text) to anon, service_role;
grant execute on function public.cancel_booking(uuid, text) to anon, service_role;
grant execute on function public.create_review(text, integer, text) to anon, service_role;

revoke execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) from public, authenticated;
revoke execute on function public.lookup_booking(text) from public, authenticated;
revoke execute on function public.list_bookings_by_phone(text) from public, authenticated;
revoke execute on function public.cancel_booking(uuid, text) from public, authenticated;
revoke execute on function public.create_review(text, integer, text) from public, authenticated;
