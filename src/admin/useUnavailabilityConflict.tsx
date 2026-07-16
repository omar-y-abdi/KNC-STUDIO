// Shared controller for the unavailability↔booking conflict flow (Task 3), used by BOTH the day grid
// ("Blockera hela dagen") and the ScheduleView (veckoschema + ledighet). A caller `request()`s a
// change with its clashing bookings + how to apply/revert it:
//   • no orphans        → the change is applied immediately (returns 'applied')
//   • orphans present    → the 3-button dialog opens (returns 'deferred'); the user then picks
//       Avboka kunder (cancel the orphans, then apply, then show the cancelled list),
//       Ha kvar (apply only), or Avbryt (revert).
// `<ConflictHost>` renders the two dialogs from the controller state. Effects (cancelBooking) live
// here — the pure orphan math is in scheduleConflicts.ts.

import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { cancelBooking } from './adapters/bookingsAdmin'
import { partitionCancellations } from './scheduleConflicts'
import { UnavailabilityDialog } from './UnavailabilityDialog'
import { CancelledCustomersDialog } from './CancelledCustomersDialog'
import type { AdminBooking } from './types'

/** A partial-cancellation failure: `done` of `total` clashing bookings were cancelled before one failed. */
export interface CancelFailure {
  readonly done: number
  readonly total: number
}

/** A pending availability change awaiting the barber's choice. */
export interface ConflictRequest {
  /** Confirmed bookings that clash with the change (already filtered by the caller). */
  readonly orphans: readonly AdminBooking[]
  /** Persist the availability change (add time-off / save the week / block the day). */
  readonly applyChange: () => Promise<void>
  /** Undo an optimistic UI change if the barber aborts (no-op when the change was deferred). */
  readonly revert: () => void
}

export interface ConflictController {
  readonly pending: ConflictRequest | null
  readonly busy: boolean
  readonly cancelled: readonly AdminBooking[] | null
  /** Set when a cancel batch partially failed; the dialog stays open so the barber can retry/keep/abort. */
  readonly error: CancelFailure | null
  /** Apply now if there are no orphans, else open the dialog. */
  readonly request: (req: ConflictRequest) => Promise<'applied' | 'deferred'>
  readonly onCancelCustomers: () => Promise<void>
  readonly onKeepBlock: () => Promise<void>
  readonly onAbort: () => void
  readonly closeCancelled: () => void
  /** Drop all state (e.g. when the selected barber changes). */
  readonly reset: () => void
}

/** `refetch` is called after any applied change so the caller can refresh its bookings. */
export function useUnavailabilityConflict(refetch?: () => void): ConflictController {
  const [pending, setPending] = useState<ConflictRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelled, setCancelled] = useState<readonly AdminBooking[] | null>(null)
  const [error, setError] = useState<CancelFailure | null>(null)

  const request = async (req: ConflictRequest): Promise<'applied' | 'deferred'> => {
    if (req.orphans.length === 0) {
      await req.applyChange()
      refetch?.()
      return 'applied'
    }
    setPending(req)
    return 'deferred'
  }

  const onCancelCustomers = async (): Promise<void> => {
    if (pending === null) return
    setBusy(true)
    setError(null)
    // Sequential + idempotent (admin_cancel_booking): retrying the whole set is safe.
    const oks: boolean[] = []
    for (const b of pending.orphans) {
      const r = await cancelBooking(b.id)
      oks.push(r.ok)
    }
    const { done, failed } = partitionCancellations(pending.orphans, oks)
    if (failed.length > 0) {
      // Some cancels failed. The successes ALREADY happened in the DB, so do NOT apply the availability
      // change on a half-cancelled set — keep the dialog open with an honest "N of M" count. The barber
      // can retry (idempotent → completes the rest), keep the rest, or abort knowing `done` are gone.
      setBusy(false)
      setError({ done: done.length, total: pending.orphans.length })
      return
    }
    await pending.applyChange()
    setBusy(false)
    setPending(null)
    setCancelled(done)
    refetch?.()
  }

  const onKeepBlock = async (): Promise<void> => {
    if (pending === null) return
    setBusy(true)
    setError(null)
    await pending.applyChange()
    setBusy(false)
    setPending(null)
    refetch?.()
  }

  const onAbort = (): void => {
    if (pending === null) return
    pending.revert()
    setError(null)
    setPending(null)
  }

  const closeCancelled = (): void => setCancelled(null)
  const reset = (): void => {
    setPending(null)
    setCancelled(null)
    setBusy(false)
    setError(null)
  }

  return {
    pending,
    busy,
    cancelled,
    error,
    request,
    onCancelCustomers,
    onKeepBlock,
    onAbort,
    closeCancelled,
    reset,
  }
}

export interface ConflictHostProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly ctl: ConflictController
}

/** Renders the two conflict dialogs from a controller. Nothing when idle. */
export function ConflictHost(props: ConflictHostProps): JSX.Element | null {
  const { ctl } = props
  return (
    <>
      {ctl.pending !== null ? (
        <UnavailabilityDialog
          dark={props.dark}
          lang={props.lang}
          bookings={ctl.pending.orphans}
          busy={ctl.busy}
          error={ctl.error}
          onCancelCustomers={() => void ctl.onCancelCustomers()}
          onKeepBlock={() => void ctl.onKeepBlock()}
          onAbort={ctl.onAbort}
        />
      ) : null}
      {ctl.cancelled !== null ? (
        <CancelledCustomersDialog
          dark={props.dark}
          lang={props.lang}
          bookings={ctl.cancelled}
          onClose={ctl.closeCancelled}
        />
      ) : null}
    </>
  )
}
