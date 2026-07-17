-- available_slots: fixed 45-min grid  ->  duration-stepped, booking-PACKED model.
--
-- WHY: the shipped available_slots (0017) advertised a FIXED 12-VALUES grid at a 45-min cadence
-- (09:00, 09:45, 10:30, …) and merely filtered out the entries that didn't fit / overlapped. That
-- grid is wrong once services have different durations: a 30-min service should be bookable at
-- 09:00, 09:30, 10:00, … and — crucially — the slot right AFTER a booking should start EXACTLY when
-- that booking ends (a 90-min booking 09:00–10:30 must expose a 30-min slot at 10:30, which no fixed
-- 45-min grid can express). This rewrites the RPC to generate bookable start times STEPPED BY the
-- selected service's duration and left-PACKED into each free interval between bookings/blocks.
-- Authoritative algorithm + worked examples: .claude/runtime/SLOT_PACKING_SPEC.md.
--
-- WHY plpgsql (was `language sql`): the model is a cursor walk over the blocked intervals sorted
-- ascending, packing each free gap from its own left edge by p_duration_min. That is inherently
-- iterative (a stateful cursor + nested emit loop) and does not reduce to a single set query the way
-- the old VALUES-grid filter did — so the function switches to plpgsql. Signature, volatility
-- (`stable`), `security definer`, and `set search_path = ''` are all unchanged; the grants below are
-- re-affirmed (a `create or replace` keeps the existing ACL, but we restate it for the record).
--
-- Model (must stay in lock-step with the TS mock util `src/booking/slotPacking.ts` — same spec):
--   * open/close: the barber's ONE working window for that weekday (barber_schedules, working=true,
--     weekday = dow(date)). No such row -> no slots. Split shifts are OUT OF SCOPE (one [open,close)
--     window per (barber, weekday); the table's PK already enforces one row per pair).
--   * p_duration_min <= 0 -> no slots. A time-off range covering the date -> no slots.
--   * blocked = the half-open intervals [startMin,endMin) to avoid, in minutes since salon-local
--     midnight, = confirmed bookings whose LOCAL start day is p_date (instants -> Europe/Stockholm)
--     UNION barber_slot_blocks on p_date. The cursor walk tolerates overlapping/adjacent intervals
--     with no pre-merge.
--   * Half-open overlap mirrors create_booking / the exclusion constraint: a slot [t,t+dur) may end
--     exactly at a block start (t+dur == bs OK) and may start exactly at a block end (t == be OK).
--   * now-filter: for TODAY a candidate is emitted only if its start INSTANT is strictly after now()
--     (Europe/Stockholm), mirroring create_booking rejecting `p_start_at <= now()`. Future dates all
--     pass. Labels are `HH24:MI` (24h, zero-padded), e.g. 09:00.
--
-- Fully-qualifies catalog functions with `pg_catalog.` because search_path is ''. LEAST/GREATEST are
-- parser-level constructs (not catalog functions), so — like coalesce/nullif elsewhere — they need
-- no qualification.

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
  v_open    int;   -- working-window start, minutes since salon-local midnight
  v_close   int;   -- working-window end,   minutes since salon-local midnight
  v_cursor  int;   -- left edge of the free interval currently being packed
  v_gap_end int;   -- right edge of the current free gap (clamped to close)
  v_t       int;   -- candidate start, minutes since salon-local midnight
  v_blk     record;
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

  v_cursor := v_open;

  -- Walk the blocked intervals ascending by start. For each, pack the free gap [cursor, bs) from
  -- its LEFT edge by p_duration_min, then advance the cursor past the block's end. Confirmed
  -- bookings map to local minutes via Europe/Stockholm (filtered to those whose LOCAL start day is
  -- p_date); walk-in blocks are already stored in local minutes on the date.
  for v_blk in
    select bs, be
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
    ) blocked
    order by bs
  loop
    -- Pack the free gap that ends where this block begins (clamped to close).
    v_gap_end := least(v_blk.bs, v_close);
    v_t := v_cursor;
    while v_t + p_duration_min <= v_gap_end loop
      if ((p_date + pg_catalog.make_time(v_t / 60, v_t % 60, 0))
            at time zone 'Europe/Stockholm') > pg_catalog.now() then
        return next pg_catalog.to_char(pg_catalog.make_time(v_t / 60, v_t % 60, 0), 'HH24:MI');
      end if;
      v_t := v_t + p_duration_min;
    end loop;

    -- Advance past this block. greatest() keeps the cursor monotonic across overlapping intervals.
    v_cursor := greatest(v_cursor, v_blk.be);
    exit when v_cursor >= v_close;
  end loop;

  -- Tail gap [cursor, close): the free interval after the last block (or the whole day if none).
  v_t := v_cursor;
  while v_t + p_duration_min <= v_close loop
    if ((p_date + pg_catalog.make_time(v_t / 60, v_t % 60, 0))
          at time zone 'Europe/Stockholm') > pg_catalog.now() then
      return next pg_catalog.to_char(pg_catalog.make_time(v_t / 60, v_t % 60, 0), 'HH24:MI');
    end if;
    v_t := v_t + p_duration_min;
  end loop;

  return;
end;
$$;

-- Re-affirm execute for the public booking flow (anon) + the admin panel (authenticated). The
-- `create or replace` above preserves the 0006/0016 ACL (revoke-from-public + this grant), so this
-- is idempotent; we restate it so the grant lives beside the definition. No REVOKE is issued.
grant execute on function public.available_slots(text, date, int) to anon, authenticated;
