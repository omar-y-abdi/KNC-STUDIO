-- Migration 0033 — calendar_sync: per-barber Google Calendar OAuth push.
--
-- A barber connects their Google account in "Mina bokningar" (calendar-oauth-start / -callback edge
-- functions). Their bookings are then pushed as events into their Google Calendar in near-real-time by
-- the calendar-sync edge function (fired by a bookings INSERT/UPDATE/DELETE Database Webhook). The
-- Google Calendar app (iOS + Android) delivers the notification — Apple Calendar has no push API, so an
-- iPhone barber uses the Google Calendar app too.
--
-- SECURITY MODEL (mirrors the rest of this schema — PII/credentials are touched ONLY via definer RPCs):
--   * barber_calendar_tokens holds the Google refresh_token, a CREDENTIAL. RLS is enabled with NO
--     anon/authenticated policies, so the browser can NEVER read it — not even the owning barber. Only
--     service_role (the edge functions, RLS-exempt) reaches it, and only through the definer RPCs below.
--     A barber learns their connection STATE (a boolean + email, never the token) via
--     calendar_connection_status().
--   * calendar_event_map (booking_id -> google_event_id) is likewise service_role-only. booking_id is a
--     plain uuid (NOT an FK): a bookings hard-DELETE must NOT cascade the mapping away before the sync
--     function has read it to delete the matching Google event. The barber_id FK cascades on barber
--     delete (local cleanup only).
--   * The connect flow binds the token to the AUTHENTICATED caller's barber id (current_barber_id() in
--     the start function), never a client-supplied id.

-- --- Tables --------------------------------------------------------------------------------------

create table public.barber_calendar_tokens (
  barber_id        text primary key references public.barbers(id) on delete cascade,
  refresh_token    text not null,
  google_email     text,
  calendar_id      text not null default 'primary',
  connected_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_sync_at     timestamptz,
  last_sync_error  text
);
alter table public.barber_calendar_tokens enable row level security;
-- No policies => anon/authenticated have ZERO access (service_role bypasses RLS). The token never
-- leaves the server.

create table public.calendar_event_map (
  booking_id       uuid primary key,
  barber_id        text not null references public.barbers(id) on delete cascade,
  google_event_id  text not null,
  created_at       timestamptz not null default now()
);
alter table public.calendar_event_map enable row level security;
create index calendar_event_map_barber_idx on public.calendar_event_map (barber_id);
-- No policies => service_role-only.

-- --- RPCs: sync data sources (service_role only) --------------------------------------------------

-- Everything the sync function needs for an INSERT/UPDATE of one booking: the DB-authoritative booking
-- fields, the target barber's push credentials (null when the barber has not connected -> caller
-- no-ops), and any already-mapped Google event id (present -> patch, absent -> insert). A null row
-- (booking gone) tells the caller there is nothing to sync from here (deletes go via the fn below).
create or replace function public.calendar_sync_source(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'barber_id',       b.barber_id,
    'service_name',    b.service_name,
    'customer_name',   b.customer_name,
    'phone',           b.phone,
    'start_at',        b.start_at,
    'end_at',          b.end_at,
    'status',          b.status,
    'refresh_token',   t.refresh_token,
    'calendar_id',     t.calendar_id,
    'google_event_id', m.google_event_id
  )
  from public.bookings b
  left join public.barber_calendar_tokens t on t.barber_id = b.barber_id
  left join public.calendar_event_map m on m.booking_id = b.id
  where b.id = p_booking_id;
$$;

-- For a DELETE (the booking row is already gone): the mapped Google event id + the barber's
-- credentials, so the sync function can delete the event from Google, then forget the mapping.
create or replace function public.calendar_deletion_context(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'google_event_id', m.google_event_id,
    'refresh_token',   t.refresh_token,
    'calendar_id',     t.calendar_id
  )
  from public.calendar_event_map m
  join public.barber_calendar_tokens t on t.barber_id = m.barber_id
  where m.booking_id = p_booking_id;
$$;

-- The barber's push credentials + ALL their confirmed bookings (past + future) + any already-mapped
-- event, for the one-shot backfill right after a fresh connect.
create or replace function public.calendar_backfill_source(p_barber_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'refresh_token', t.refresh_token,
    'calendar_id',   t.calendar_id,
    'bookings', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',              b.id,
        'service_name',    b.service_name,
        'customer_name',   b.customer_name,
        'phone',           b.phone,
        'start_at',        b.start_at,
        'end_at',          b.end_at,
        'google_event_id', m.google_event_id
      ) order by b.start_at)
      from public.bookings b
      left join public.calendar_event_map m on m.booking_id = b.id
      where b.barber_id = p_barber_id and b.status = 'confirmed'
    ), '[]'::jsonb)
  )
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id;
$$;

-- --- RPCs: sync bookkeeping (service_role only) --------------------------------------------------

-- Upsert the booking -> event mapping and mark the barber's sync healthy (clears last error).
create or replace function public.calendar_record_event(
  p_booking_id uuid, p_barber_id text, p_google_event_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.calendar_event_map (booking_id, barber_id, google_event_id)
  values (p_booking_id, p_barber_id, p_google_event_id)
  on conflict (booking_id) do update set google_event_id = excluded.google_event_id;
  update public.barber_calendar_tokens
    set last_sync_at = pg_catalog.now(), last_sync_error = null
    where barber_id = p_barber_id;
end;
$$;

-- Drop a booking -> event mapping (after the Google event is deleted).
create or replace function public.calendar_forget_event(p_booking_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.calendar_event_map where booking_id = p_booking_id;
$$;

-- Record a sync failure against the barber (observability; surfaced read-only in the panel).
create or replace function public.calendar_record_error(p_barber_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.barber_calendar_tokens
    set last_sync_at = pg_catalog.now(), last_sync_error = p_error
    where barber_id = p_barber_id;
$$;

-- --- RPCs: token lifecycle (service_role only) ---------------------------------------------------

-- Upsert the barber's Google credentials (called by the OAuth callback after code exchange).
create or replace function public.calendar_store_token(
  p_barber_id text, p_refresh_token text, p_google_email text, p_calendar_id text default 'primary'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.barber_calendar_tokens
    (barber_id, refresh_token, google_email, calendar_id, connected_at, updated_at)
  values
    (p_barber_id, p_refresh_token, p_google_email, coalesce(p_calendar_id, 'primary'),
     pg_catalog.now(), pg_catalog.now())
  on conflict (barber_id) do update
    set refresh_token   = excluded.refresh_token,
        google_email    = excluded.google_email,
        calendar_id     = excluded.calendar_id,
        updated_at      = pg_catalog.now(),
        last_sync_error = null;
end;
$$;

-- Disconnect: return the refresh_token (so the caller can revoke it at Google), then remove ONLY the
-- token row. The event_map is intentionally KEPT: the pushed events stay in the barber's calendar
-- (they are real bookings), and keeping the booking->event mapping means a later reconnect with the
-- same Google account resumes WITHOUT re-inserting duplicates (backfill skips already-mapped
-- bookings). The map is non-sensitive (no credential); only the token is the credential and it is
-- deleted here. Barber deletion still cascades the map away via its barber_id FK.
create or replace function public.calendar_delete_token(p_barber_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select refresh_token into v_token
    from public.barber_calendar_tokens where barber_id = p_barber_id;
  delete from public.barber_calendar_tokens where barber_id = p_barber_id;
  return v_token;
end;
$$;

-- --- RPC: connection status (authenticated; the caller's OWN state only) --------------------------

-- The signed-in barber's connection state — a boolean + email + last-sync info. NEVER the token. An
-- owner (current_barber_id() null) always reads connected:false (they connect no personal calendar).
create or replace function public.calendar_connection_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'connected',       (t.barber_id is not null),
    'google_email',    t.google_email,
    'last_sync_at',    t.last_sync_at,
    'last_sync_error', t.last_sync_error
  )
  from (select public.current_barber_id() as bid) me
  left join public.barber_calendar_tokens t on t.barber_id = me.bid;
$$;

-- --- Grants: least privilege ---------------------------------------------------------------------
-- CREATE FUNCTION grants EXECUTE to PUBLIC. Strip it everywhere, then grant the sync/token RPCs to
-- service_role ONLY (the edge functions' credential) and the status RPC to authenticated ONLY.

revoke execute on function public.calendar_sync_source(uuid)                 from public;
revoke execute on function public.calendar_deletion_context(uuid)            from public;
revoke execute on function public.calendar_backfill_source(text)             from public;
revoke execute on function public.calendar_record_event(uuid, text, text)    from public;
revoke execute on function public.calendar_forget_event(uuid)                from public;
revoke execute on function public.calendar_record_error(text, text)          from public;
revoke execute on function public.calendar_store_token(text, text, text, text) from public;
revoke execute on function public.calendar_delete_token(text)                from public;
revoke execute on function public.calendar_connection_status()               from public;

grant execute on function public.calendar_sync_source(uuid)                 to service_role;
grant execute on function public.calendar_deletion_context(uuid)            to service_role;
grant execute on function public.calendar_backfill_source(text)             to service_role;
grant execute on function public.calendar_record_event(uuid, text, text)    to service_role;
grant execute on function public.calendar_forget_event(uuid)                to service_role;
grant execute on function public.calendar_record_error(text, text)          to service_role;
grant execute on function public.calendar_store_token(text, text, text, text) to service_role;
grant execute on function public.calendar_delete_token(text)                to service_role;
grant execute on function public.calendar_connection_status()               to authenticated;
