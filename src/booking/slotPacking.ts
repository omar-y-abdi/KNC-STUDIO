// Pure slot-packing: given a barber's working window, the chosen service duration, and the blocked
// intervals for a day, produce the bookable START times — stepped by the service duration and packed
// tightly from the LEFT edge of every free gap (the open time OR a booking/block end). This is the
// TS twin of the SQL `available_slots` RPC; the two MUST agree — see
// `.claude/runtime/SLOT_PACKING_SPEC.md` (the authoritative algorithm + worked examples).
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

/**
 * The bookable start times for a day, ascending as `"HH:MM"`. Free-interval left-packing: every gap
 * between blocks (and the tail up to close) is filled from ITS OWN left edge in `durationMin` steps,
 * so a 30-min slot appears EXACTLY when a preceding 90-min booking ends. Total — returns `[]` when
 * the service has no positive duration or the working window is empty.
 */
export function packSlots(params: PackSlotsParams): string[] {
  const { openMin, closeMin, durationMin, blocked, nowMin } = params
  if (durationMin <= 0 || closeMin <= openMin) return []

  // Sort a COPY (never mutate the caller's array); overlaps are handled by the cursor, no pre-merge.
  const sorted = [...blocked].sort((a, b) => a[0] - b[0])
  const emitted: string[] = []

  // Left-pack one free gap `[from, until)` in `durationMin` steps, keeping only candidates > nowMin.
  const emitGap = (from: number, until: number): void => {
    let t = from
    while (t + durationMin <= until) {
      if (t > nowMin) emitted.push(hhmm(t))
      t += durationMin
    }
  }

  let cursor = openMin
  for (const [bs, be] of sorted) {
    emitGap(cursor, Math.min(bs, closeMin))
    cursor = Math.max(cursor, be)
    if (cursor >= closeMin) break
  }
  // Tail gap from the last cursor to close (no-op when a block already pushed the cursor to close).
  emitGap(cursor, closeMin)
  return emitted
}
