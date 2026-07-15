// Pure retry-escalation for the phone lookup. A first unknown number → "not found, try again"; the
// SAME normalised number a second time → "no bookings, contact the salon"; a DIFFERENT number resets
// to the first message. Modeled as a tiny transition so the dialog stays declarative and this is
// unit-testable without the DOM.

export type LookupFailureLevel = 'first' | 'escalated'

export interface EscalationState {
  /** The last normalised number that failed as not_found, or null before any failure. */
  readonly lastFailed: string | null
}

export const initialEscalation: EscalationState = { lastFailed: null }

export interface EscalationStep {
  readonly state: EscalationState
  readonly level: LookupFailureLevel
}

/**
 * Advance the escalation on a `not_found` for `normalized`. Repeating the same number escalates;
 * any other number resets to the first-failure message. Returns the next state + the level to show.
 */
export function nextEscalation(prev: EscalationState, normalized: string): EscalationStep {
  if (prev.lastFailed === normalized) {
    return { state: prev, level: 'escalated' }
  }
  return { state: { lastFailed: normalized }, level: 'first' }
}
