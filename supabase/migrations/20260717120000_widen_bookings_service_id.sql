-- Widen bookings.service_id to hold a services.id UUID.
--
-- WHY: the public booking menu switched to UUID-keyed per-barber services (migration
-- 20260715100000_services.sql + commit b4afd2d). The booking flow now threads services.id — a 36-char
-- UUID — as service_id into create_booking (supabaseServices.ts -> supabaseBooking.ts -> submit-booking
-- edge fn -> create_booking, which inserts p_service_id verbatim). But bookings.service_id has carried
-- an inline `check (char_length(service_id) between 1 and 16)` since init (20260623152736). A 36-char
-- UUID fails that CHECK (SQLSTATE 23514) -> create_booking's check_violation handler returns
-- {ok:false,error:'invalid'} -> the site shows "Något gick fel. Försök igen." EVERY online booking
-- broke the moment the UUID-keyed menu shipped. Reproduced directly against prod: UUID -> 'invalid',
-- a short id -> ok.
--
-- FIX: widen the length bound. NOT a foreign key to services(id): admin "Reservera kund"
-- (admin_create_booking, 20260716110000) inserts the literal service_id='manual', and historical rows
-- carry short slugs ('hs','hc') — an FK would reject all of those. Keep the floor at 1 so every existing
-- row still validates; raise the ceiling to 64 (UUID is 36; headroom for any future id scheme so this
-- never silently re-breaks).

-- The original check is declared inline on the column, so Postgres auto-named it. Drop it by its
-- discovered name (robust to the generated identifier) before re-adding the widened check.
do $$
declare
  v_name text;
begin
  -- service_id appears in exactly one bookings CHECK (there is no FK on it), so matching the column
  -- name alone pins that constraint — and stays correct regardless of how the length expression is
  -- deparsed across Postgres versions.
  select conname
    into v_name
    from pg_constraint
   where conrelid = 'public.bookings'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) ilike '%service_id%';
  if v_name is not null then
    execute pg_catalog.format('alter table public.bookings drop constraint %I', v_name);
  end if;
end
$$;

alter table public.bookings
  add constraint bookings_service_id_check check (char_length(service_id) between 1 and 64);
