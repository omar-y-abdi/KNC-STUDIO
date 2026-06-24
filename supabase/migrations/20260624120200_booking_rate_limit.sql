-- Migration 0013 — booking_attempts: per-IP rate-limit ledger (PLAN §3).
--
-- WHY: server-side Turnstile needs a synchronous HTTP siteverify, which a Postgres RPC cannot do, so
-- the booking insert moves behind the `submit-booking` edge function (verify_jwt = false). That gateway
-- enforces coarse IP/phone backstops alongside Turnstile. This table is the IP ledger: one row per
-- accepted attempt, storing a SHA-256 of (ip + IP_SALT) — never the raw IP, so it stays PII-minimal.
-- The edge fn counts recent rows per ip_hash to throttle, then opportunistically prunes old rows.
--
-- Per-PHONE limiting reuses the existing bookings.created_at (no table needed); only the IP ledger is new.

create table public.booking_attempts (
  id         bigserial   primary key,
  ip_hash    text        not null,
  created_at timestamptz not null default pg_catalog.now()
);

-- The only query is "count rows for this ip_hash since T" (and a prune "delete where created_at < T"),
-- so a composite (ip_hash, created_at) index serves both the windowed count and the cleanup scan.
create index booking_attempts_ip_time_idx
  on public.booking_attempts (ip_hash, created_at);

-- RLS enabled with NO policy: anon/authenticated can never see or write this table. It is touched ONLY
-- by the `submit-booking` edge function via the service_role key (service_role bypasses RLS), so no
-- policy is required — and omitting one is the safest default (deny-all for every Data API role).
alter table public.booking_attempts enable row level security;

-- This project runs with auto_expose_new_tables OFF (config.toml), so a new table gets NO Data API
-- grants by default. The edge function reaches this ledger through PostgREST AS service_role, which
-- bypasses RLS but still needs table/sequence GRANTs. Grant ONLY service_role (the server credential),
-- and ONLY the DML the gateway performs: count (SELECT), record (INSERT), prune (DELETE). anon/
-- authenticated get nothing. INSERT into the bigserial id needs USAGE on its sequence.
grant select, insert, delete on table public.booking_attempts to service_role;
grant usage on sequence public.booking_attempts_id_seq  to service_role;

-- ---------------------------------------------------------------------------------------------
-- recent_booking_count_by_phone — the per-phone backstop's counter, kept RPC-gated.
-- ---------------------------------------------------------------------------------------------
-- The bookings table is PII and, by this codebase's invariant (migration 0002), is touched ONLY via
-- SECURITY DEFINER RPCs — even by service_role (it has no direct SELECT grant). The gateway's per-phone
-- limit needs a count of recent bookings for a phone, so we expose exactly that as a definer function:
-- it returns a single integer (no PII leaves the DB) and is granted ONLY to service_role. This keeps
-- the "bookings only via RPC" boundary intact rather than granting the edge fn direct table SELECT.
create or replace function public.recent_booking_count_by_phone(
  p_phone text,
  p_since timestamptz
) returns int
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::int
  from public.bookings b
  where b.phone = p_phone
    and b.created_at >= p_since;
$$;

revoke execute on function public.recent_booking_count_by_phone(text, timestamptz) from public;
grant  execute on function public.recent_booking_count_by_phone(text, timestamptz) to service_role;
