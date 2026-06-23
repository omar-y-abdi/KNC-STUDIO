-- Migration 0002 — RLS. Source of truth: BACKEND_SPEC.md §3.
--
-- Security model: the site is static + anonymous; the browser holds the PUBLIC anon key. RLS +
-- SECURITY DEFINER RPCs are the ENTIRE security boundary.
--   bookings: PII. NO anon policy at all -> anon cannot select/insert/update/delete directly.
--             All access is via the SECURITY DEFINER RPCs (0003), which run as owner and bypass RLS.
--   reviews:  anon may READ published rows only; all writes go through the create_review RPC.

alter table public.bookings enable row level security;
alter table public.reviews  enable row level security;

-- bookings: defense in depth — explicitly strip every direct privilege from anon. There is no
-- policy, so RLS already denies anon, but revoking the GRANTs means anon cannot even reach RLS
-- evaluation for DML. (The RPCs are SECURITY DEFINER and run as the table owner, so they are
-- unaffected by this revoke.)
revoke all on public.bookings from anon;

-- reviews: anyone may READ published reviews. The policy restricts the ROWS; the table-level
-- GRANT below is what makes RLS evaluation happen at all for the anon/authenticated Data API
-- roles (Supabase no longer auto-grants on new tables). No insert/update/delete GRANT is given,
-- so writes are impossible except through the create_review SECURITY DEFINER RPC.
grant select on public.reviews to anon, authenticated;

create policy reviews_select_published on public.reviews
  for select to anon, authenticated using (published = true);
