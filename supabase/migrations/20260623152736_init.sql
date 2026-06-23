-- Migration 0001 — init: schema, constraints, double-booking guarantee, indexes.
-- Source of truth: BACKEND_SPEC.md §2. All money is integer SEK; all times timestamptz.
-- Salon timezone Europe/Stockholm (stored as instants; tz math happens in the app/RPC layer).

-- btree_gist lets a GiST EXCLUDE constraint mix an equality column (barber_id) with a range
-- overlap column (tstzrange) — the engine of the no-double-booking guarantee below.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------------------------
-- bookings — holds PII (name, phone, email). NEVER directly readable/writable by anon; every
-- access goes through the contact-proving SECURITY DEFINER RPCs (see 0003_functions.sql). RLS is
-- enabled with NO anon policy in 0002_rls.sql.
-- ---------------------------------------------------------------------------------------------
create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  barber_id     text not null check (barber_id in ('hassan','victor','salman')),
  service_id    text not null check (char_length(service_id) between 1 and 16),
  service_name  text not null check (char_length(service_name) between 1 and 80),
  price         integer not null check (price >= 0 and price < 100000),
  duration_min  integer not null check (duration_min > 0 and duration_min <= 480),
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  method        text not null check (method in ('sms','email')),
  phone         text check (phone is null or phone ~ '^07[0-9]{8}$'),
  email         text check (email is null or (char_length(email) between 3 and 254 and position('@' in email) > 1)),
  lang          text not null check (lang in ('sv','en')),
  status        text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  constraint bookings_time_order check (end_at > start_at),
  constraint bookings_contact_matches_method check (
    (method = 'sms'   and phone is not null) or
    (method = 'email' and email is not null)
  ),
  constraint bookings_cancel_consistency check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  -- THE double-booking guarantee: no two CONFIRMED bookings for the same barber may overlap in
  -- time. Cancelled rows are excluded from the index (WHERE), so cancelling frees the slot.
  constraint bookings_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status = 'confirmed')
);

create index bookings_phone_idx       on public.bookings (phone)               where phone is not null;
create index bookings_email_idx       on public.bookings (lower(email))        where email is not null;
create index bookings_barber_time_idx on public.bookings (barber_id, start_at) where status = 'confirmed';

-- ---------------------------------------------------------------------------------------------
-- reviews — public. Anyone may read PUBLISHED rows (policy in 0002_rls.sql); writes go only
-- through the create_review RPC (which inserts published = true).
-- ---------------------------------------------------------------------------------------------
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  rating      smallint not null check (rating between 1 and 5),
  text        text not null check (char_length(text) between 1 and 1000),
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index reviews_published_idx on public.reviews (created_at desc) where published;
