# Slot Packing Spec — shared by the SQL RPC and the TS mock (they MUST agree)

## Goal
Bookable start times step on a FIXED 15-minute grid anchored at the open time, and a start is offered
whenever the chosen service FITS there: it ends by close AND its `[start, start+duration)` window does
not overlap any confirmed booking / block. This is the customer-facing "15-min timeline" model.

Empty day (open 09:00–18:00):
- 30-min service → 09:00, 09:15, 09:30, …, 17:30 (last start 17:30, +30 = 18:00).
- 45-min service → 09:00, 09:15, …, 17:15 (last +45 = 18:00).
- 90-min service → 09:00, 09:15, …, 16:30 (last +90 = 18:00).

Packs around bookings: a booking 09:00–09:30 (30 min) makes a 45-min service bookable at 09:30
(09:30–10:15) — the grid tick right after the booking end, because `[09:30,10:15)` no longer overlaps.

> This REPLACES the earlier "step by the service duration from each free-gap left edge" model. The
> start GRID is now fixed at 15 min for every duration; the duration only controls the fit test and the
> latest start (`start + duration <= close`). Candidate starts may overlap each other (09:00 and 09:15
> are both offered for a 45-min service) — that is intended: the customer picks one, and once booked the
> ticks whose window overlaps it drop out. Chips show the START time only (no range).

## Inputs
- `openMin`, `closeMin`: the barber's working window for that weekday (minutes since local midnight),
  from `barber_schedules` where `working=true` and `weekday = dow(date)`. If no such row → NO slots.
- `durationMin`: the chosen service's duration. If ≤ 0 → NO slots.
- Whole-day time-off: if `barber_time_off` covers the date → NO slots.
- `blocked`: half-open intervals `[startMin, endMin)` to avoid, = union of:
  - confirmed bookings that local day: `[localStartMin, localEndMin)` (instants → Europe/Stockholm).
  - `barber_slot_blocks` that day: `[start_min, end_min)`.
- "now": for TODAY, a candidate is valid only if its start INSTANT is strictly AFTER now
  (Europe/Stockholm) — mirrors create_booking rejecting `p_start_at <= now()`. Future dates: all pass.

## The grid step
`STEP_MIN = 15` (fixed). Anchored at `openMin`: candidate starts are `openMin, openMin+15, openMin+30, …`
All service durations in this app are multiples of 15, so a booking that starts on the grid also ends
on the grid — but the algorithm does NOT rely on that: the fit test below is exact for any interval.

## Algorithm (fixed 15-min grid + fit test)
```
STEP = 15
if durationMin <= 0 or closeMin <= openMin: return []
for t = openMin; t + durationMin <= closeMin; t += STEP:      # 15-min grid; last start fits by close
    if slotInstant(date, t) <= now: continue                 # future-only (future dates: always kept)
    if fits(t, durationMin, blocked): emit hhmm(t)            # no overlap with ANY blocked interval
return emitted, ascending, as "HH:MM" (24h, zero-padded, e.g. "09:00")

fits(t, dur, blocked) := for EVERY [bs, be) in blocked:  (t + dur <= bs)  OR  (t >= be)
    # i.e. NOT (t < be AND t + dur > bs). The slot window ends at/before the block starts, OR starts
    # at/after the block ends. No pre-sort / pre-merge needed — the predicate is over ALL blocks.
```
Key invariants:
- **Fixed 15-min start grid** anchored at open — every offered start is `openMin + k*15`. The duration
  changes only WHICH ticks fit and the last tick (`t + dur <= close`), never the stride.
- **Half-open overlap** (matches create_booking / the exclusion constraint): a slot `[t, t+dur)` is fine
  if it ends exactly at a block start (`t+dur == bs` OK) and may start exactly at a block end
  (`t == be` OK). So the tick at a booking's end is bookable.
- **Overlapping candidates are expected** — the grid does not skip ahead by duration, so consecutive
  ticks (whose windows overlap) are all offered when free.
- The fit test is over ALL blocked intervals, so overlapping / unsorted blocks need no pre-merge.

## Worked examples (open 09:00–18:00 = [540,1080], STEP=15)
- No bookings, dur=30 → 09:00,09:15,…,17:30. Count = (1050-540)/15+1 = **35**.
- No bookings, dur=45 → 09:00,09:15,…,17:15. Count = (1035-540)/15+1 = **34**.
- No bookings, dur=60 → 09:00,09:15,…,17:00. Count = (1020-540)/15+1 = **33**.
- No bookings, dur=90 → 09:00,09:15,…,16:30. Count = (990-540)/15+1 = **31**.
- Booking 09:00–09:30 [540,570], dur=45 → 09:30,09:45,…,17:15 (t=540,555 overlap; t=570 fits: 570>=570).
  First = **09:30** = the "09:30–10:15" case. Count = (1035-570)/15+1 = 32.
- Booking 09:00–10:30 [540,630], dur=30 → first fit t=630 → **10:30**, then 10:45,11:00,…,17:30.
  (t=540..615 all overlap.) Count from 630 = (1050-630)/15+1 = 29.
- Booking 09:00–09:45 [540,585], dur=30 → first = 09:45 (t=585). NOTE 10:00 (t=600) **IS** offered now
  (`[600,630)` vs `[540,585)`: 600>=585 → fits) — under the OLD duration-stepped model 10:00 was skipped.
- Booking 10:00–11:30 [600,690], dur=30 → leading 09:00,09:15,09:30 (09:30: 570+30=600 ends at block
  start, fits), then 11:30,11:45,…,17:30. (t=585..675 overlap.)
- now-filter: nowMin=570 (09:30), dur=30, empty → first kept = 09:45 (t=585, first grid tick > 570).

## SQL specifics (available_slots)
- Keep signature `available_slots(p_barber_id text, p_date date, p_duration_min int) returns setof text`
  and grants (anon + authenticated). Keep `stable security definer set search_path=''`. Emit
  `to_char(make_time(t/60,t%60,0),'HH24:MI')`. `create or replace` preserves the ACL; restate the grant.
- The off-day guard (no working row → return), whole-day time-off guard, and `p_duration_min<=0` /
  degenerate-window guards are UNCHANGED. Only the emit body changes from the cursor walk to the grid.
- The grid + fit is naturally SET-BASED (no stateful cursor). Preferred body once `v_open`/`v_close`
  are resolved:
  ```sql
  return query
  select pg_catalog.to_char(pg_catalog.make_time(gs.t / 60, gs.t % 60, 0), 'HH24:MI')
  from pg_catalog.generate_series(v_open, v_close - p_duration_min, 15) as gs(t)
  where ((p_date + pg_catalog.make_time(gs.t / 60, gs.t % 60, 0))
           at time zone 'Europe/Stockholm') > pg_catalog.now()
    and not exists (
      select 1 from ( <blocked UNION ALL as bs,be> ) b
      where gs.t < b.be and gs.t + p_duration_min > b.bs   -- half-open overlap
    );
  ```
  `generate_series(v_open, v_close - p_duration_min, 15)` yields nothing when the service is longer than
  the window (total). It may stay `language plpgsql` (guards are procedural) with this `return query`, or
  become `language sql` with the guards folded into CTEs — plpgsql + `return query` is the smaller diff.
- Booking local minutes: `(b.start_at at time zone 'Europe/Stockholm')` → hour*60+minute; same for
  end_at. Only `status='confirmed'` and `(b.start_at at tz 'Europe/Stockholm')::date = p_date`. UNION ALL
  `barber_slot_blocks` (`start_min`,`end_min`) on `block_date = p_date`.
- Assume ONE working row per (barber, weekday) (`limit 1`); split shifts out of scope — note it.
- Fully-qualify catalog fns with `pg_catalog.` (search_path is ''). `generate_series` is in pg_catalog.

## TS specifics (pure util `src/booking/slotPacking.ts`)
- KEEP the exported `packSlots({ openMin, closeMin, durationMin, blocked, nowMin }): string[]` signature
  and `BlockedInterval` type EXACTLY (consumers `localCalendar.ts` mock + `BookingFlow.tsx` must not
  change). Only the body changes: fixed 15-min grid + `fits` predicate. Candidate valid iff `t > nowMin`
  and `fits`. No effects. No mutation of `blocked`. Unit-test every worked example above.
- `const STEP_MIN = 15` — a single named constant; do not thread it through the signature (not requested).
- The mock adapter builds `blocked` from a deterministic per-(date,barber) set; it already calls
  packSlots and needs NO change — its output just becomes 15-min-grid dense. Keep it deterministic.
