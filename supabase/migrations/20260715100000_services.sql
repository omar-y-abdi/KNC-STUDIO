-- services — the per-barber, flat service catalog (Task 2 §1).
--
-- Each barber owns their own menu (name, price, duration). The public booking flow shows the CHOSEN
-- barber's active services (no weekday branching — a flat catalog); a "discount" is simply its own
-- row (e.g. "Studentklippning" at a lower price). The owner manages any barber's menu; a barber
-- manages only their own. Enforced by RLS (mirrors the barbers / barber_slot_blocks posture), not the UI.

create table public.services (
  id           uuid primary key default gen_random_uuid(),
  barber_id    text not null references public.barbers(id) on delete cascade,
  name         text not null,
  price        int  not null,
  duration_min int  not null,
  active       boolean not null default true,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  constraint services_name_len       check (char_length(name) between 1 and 80),
  constraint services_price_range    check (price >= 0 and price <= 100000),
  constraint services_duration_range check (duration_min between 5 and 600)
);

-- The public booking menu queries by (barber_id, active) ordered by sort_order.
create index services_barber_active_sort on public.services (barber_id, active, sort_order);

-- =============================================================================================
-- RLS — anon reads ACTIVE (the public menu); owner reads/writes ALL; a barber reads/writes OWN.
-- =============================================================================================
alter table public.services enable row level security;
grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;

-- Public + authenticated: only ACTIVE services are visible (the booking menu; helper-free).
create policy services_select_active on public.services
  for select to anon, authenticated using (active = true);
-- Owner additionally sees ALL services (incl. inactive) for management.
create policy services_select_owner on public.services
  for select to authenticated using (public.is_owner());
-- A barber additionally sees ALL of their OWN services (incl. inactive).
create policy services_select_own on public.services
  for select to authenticated using (barber_id = public.current_barber_id());

-- Owner writes any row; a barber writes ONLY rows scoped to their own barber_id.
create policy services_insert_owner on public.services
  for insert to authenticated with check (public.is_owner());
create policy services_insert_own on public.services
  for insert to authenticated with check (barber_id = public.current_barber_id());
create policy services_update_owner on public.services
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy services_update_own on public.services
  for update to authenticated
  using (barber_id = public.current_barber_id())
  with check (barber_id = public.current_barber_id());
create policy services_delete_owner on public.services
  for delete to authenticated using (public.is_owner());
create policy services_delete_own on public.services
  for delete to authenticated using (barber_id = public.current_barber_id());

-- The per-barber starter menu is seeded in supabase/seed.sql (which runs AFTER migrations, once the
-- barbers themselves are seeded). A newly owner-created barber simply starts with an empty menu and
-- adds their own services in the panel.
