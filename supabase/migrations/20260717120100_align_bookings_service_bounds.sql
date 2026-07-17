-- Align bookings duration/price CHECKs with the services menu bounds — closes the same failure class
-- as 20260717120000 (service_id).
--
-- WHY: a service is configurable up to 600 min and up to 100000 kr (services_duration_range /
-- services_price_range, 20260715100000_services.sql:18-19). But the bookings insert capped duration at
-- 480 and required price STRICTLY below 100000 (inline checks, init 20260623152736.sql:19-20). So a
-- barber who offers a >480-min OR exactly-100000-kr service gets a bookable menu row whose booking
-- insert fails the CHECK (SQLSTATE 23514) → create_booking returns 'invalid' → the site shows
-- "Något gick fel." — the identical symptom the service_id widening fixed. The menu must never offer
-- something the write path rejects.
--
-- FIX: widen the booking bounds to cover everything a valid service can produce. Pure widening — the
-- old bounds (duration ≤480, price <100000) are a strict subset of the new (≤600, ≤100000), so every
-- existing row still validates. Drop each inline-auto-named check by discovered name (robust), re-add.

do $$
declare
  v_dur   text;
  v_price text;
begin
  select conname into v_dur
    from pg_constraint
   where conrelid = 'public.bookings'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%duration_min%';
  select conname into v_price
    from pg_constraint
   where conrelid = 'public.bookings'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%price%';
  if v_dur is not null then
    execute pg_catalog.format('alter table public.bookings drop constraint %I', v_dur);
  end if;
  if v_price is not null then
    execute pg_catalog.format('alter table public.bookings drop constraint %I', v_price);
  end if;
end
$$;

alter table public.bookings
  add constraint bookings_duration_min_check check (duration_min > 0 and duration_min <= 600);
alter table public.bookings
  add constraint bookings_price_check check (price >= 0 and price <= 100000);
