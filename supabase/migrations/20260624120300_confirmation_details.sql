-- Migration 0014 — booking_confirmation_details: the send-confirmation SMS read, kept RPC-gated.
--
-- WHY (deviation from PLAN's "3 migration files"): the SMS bridge (PLAN §4) must re-read the booking
-- by id (M3 — recipient + message content are DB-authoritative, never the webhook body). The original
-- send-confirmation skeleton did this with a DIRECT `from('bookings').select(...)` as service_role — but
-- this project runs auto_expose_new_tables OFF and never granted service_role SELECT on bookings (it is
-- PII, gated behind SECURITY DEFINER RPCs per migration 0002). So that direct read silently returns
-- nothing (recipient_not_found) — a latent bug. Rather than broaden service_role's direct reach to the
-- PII table, we expose EXACTLY the confirmation fields through a definer RPC, granted only to
-- service_role. This keeps the "bookings touched only via RPCs" boundary intact for the edge functions.

-- Returns a single jsonb object with the fields send-confirmation needs to build the SMS (phone +
-- localized message), including the barber's display NAME joined from the roster. NULL row -> the id
-- does not exist; the caller treats that (and a null phone) as recipient_not_found.
create or replace function public.booking_confirmation_details(
  p_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'phone',         b.phone,
    'customer_name', b.customer_name,
    'start_at',      b.start_at,
    'service_name',  b.service_name,
    'barber_id',     b.barber_id,
    -- COALESCE is a SQL keyword/expression (not a pg_catalog function), so it is NOT schema-qualified;
    -- it resolves under `search_path = ''` regardless. Falls back to the id if the roster row is gone.
    'barber_name',   coalesce(ba.name, b.barber_id),
    'lang',          b.lang
  )
  from public.bookings b
  left join public.barbers ba on ba.id = b.barber_id
  where b.id = p_id;
$$;

-- Least privilege: strip PUBLIC, grant only service_role (the send-confirmation webhook credential).
revoke execute on function public.booking_confirmation_details(uuid) from public;
grant  execute on function public.booking_confirmation_details(uuid) to service_role;
