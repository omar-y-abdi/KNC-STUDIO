-- These exact functions are superseded by access-scoped customer actions, the atomic booking
-- gateway, and durable booking-email delivery. No current source, trigger, or cron caller remains.
-- Keep the default dependency behavior explicit: an unexpected dependency must block deployment.
drop function public.cancel_booking(uuid, text) restrict;
drop function public.create_review(text, integer, text) restrict;
drop function public.recent_booking_count_by_phone(text, timestamp with time zone) restrict;
drop function public.queue_booking_confirmation() restrict;
