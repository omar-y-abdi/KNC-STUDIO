-- Migration 0018 — barber login accounts: profiles.must_change_password column + RPC to clear it.
--
-- WHY: the owner-creates-barber-account flow (T5b edge function) sets must_change_password = true
-- via service_role when provisioning a new barber login. The barber then logs in, sees the
-- forced-change gate, picks a new password, and calls set_own_password_changed() to clear the
-- flag. Subsequent logins skip the gate entirely.
--
-- READ access: the barber already reads their own profiles row through the `profiles_select_self`
-- policy established in migration 0005 (admin_rls). No new SELECT policy is added here — that
-- existing policy covers must_change_password automatically as it selects the whole row.
--
-- WRITE access design:
--   SET path  — edge function (service_role, T5b) sets must_change_password = true on account
--               creation. service_role bypasses RLS; no new policy needed.
--   CLEAR path — this SECURITY DEFINER RPC; the barber calls it after choosing a new password.
--               No self-UPDATE RLS policy is added — the RPC is the sole, audited write path.

-- ===============================================================================================
-- 1. Add must_change_password flag to profiles.
-- ===============================================================================================
alter table public.profiles
  add column must_change_password boolean not null default false;

-- ===============================================================================================
-- 2. set_own_password_changed() — SECURITY DEFINER RPC to clear the flag for the calling user.
--
-- The SECURITY DEFINER context runs as the function owner, bypassing RLS. The WHERE clause
-- `id = (select auth.uid())` restricts the UPDATE to the caller's own row only — no other row
-- can be touched. `set search_path = ''` + full schema-qualification follows the project
-- convention established in migration 0004 (admin_schema helper functions).
-- ===============================================================================================
create or replace function public.set_own_password_changed()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles
  set    must_change_password = false
  where  id = (select auth.uid());
$$;

-- Least privilege: revoke EXECUTE from PUBLIC (Postgres default) and grant only to `authenticated`.
-- anon has no profiles row and must never call this; owner/service_role paths don't need it.
revoke execute on function public.set_own_password_changed() from public;
grant  execute on function public.set_own_password_changed() to authenticated;
