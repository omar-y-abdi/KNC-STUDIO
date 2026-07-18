-- available_slots: duration-PACKED cursor walk  ->  FIXED 15-min start grid + fit test.
--
-- WHY: migration 0025 (20260718120000) generated bookable starts by STEPPING the selected service's
-- duration and left-PACKING each free interval between bookings/blocks (a stateful cursor walk). That
-- makes the offered grid depend on both the duration and where each booking lands: a 30-min service on
-- an empty day stepped 09:00, 09:30, 10:00, …, and a 45-min booking 09:00–09:45 shifted every later
-- start onto an OFFSET :45/:15 grid (09:45, 10:15, …), never re-touching the :00/:30 grid. The
-- customer-facing model we actually want is a FIXED 15-minute timeline: starts always tick on the
-- :00/:15/:30/:45 grid anchored at open, and a start is offered whenever the chosen service simply FITS
-- there — it ends by close AND its half-open [t, t+dur) window overlaps no confirmed booking / block.
-- The duration now controls only WHICH ticks fit and the latest start (t + dur <= close); it never
-- changes the 15-min stride. So the 45-min booking above now leaves 09:45 AND 10:00 bookable, and
-- consecutive 15-min ticks whose windows overlap each other are all offered (the customer picks one;
-- once it is booked, the ticks its window overlaps drop out). Chips show the START time only, no range.
-- Authoritative algorithm + worked examples: .claude/runtime/SLOT_PACKING_SPEC.md.
--
-- WHY set-based (0025 was a plpgsql cursor walk): the fixed grid + fit test carries no state — every
-- tick is judged independently against ALL blocked intervals — so it collapses to a single `return
-- query` over generate_series(v_open, v_close - p_duration_min, 15) with a NOT EXISTS half-open overlap
-- test. The function stays `language plpgsql` only because the four guards below are procedural; the
-- emit body is now one set query (no cursor / gap / tail bookkeeping). generate_series yields nothing
-- when the service is longer than the whole window, so "service too long" needs no special-casing.
--
-- Must stay in lock-step with the TS mock util src/booking/slotPacking.ts (same spec, same fixed 15-min
-- grid + fits predicate). Signature, volatility (`stable`), `security definer`, and `set search_path=''`
-- are unchanged; the grant below is re-affirmed (`create or replace` keeps the existing ACL, but we
-- restate it for the record).
--
-- Model (identical inputs to 0025 — only the emit changes):
--   * open/close: the barber's ONE working window for that weekday (barber_schedules, working=true,
--     weekday = dow(date)). No such row -> no slots. Split shifts are OUT OF SCOPE (one [open,close)
--     window per (barber, weekday); the table's PK already enforces one row per pair).
--   * p_duration_min <= 0 -> no slots. A time-off range covering the date -> no slots.
--   * blocked = the half-open intervals [startMin,endMin) to avoid, in minutes since salon-local
--     midnight, = confirmed bookings whose LOCAL start day is p_date (instants -> Europe/Stockholm)
--     UNION barber_slot_blocks on p_date. The fit test is over ALL blocks, so overlapping / adjacent
--     intervals need no pre-sort / pre-merge.
--   * Fit (half-open, mirrors create_booking / the exclusion constraint): a tick [t,t+dur) fits iff for
--     every block [bs,be):  t + dur <= bs  OR  t >= be  — i.e. NOT (t < be AND t + dur > bs). So a tick
--     may end exactly at a block start (t+dur == bs OK) and start exactly at a block end (t == be OK):
--     the tick at a booking's end is bookable.
--   * now-filter: for TODAY a candidate is emitted only if its start INSTANT is strictly after now()
--     (Europe/Stockholm), mirroring create_booking rejecting `p_start_at <= now()`. Future dates all
--     pass. Labels are `HH24:MI` (24h, zero-padded), e.g. 09:00.
--
-- Fully-qualifies catalog functions with `pg_catalog.` because search_path is '' (generate_series,
-- make_time, to_char, date_part, now are all in pg_catalog).

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

-- Re-affirm execute for the public booking flow (anon) + the admin panel (authenticated). The
-- `create or replace` above preserves the 0006/0016 ACL (revoke-from-public + this grant), so this is
-- idempotent; we restate it so the grant lives beside the definition. No REVOKE is issued.
grant execute on function public.available_slots(text, date, int) to anon, authenticated;
