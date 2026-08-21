-- CONTRACT phase. Run only after protected Edge Functions and switched frontend are deployed and
-- verified. Final step removes temporary direct browser access; gateway service-role access remains.

revoke execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.lookup_booking(text) from public, anon, authenticated;
revoke execute on function public.list_bookings_by_phone(text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_review(text, integer, text)
  from public, anon, authenticated;
