// Pure time-slot logic: the fixed slot list + the deterministic availability formula, ported
// from the original mock. No effects, no randomness — availability is a pure function of
// (day-of-month, barber index, slot index, service duration).

/** Fixed 45-minute-cadence slot grid. */
export const SLOTS: readonly string[] = [
  '09:00',
  '09:45',
  '10:30',
  '11:15',
  '12:00',
  '12:45',
  '13:30',
  '14:15',
  '15:00',
  '15:45',
  '16:30',
  '17:15',
]

/** Per-duration "busyness" factor. */
export function durFactor(dur: number): number {
  return dur >= 60 ? 6 : dur >= 45 ? 4 : 3
}

/**
 * Whether a slot is already taken — the original mock's formula:
 *   ((dayOfMonth*31 + barberIndex*7 + slotIndex*13 + dur) % 10) < durFactor(dur)
 * Deterministic, so the baseline screenshot reproduces exactly.
 */
export function slotTaken(
  dayOfMonth: number,
  barberIndex: number,
  slotIndex: number,
  dur: number,
): boolean {
  return (dayOfMonth * 31 + barberIndex * 7 + slotIndex * 13 + dur) % 10 < durFactor(dur)
}
