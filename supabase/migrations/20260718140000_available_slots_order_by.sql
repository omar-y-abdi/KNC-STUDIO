-- available_slots: formalize the ascending ORDER BY on prod.
--
-- WHY: migration 20260718130000 (the fixed 15-min grid) reached prod from a revision that emitted the
-- grid via `generate_series(...) ... NOT EXISTS (...)` WITHOUT an explicit `order by`. PostgreSQL streams
-- a function-scan in order and the correlated anti-join preserves it, so prod already returns the slots
-- ascending (empirically verified: dur=30/45/60/90 all ascending) — but that is a scan-order accident,
-- not a formal guarantee, whereas the customer chips render in array order and the TS twin
-- (`src/booking/slotPacking.ts`) loops t upward. Adversarial review flagged the missing `order by` as a
-- (minor) robustness gap. The reviewed 130000 file in source already carries `order by gs.t`; this
-- migration re-applies that reviewed definition so the LIVE prod function matches source and the ascending
-- order is a hard guarantee, not incidental.
--
-- Idempotent: create-or-replace with the identical body 130000 already carries in source. On a fresh
-- rebuild this simply re-creates the same function once (a no-op); on the current prod it adds the
-- explicit `order by`. Signature / `stable` / `security definer` / `search_path=''` unchanged; grant
-- restated. Guards + blocked-set + fit test are byte-identical to 130000 — the ONLY line that matters
-- here is the trailing `order by gs.t`.
--
-- Stays in lock-step with the TS twin (same fixed 15-min grid + fits predicate). Authoritative algorithm:
-- .claude/runtime/SLOT_PACKING_SPEC.md.

create or replace function public.available_slots(
  p_barber_id    text,
  p_date         date,
  p_duration_min int
)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open  int;   -- working-window start, minutes since salon-local midnight
  v_close int;   -- working-window end,   minutes since salon-local midnight
begin
  -- Guard: a non-positive duration can never yield a bookable window.
  if p_duration_min is null or p_duration_min <= 0 then
    return;
  end if;

  -- The ONE working window for this barber on this weekday (0=Sun..6=Sat, JS getDay ==
  -- extract(dow ...)). No working row -> the barber is off that weekday -> no slots.
  select s.start_min, s.end_min
    into v_open, v_close
  from public.barber_schedules s
  where s.barber_id = p_barber_id
    and s.working = true
    and s.weekday = pg_catalog.date_part('dow', p_date)::int
  limit 1;

  if not found then
    return;
  end if;

  -- A whole-day time-off range covering the date closes the day entirely.
  if exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and p_date between t.start_date and t.end_date
  ) then
    return;
  end if;

  -- Defensive: a degenerate/empty window yields nothing (the schedule CHECK guarantees
  -- end_min > start_min, so this should never trip — but the spec lists it, so keep it total).
  if v_close <= v_open then
    return;
  end if;

  -- Fixed 15-min start grid anchored at open: candidate starts are v_open, v_open+15, v_open+30, …, up
  -- to the last tick that still fits by close. generate_series stops at v_close - p_duration_min, so
  -- t + p_duration_min <= v_close for every generated t (and it yields nothing when the service is
  -- longer than the whole window). A tick is emitted iff its start instant is strictly after now()
  -- (Europe/Stockholm) AND its half-open [t, t+dur) window overlaps NO blocked interval — the NOT
  -- EXISTS is the negation of the fit test, evaluated over ALL blocks (so unsorted/overlapping blocks
  -- need no pre-merge). Confirmed bookings map to local minutes via Europe/Stockholm (filtered to those
  -- whose LOCAL start day is p_date); walk-in blocks are already stored in local minutes on the date.
  return query
  select pg_catalog.to_char(pg_catalog.make_time(gs.t / 60, gs.t % 60, 0), 'HH24:MI')
  from pg_catalog.generate_series(v_open, v_close - p_duration_min, 15) as gs(t)
  where ((p_date + pg_catalog.make_time(gs.t / 60, gs.t % 60, 0))
           at time zone 'Europe/Stockholm') > pg_catalog.now()
    and not exists (
      select 1
      from (
        select
          pg_catalog.date_part('hour',   loc.s_loc)::int * 60
            + pg_catalog.date_part('minute', loc.s_loc)::int as bs,
          pg_catalog.date_part('hour',   loc.e_loc)::int * 60
            + pg_catalog.date_part('minute', loc.e_loc)::int as be
        from public.bookings bk
        cross join lateral (
          select bk.start_at at time zone 'Europe/Stockholm' as s_loc,
                 bk.end_at   at time zone 'Europe/Stockholm' as e_loc
        ) loc
        where bk.barber_id = p_barber_id
          and bk.status = 'confirmed'
          and loc.s_loc::date = p_date
        union all
        select bl.start_min::int as bs, bl.end_min::int as be
        from public.barber_slot_blocks bl
        where bl.barber_id = p_barber_id
          and bl.block_date = p_date
      ) b
      where gs.t < b.be and gs.t + p_duration_min > b.bs   -- half-open overlap => tick does NOT fit
    )
  order by gs.t;   -- ascending: generate_series streams in order, but ORDER BY makes it a hard guarantee
                   -- (the chips render in array order; the TS twin loops t upward — keep them identical)

  return;
end;
$$;

-- Re-affirm execute for the public booking flow (anon) + the admin panel (authenticated).
grant execute on function public.available_slots(text, date, int) to anon, authenticated;
