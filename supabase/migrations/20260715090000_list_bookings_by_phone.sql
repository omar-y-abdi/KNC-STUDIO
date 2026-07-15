-- list_bookings_by_phone — the "Mina bokningar" (My appointments) customer self-service RPC.
--
-- Returns EVERY confirmed booking (past + future) for a proven phone number, so the public site can
-- show a returning customer their full appointment history and let them self-cancel upcoming ones.
--
-- This DELIBERATELY enumerates a phone's bookings — unlike `lookup_booking`, which returns only the
-- single next appointment and never enumerates (a privacy guard). That guard is intentionally NOT
-- applied here: it is a product decision (owner-approved) to make the site convenience-first and
-- web-only for booking tracking — there are no SMS/email confirmations, so the site itself is how a
-- customer sees their bookings. The phone is the only key; nothing is exposed beyond the fields the
-- customer themselves supplied at booking (barber, service, price, time).
--
-- SECURITY DEFINER + empty search_path (runs as the function owner, bypassing RLS the same way
-- lookup_booking / cancel_booking do) so the anon browser role can read via the public anon key
-- without a direct SELECT grant on `bookings`. Cancelled rows are excluded. The response is a single
-- jsonb object `{ ok: true, bookings: [...] }`; an unknown phone yields `bookings: []` and the client
-- treats that as "not found".

create or replace function public.list_bookings_by_phone(
  p_contact text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id',           b.id,
        'barber_id',    b.barber_id,
        'service_name', b.service_name,
        'price',        b.price,
        'duration_min', b.duration_min,
        'start_at',     b.start_at
      )
      order by b.start_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = p_contact;

  return pg_catalog.jsonb_build_object('ok', true, 'bookings', v_rows);
end;
$$;

-- Mirror the lookup_booking / cancel_booking grant posture: strip the implicit PUBLIC execute, then
-- expose to the anon (public browser) role only. `authenticated` (admin/barber) does not need it —
-- the admin panel reads bookings through RLS, not this RPC.
revoke execute on function public.list_bookings_by_phone(text) from public;
grant  execute on function public.list_bookings_by_phone(text) to anon;
