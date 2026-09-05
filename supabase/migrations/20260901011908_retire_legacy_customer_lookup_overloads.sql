-- The protected public-booking-actions gateway now uses exchange/rotation and the permanent-token
-- functions. These old phone lookup/listing and challenge-creation overloads have no current source
-- callers or live dependent objects. RESTRICT makes an unexpected dependency fail loudly.
drop function public.lookup_booking(text) restrict;
drop function public.list_bookings_by_phone(text) restrict;
drop function public.create_customer_booking_access_request(text, text, text) restrict;
drop function public.create_customer_booking_access_request(text, text, text, text, text) restrict;
