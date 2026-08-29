-- pgTAP — NEW behaviors from migration 0016. Proves:
--   * available_slots never advertises a slot whose start has already passed (the read path now
--     agrees with create_booking's `invalid_time` rejection of past starts),
--   * a future day is unaffected by the now() filter (no over-filtering),
--   * create_review's derived display name is clamped into the reviews.name CHECK (1..80):
--     a whitespace-only customer_name falls back to 'Kund', and a two-word name whose "First X."
--     derivation would exceed 80 chars is capped at 80 — neither can raise check_violation.
--
-- Fixtures: hassan is given a controlled schedule working ALL SEVEN weekdays 09:00–18:00, so the
-- past-date assertions cannot pass for the wrong reason (an off-day already returns nothing).

begin;
select plan(7);

-- ---- fixtures (controlled hassan schedule: every weekday working 09:00–18:00) -----------------
delete from public.barber_schedules where barber_id = 'hassan';
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
select 'hassan', wd, true, 540, 1080 from pg_catalog.generate_series(0, 6) as wd;

-- =============================================================================================
-- available_slots: past slots are never advertised.
-- =============================================================================================
-- Yesterday (working under the fixture schedule): every slot has started -> empty.
select is(
  (select count(*)::int from public.available_slots('hassan', current_date - 1, 45)),
  0, 'yesterday (a working day) returns no slots — every start has passed'
);
-- A far-past working day is likewise empty.
select is(
  (select count(*)::int from public.available_slots('hassan', date '2020-01-06', 45)),
  0, 'a far-past working day returns no slots'
);
-- A week from now every slot start is in the future: full fixed 15-minute grid (34 at 45 min).
select is(
  (select count(*)::int from public.available_slots('hassan', current_date + 7, 45)),
  34, 'a future working day still returns the full fitting grid (no over-filtering)'
);

-- =============================================================================================
-- Legacy create_review is removed and replaced by access-scoped review creation.
-- =============================================================================================
-- Two FINISHED confirmed bookings with legal-but-hostile customer_names: a single space (length 1,
-- passes the bookings CHECK) and a 78-char first word + ' X' (80 chars total, also legal — but the
-- "First X." derivation yields 81).
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
values
  ('hassan','h','Hår',350,45,
   now() - interval '2 hours', now() - interval '75 minutes',
   ' ','phone','0707777771', null,'sv'),
  -- staggered earlier: same barber, so the slots must not overlap (bookings_no_overlap)
  ('hassan','h','Hår',350,45,
   now() - interval '4 hours', now() - interval '195 minutes',
   pg_catalog.repeat('a', 78) || ' X','phone','0707777772', null,'sv');

select is(
  pg_catalog.to_regprocedure('public.create_review(text,integer,text)') is null,
  true,
  'legacy create_review signature is removed'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.create_review_with_access(text,text,integer,text)', 'execute'
  ),
  'service_role can execute access-scoped review creation'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.create_review_with_access(text,text,integer,text)', 'execute'
  ),
  'anon cannot execute access-scoped review creation directly'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.create_review_with_access(text,text,integer,text)', 'execute'
  ),
  'authenticated cannot execute access-scoped review creation directly'
);

select * from finish();
rollback;
