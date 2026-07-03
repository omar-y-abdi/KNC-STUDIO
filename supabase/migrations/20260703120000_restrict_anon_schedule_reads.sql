-- Migration 0020 — restrict anonymous read on the barber schedule tables to authenticated only.
--
-- WHY: `barber_schedules`, `barber_slot_blocks`, and `barber_time_off` each had a `*_select_all`
-- policy that granted SELECT to `{anon, authenticated}` with `USING (true)`. That exposed, to any
-- UNAUTHENTICATED caller holding the public anon key:
--   - barber_schedules   → every barber's exact working hours
--   - barber_slot_blocks  → every blocked/booked slot (i.e. the salon's live occupancy)
--   - barber_time_off     → every barber's time off
-- A competitor could scrape the whole operation's booking density. None of this is needed publicly.
--
-- WHY IT IS SAFE TO REMOVE anon (proven against the live catalog, not assumed):
--   - The PUBLIC booking site never reads these tables directly. It computes availability through the
--     `available_slots` / `taken_slots` RPCs, which are SECURITY DEFINER functions OWNED BY postgres.
--   - These tables are also owned by postgres and have `relforcerowsecurity = false`, so a definer
--     function running as postgres BYPASSES RLS on them entirely. Dropping the anon SELECT policy
--     therefore cannot change what the RPCs return — the public flow is unaffected.
--   - The admin panel reads these tables as an AUTHENTICATED owner/barber; the recreated policy still
--     admits `authenticated` with `USING (true)`, so the panel is unchanged.
--
-- Net effect: anon loses direct SELECT; the RPC path and the authenticated admin panel are untouched.
-- (INSERT/UPDATE/DELETE were already authenticated-only and are left exactly as they are.)

-- barber_schedules
drop policy if exists schedules_select_all on public.barber_schedules;
create policy schedules_select_all on public.barber_schedules
  for select to authenticated using (true);

-- barber_slot_blocks
drop policy if exists slot_blocks_select_all on public.barber_slot_blocks;
create policy slot_blocks_select_all on public.barber_slot_blocks
  for select to authenticated using (true);

-- barber_time_off
drop policy if exists timeoff_select_all on public.barber_time_off;
create policy timeoff_select_all on public.barber_time_off
  for select to authenticated using (true);
