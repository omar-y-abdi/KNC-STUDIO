-- Migration 0009 — bookings.barber_id references the dynamic barbers roster.
--
-- The original init migration (0001) declared `barber_id text not null check (barber_id in
-- ('hassan','victor','salman'))`. That hardcoded CHECK would REJECT a booking for any barber the
-- owner adds through the admin — silently breaking the "add barbers" feature end to end. Replace the
-- CHECK with a FOREIGN KEY to public.barbers so the roster table is the single source of truth.
--
-- ON DELETE RESTRICT preserves booking history: a barber with bookings cannot be hard-deleted; the
-- admin "removes" a barber by setting active=false (soft delete), which hides them from the public
-- roster while their past bookings remain intact + attributable.

-- Drop the hardcoded CHECK by definition (its auto-generated name is not guaranteed across PG
-- versions, so find it rather than assume `bookings_barber_id_check`).
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.bookings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%barber_id%'
    and pg_get_constraintdef(oid) ilike '%hassan%';
  if v_name is not null then
    execute format('alter table public.bookings drop constraint %I', v_name);
  end if;
end $$;

alter table public.bookings
  add constraint bookings_barber_id_fkey
  foreign key (barber_id) references public.barbers(id) on delete restrict;
