-- Migration 0005 — admin RLS. Source of truth: ADMIN_SPEC.md §2 + §8.
--
-- Security model recap: the browser holds only the PUBLIC anon key OR an authenticated Auth
-- session. RLS + the helper functions (0004) + SECURITY DEFINER RPCs (0006) are the ENTIRE
-- boundary. There is NO service_role in the client.
--
-- GRANT vs POLICY: a table-level GRANT is what makes Postgres evaluate RLS for the anon /
-- authenticated Data-API roles at all (Supabase no longer auto-grants on new tables); the POLICY
-- then restricts the rows/commands. So each table gets the minimal GRANTs plus row policies.
--
-- Design rules (per §2 + §8):
--   * anon-facing SELECT policies are HELPER-FREE (active=true / using(true)) — anon has no
--     profile and must never need is_owner()/current_barber_id().
--   * every owner/barber WRITE policy is scoped `to authenticated` and gated by a helper.
--   * a barber can only ever touch rows where barber_id = current_barber_id(); the owner
--     (is_owner()) is unrestricted on the admin tables.

-- =============================================================================================
-- barbers — PUBLIC reads active rows; barbers (authenticated) read all active; owner full write.
-- =============================================================================================
alter table public.barbers enable row level security;
grant select on public.barbers to anon, authenticated;
grant insert, update, delete on public.barbers to authenticated;

-- Public + authenticated roster: only active barbers are visible (helper-free).
create policy barbers_select_active on public.barbers
  for select to anon, authenticated using (active = true);

-- Owner additionally sees ALL barbers (incl. inactive) for management.
create policy barbers_select_owner on public.barbers
  for select to authenticated using (public.is_owner());

-- Owner-only writes.
create policy barbers_insert_owner on public.barbers
  for insert to authenticated with check (public.is_owner());
create policy barbers_update_owner on public.barbers
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy barbers_delete_owner on public.barbers
  for delete to authenticated using (public.is_owner());

-- =============================================================================================
-- profiles — a user reads OWN row; owner reads all. No client insert/update (owner/dashboard).
-- =============================================================================================
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
-- NB: no anon grant -> anon cannot reach profiles at all (PII-adjacent role mapping).

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_owner on public.profiles
  for select to authenticated using (public.is_owner());

-- =============================================================================================
-- barber_schedules — anon reads all (public availability needs it, no PII); owner full write;
-- barber writes ONLY own rows.
-- =============================================================================================
alter table public.barber_schedules enable row level security;
grant select on public.barber_schedules to anon, authenticated;
grant insert, update, delete on public.barber_schedules to authenticated;

create policy schedules_select_all on public.barber_schedules
  for select to anon, authenticated using (true);

-- Owner: any barber's schedule.
create policy schedules_insert_owner on public.barber_schedules
  for insert to authenticated with check (public.is_owner());
create policy schedules_update_owner on public.barber_schedules
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy schedules_delete_owner on public.barber_schedules
  for delete to authenticated using (public.is_owner());

-- Barber: only their own rows (barber_id = current_barber_id()).
create policy schedules_insert_own on public.barber_schedules
  for insert to authenticated with check (barber_id = public.current_barber_id());
create policy schedules_update_own on public.barber_schedules
  for update to authenticated
  using (barber_id = public.current_barber_id())
  with check (barber_id = public.current_barber_id());
create policy schedules_delete_own on public.barber_schedules
  for delete to authenticated using (barber_id = public.current_barber_id());

-- =============================================================================================
-- barber_time_off — anon reads (availability needs the dates, no PII); owner full write; barber
-- writes own.
-- =============================================================================================
alter table public.barber_time_off enable row level security;
grant select on public.barber_time_off to anon, authenticated;
grant insert, update, delete on public.barber_time_off to authenticated;

create policy timeoff_select_all on public.barber_time_off
  for select to anon, authenticated using (true);

create policy timeoff_insert_owner on public.barber_time_off
  for insert to authenticated with check (public.is_owner());
create policy timeoff_update_owner on public.barber_time_off
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy timeoff_delete_owner on public.barber_time_off
  for delete to authenticated using (public.is_owner());

create policy timeoff_insert_own on public.barber_time_off
  for insert to authenticated with check (barber_id = public.current_barber_id());
create policy timeoff_update_own on public.barber_time_off
  for update to authenticated
  using (barber_id = public.current_barber_id())
  with check (barber_id = public.current_barber_id());
create policy timeoff_delete_own on public.barber_time_off
  for delete to authenticated using (barber_id = public.current_barber_id());

-- =============================================================================================
-- about_content — anon reads all (public copy); owner writes.
-- =============================================================================================
alter table public.about_content enable row level security;
grant select on public.about_content to anon, authenticated;
grant insert, update, delete on public.about_content to authenticated;

create policy about_select_all on public.about_content
  for select to anon, authenticated using (true);
create policy about_insert_owner on public.about_content
  for insert to authenticated with check (public.is_owner());
create policy about_update_owner on public.about_content
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy about_delete_owner on public.about_content
  for delete to authenticated using (public.is_owner());

-- =============================================================================================
-- gallery_images — anon reads all (public gallery rows); owner writes.
-- =============================================================================================
alter table public.gallery_images enable row level security;
grant select on public.gallery_images to anon, authenticated;
grant insert, update, delete on public.gallery_images to authenticated;

create policy gallery_select_all on public.gallery_images
  for select to anon, authenticated using (true);
create policy gallery_insert_owner on public.gallery_images
  for insert to authenticated with check (public.is_owner());
create policy gallery_update_owner on public.gallery_images
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy gallery_delete_owner on public.gallery_images
  for delete to authenticated using (public.is_owner());

-- =============================================================================================
-- bookings (existing) — ADD admin READS. anon still has NO grant + no policy (0002 revoked all
-- from anon; the contact-proving RPCs are SECURITY DEFINER and unaffected). Here we grant SELECT
-- to `authenticated` and add owner/barber read policies. Cancellation goes through the new
-- admin_cancel_booking RPC (0006), so NO update/insert/delete grant is given to authenticated —
-- the RPC (SECURITY DEFINER) is the single, audited write path.
-- =============================================================================================
grant select on public.bookings to authenticated;

-- Owner sees every booking.
create policy bookings_select_owner on public.bookings
  for select to authenticated using (public.is_owner());

-- Barber sees ONLY their own bookings.
create policy bookings_select_own on public.bookings
  for select to authenticated using (barber_id = public.current_barber_id());
