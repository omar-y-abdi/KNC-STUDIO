-- Migration 0004 — admin schema. Source of truth: ADMIN_SPEC.md §1.
-- Adds the admin-panel tables on top of the booking backend (0001..0003). All access is gated
-- by RLS (0005) + SECURITY DEFINER RPCs (0006). FK ordering matters here:
--   barbers           (no deps)
--   profiles          -> auth.users (cascade) + barbers (set null)
--   barber_schedules  -> barbers (cascade)
--   barber_time_off   -> barbers (cascade)
--   about_content     (no deps)
--   gallery_images    (no deps)
--
-- The three helper functions (current_role / is_owner / current_barber_id) read the caller's
-- profile via auth.uid(). They are SECURITY DEFINER + `set search_path = ''` so RLS policies can
-- call them regardless of the caller's own table privileges, and are granted to `authenticated`
-- only (never anon — anon has no profile and needs no role resolution).

-- ---------------------------------------------------------------------------------------------
-- 1.2 barbers — the public roster (migrated from the BARBERS constant). `active=false` hides a
-- barber from the public list WITHOUT deleting history (bookings.barber_id stays plain text, no
-- cascading FK, so a removed barber's past bookings survive).
-- ---------------------------------------------------------------------------------------------
create table public.barbers (
  id         text primary key check (char_length(id) between 1 and 32 and id ~ '^[a-z0-9-]+$'),
  name       text not null check (char_length(name) between 1 and 60),
  ig         text not null default '' check (char_length(ig) <= 60),
  role_sv    text not null default 'Barberare',
  role_en    text not null default 'Barber',
  bio_sv     text not null default '' check (char_length(bio_sv) <= 600),
  bio_en     text not null default '' check (char_length(bio_en) <= 600),
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index barbers_active_idx on public.barbers (sort_order) where active;

-- ---------------------------------------------------------------------------------------------
-- 1.1 profiles — links an auth user to a role (+ optional barber). Managed by the owner (via
-- dashboard or an owner-only RPC); clients never insert/update (no such RLS policy in 0005).
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','barber')),
  barber_id  text references public.barbers(id) on delete set null,  -- null for owner
  created_at timestamptz not null default now()
);
create index profiles_barber_id_idx on public.profiles (barber_id) where barber_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 1.3 barber_schedules — weekly recurring working hours (the layered model). weekday uses the
-- JS getDay() convention (0=Sun..6=Sat) to match the front end and extract(dow ...).
-- ---------------------------------------------------------------------------------------------
create table public.barber_schedules (
  barber_id text not null references public.barbers(id) on delete cascade,
  weekday   smallint not null check (weekday between 0 and 6),  -- 0=Sun..6=Sat (JS getDay)
  working   boolean not null default false,
  start_min smallint not null default 540 check (start_min between 0 and 1440),  -- 09:00 = 540
  end_min   smallint not null default 1080 check (end_min between 0 and 1440),   -- 18:00 = 1080
  primary key (barber_id, weekday),
  constraint sched_time_order check (end_min > start_min)
);

-- ---------------------------------------------------------------------------------------------
-- 1.4 barber_time_off — block specific days/ranges (vacation / day off). Inclusive range; a
-- single day has start_date = end_date.
-- ---------------------------------------------------------------------------------------------
create table public.barber_time_off (
  id         uuid primary key default gen_random_uuid(),
  barber_id  text not null references public.barbers(id) on delete cascade,
  start_date date not null,
  end_date   date not null,   -- inclusive; single day => start_date = end_date
  reason     text not null default '' check (char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  constraint timeoff_order check (end_date >= start_date)
);
create index barber_time_off_idx on public.barber_time_off (barber_id, start_date, end_date);

-- ---------------------------------------------------------------------------------------------
-- 1.5 about_content — editable section copy (bilingual). Keyed by (key, lang). Stylist bios live
-- on `barbers`; the gallery/section titles + intro + headings live here.
-- ---------------------------------------------------------------------------------------------
create table public.about_content (
  key        text not null check (key in ('eyebrow','heading','intro','galleryTitle','cutsTitle','stylistsTitle','reviewsTitle')),
  lang       text not null check (lang in ('sv','en')),
  value      text not null check (char_length(value) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (key, lang)
);

-- ---------------------------------------------------------------------------------------------
-- 1.6 gallery_images — Supabase Storage-backed photos. `storage_path` points into the public
-- `gallery` bucket (created in 0007). With no rows the public site falls back to placeholders.
-- ---------------------------------------------------------------------------------------------
create table public.gallery_images (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('salon','cuts')),
  storage_path text not null check (char_length(storage_path) between 1 and 200),
  alt          text not null default '',
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index gallery_images_kind_idx on public.gallery_images (kind, sort_order);

-- ---------------------------------------------------------------------------------------------
-- Helper functions for RLS. SECURITY DEFINER + `set search_path = ''` (every object schema-
-- qualified). They resolve the caller's profile from auth.uid(); a caller with no profile (anon,
-- or an authenticated user the owner has not linked) yields null / false. STABLE: depends only on
-- the current auth context + the profiles row, no writes.
-- ---------------------------------------------------------------------------------------------

-- current_role() — the caller's profiles.role, or null. NOTE: `current_role` is a SQL reserved
-- token; this function is therefore ALWAYS called schema-qualified (public.current_role()).
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- is_owner() — true iff the caller's role is 'owner'.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'owner' from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- current_barber_id() — the caller's profiles.barber_id (null for an owner or an unlinked user).
create or replace function public.current_barber_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.barber_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Least privilege: CREATE FUNCTION grants EXECUTE to PUBLIC. Strip it, then grant ONLY to
-- `authenticated`. RLS policies that call these run with the caller's privileges, so the
-- authenticated grant is what lets owner/barber policy checks resolve (without it they 42501).
-- anon never gets these (it has no profile and every anon-facing SELECT policy is helper-free).
revoke execute on function public.current_role()       from public;
revoke execute on function public.is_owner()           from public;
revoke execute on function public.current_barber_id()  from public;
grant  execute on function public.current_role()       to authenticated;
grant  execute on function public.is_owner()           to authenticated;
grant  execute on function public.current_barber_id()  to authenticated;
