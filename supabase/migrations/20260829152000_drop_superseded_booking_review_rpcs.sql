-- Drop superseded booking/review RPCs and retired email trigger function.
-- Default DROP FUNCTION behavior is RESTRICT (no CASCADE), so deployment fails
-- if any unexpected dependency appears.

drop function public.cancel_booking(uuid, text);
drop function public.create_review(text, integer, text);
drop function public.recent_booking_count_by_phone(text, timestamptz);
drop function public.queue_booking_confirmation();
