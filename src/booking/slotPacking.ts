// Pure slot-packing: given a barber's working window, the chosen service duration, and the blocked
// intervals for a day, produce the bookable START times on a FIXED 15-minute grid anchored at the
// open time — a start is offered whenever the chosen service FITS there: it ends by close AND its
// `[start, start+duration)` window overlaps no confirmed booking / block. This is the TS twin of the
// SQL `available_slots` RPC; the two MUST agree — see `.claude/runtime/SLOT_PACKING_SPEC.md` (the
// authoritative algorithm + worked examples).
//
// No effects: the caller passes `nowMin` (the minute-of-day cutoff for TODAY, or a value `< openMin`
// for a future date so nothing is filtered). Half-open interval math mirrors create_booking's overlap
// check — a slot `[t, t+dur)` may end exactly at a block start (`t + dur === bs` is fine) and may
// start exactly at a block end (`t === be` is fine).

/** A half-open blocked interval `[startMin, endMin)` in minutes since local midnight. */
export type BlockedInterval = readonly [number, number]

/** Inputs for {@link packSlots}. All values are minutes since local midnight, except `durationMin`. */
export interface PackSlotsParams {
  /** Working-window open time (minutes since midnight). */
  readonly openMin: number
  /** Working-window close time (minutes since midnight). */
  readonly closeMin: number
  /** Chosen service duration in minutes; `<= 0` yields no slots. */
  readonly durationMin: number
  /** Booking/block intervals to pack around (any order; overlaps tolerated, no pre-merge needed). */
  readonly blocked: readonly BlockedInterval[]
  /** Minute-of-day cutoff for TODAY: a candidate is emitted iff `t > nowMin`. Pass a value
   * `< openMin` (e.g. `-1`) for a future date so nothing is filtered. */
  readonly nowMin: number
}

/** Format a minute-of-day as a zero-padded 24h `"HH:MM"` (e.g. `540 -> "09:00"`). */
function hhmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** The fixed start-grid stride: candidate starts are `openMin, openMin+15, openMin+30, …`. */
const STEP_MIN = 15

/**
 * The bookable start times for a day, ascending as `"HH:MM"`. Candidate starts step on a FIXED
 * 15-minute grid anchored at `openMin`; each is offered iff it is strictly after `nowMin`, ends by
 * `closeMin` (`t + durationMin <= closeMin`), and its `[t, t + durationMin)` window overlaps none of
 * the `blocked` intervals. The duration only changes WHICH ticks fit and the latest start — never the
 * 15-min stride — so consecutive (overlapping) ticks are all offered when free. Total — returns `[]`
 * when the service has no positive duration or the working window is empty.
 */
export function packSlots(params: PackSlotsParams): string[] {
  const { openMin, closeMin, durationMin, blocked, nowMin } = params
  if (durationMin <= 0 || closeMin <= openMin) return []

  const out: string[] = []
  // Fixed 15-min grid anchored at open; `durationMin` only gates the fit test and the last start.
  for (let t = openMin; t + durationMin <= closeMin; t += STEP_MIN) {
    if (t <= nowMin) continue // future-only: emit iff the start is strictly after the cutoff
    // Half-open fit over EVERY block (reads only — no pre-sort/merge, caller's array never mutated):
    // the slot ends at/before a block start, OR starts at/after its end.
    const fits = blocked.every(([bs, be]) => t + durationMin <= bs || t >= be)
    if (fits) out.push(hhmm(t))
  }
  return out
}
