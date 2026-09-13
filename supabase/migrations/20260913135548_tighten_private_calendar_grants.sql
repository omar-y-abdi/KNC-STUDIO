-- Browser roles already have no Calendar RLS policies. Remove redundant table privileges too;
-- the authenticated status/OAuth RPCs and server-only synchronization remain authoritative.
revoke all on table public.barber_calendar_tokens, public.calendar_event_map
  from public, anon, authenticated;

-- Anonymous visitors use the public booking gateway, never the staff booking RPC.
revoke execute on function public.admin_create_booking(text,timestamptz,integer,text,numeric,text,text)
  from public, anon;
