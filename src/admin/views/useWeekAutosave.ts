// Veckoschema autosave: the edit -> conflict check -> debounce -> save pipeline of the week editor,
// kept out of ScheduleView so the timer + generation bookkeeping lives in one place.
//
//   edit(next)  : an edit that would strand confirmed bookings is HELD behind the conflict dialog;
//                 otherwise the week is shown at once and saved after a short debounce (no Save
//                 button, no dirty state). Invalid windows are flagged and never saved.
//   status      : what the one aria-live line renders ("Sparar …/Sparat/invalid/error").
//   adopt/resetStatus : the owner of the data load (ScheduleView) hands the fetched week in and
//                 clears the status when the target barber changes.
//
// The doSave/commitWeek/edit functions are deliberately plain per-render closures (no useCallback):
// the debounced timeout must capture exactly the render that scheduled it.

import { useEffect, useRef, useState } from 'preact/hooks'
import { defaultClock } from '../../config'
import { saveWeek } from '../adapters/schedulesAdmin'
import { orphansUnderWeek } from '../scheduleConflicts'
import { defaultWeek, weekIsValid } from '../time'
import type { ConflictController } from '../useUnavailabilityConflict'
import type { AdminBarberId, AdminBooking, WeekSchedule } from './viewTypes'

/** Auto-save status of the week editor (one aria-live line renders it). */
export type WeekSave =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'error'; readonly message: string }

/** Debounce for week auto-save: long enough to batch a burst of edits, short enough to feel live. */
const SAVE_DEBOUNCE_MS = 600

/** A deferred conflict change is never applied before the barber chooses, so aborting undoes nothing. */
export const noRevert = (): void => undefined

export interface WeekAutosaveInput {
  /** Whose week is being edited. */
  readonly barberId: AdminBarberId
  /** This barber's upcoming bookings: what a proposed week is checked against for clashes. */
  readonly bookings: readonly AdminBooking[]
  readonly conflict: ConflictController
  /** Re-reads the bookings a rejected save clashed with; `null` when they could not be loaded. */
  readonly loadConflictBookings: (
    bookingIds: readonly string[],
  ) => Promise<readonly AdminBooking[] | null>
  /** Shown as the save error when the clashing bookings could not be loaded. */
  readonly loadFailedMessage: string
}

export interface WeekAutosave {
  readonly week: WeekSchedule
  readonly status: WeekSave
  /** Take the server's week as both the editor content and the revert baseline (initial load). */
  readonly adopt: (week: WeekSchedule) => void
  /** Forget the previous save status (the target barber changed). */
  readonly resetStatus: () => void
  /** Apply a week edit: held behind the conflict dialog if it strands bookings, else autosaved. */
  readonly edit: (next: WeekSchedule) => void
  /** Save the current week again after a failed save. */
  readonly retry: () => void
}

export function useWeekAutosave(input: WeekAutosaveInput): WeekAutosave {
  const { bookings, conflict, loadConflictBookings, loadFailedMessage } = input
  const [week, setWeek] = useState<WeekSchedule>(defaultWeek)
  const [weekSave, setWeekSave] = useState<WeekSave>({ kind: 'idle' })

  // Auto-save plumbing: a debounce timer + a generation counter so a stale response (or a save for
  // a previously-selected barber) can never clobber newer state.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGen = useRef(0)
  const pendingSave = useRef<{
    readonly week: WeekSchedule
    readonly allowExistingBookings: boolean
  } | null>(null)
  const persistedWeek = useRef<WeekSchedule>(defaultWeek())

  const doSave = async (
    barberId: AdminBarberId,
    next: WeekSchedule,
    allowExistingBookings = false,
  ): Promise<void> => {
    const gen = ++saveGen.current
    pendingSave.current = null
    setWeekSave({ kind: 'saving' })
    const result = await saveWeek(barberId, next, allowExistingBookings)
    if (gen !== saveGen.current) return // superseded by a newer edit/save
    if (result.kind === 'ok') {
      persistedWeek.current = next
      setWeekSave({ kind: 'saved' })
      return
    }
    if (result.kind === 'error') {
      setWeekSave({ kind: 'error', message: result.error.message })
      return
    }

    const orphans = await loadConflictBookings(result.bookingIds)
    if (gen !== saveGen.current) return
    if (orphans === null) {
      setWeekSave({ kind: 'error', message: loadFailedMessage })
      return
    }
    await conflict.request({
      orphans,
      applyChange: () => doSave(barberId, next, true),
      revert: () => {
        setWeek(persistedWeek.current)
        setWeekSave({ kind: 'saved' })
      },
    })
  }

  const commitWeek = (next: WeekSchedule, allowExistingBookings = false): void => {
    setWeek(next)
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveGen.current++ // invalidate any in-flight save; this edit supersedes it
    if (!weekIsValid(next)) {
      pendingSave.current = null
      setWeekSave({ kind: 'invalid' })
      return
    }
    setWeekSave({ kind: 'saving' })
    pendingSave.current = { week: next, allowExistingBookings }
    const barberId = input.barberId
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void doSave(barberId, next, allowExistingBookings)
    }, SAVE_DEBOUNCE_MS)
  }

  // Trigger B — a veckoschema change (weekday off / narrowed hours / same-time-all-days) that would
  // strand confirmed bookings is HELD behind the conflict dialog instead of silently saving. The
  // change stays deferred (week/pendingSave untouched) until the barber chooses, so aborting needs no
  // revert and a barber-switch flush can't commit a conflicted week. Invalid weeks skip the check
  // (they never save anyway) and fall through to the inline "invalid hours" state.
  const edit = (next: WeekSchedule): void => {
    if (weekIsValid(next)) {
      const orphans = orphansUnderWeek(bookings, next, defaultClock())
      if (orphans.length > 0) {
        void conflict.request({
          orphans,
          applyChange: async () => commitWeek(next, true),
          revert: noRevert,
        })
        return
      }
    }
    commitWeek(next)
  }

  // Cancel a pending debounce on unmount/barber-switch. AdminShell blocks navigation while a valid
  // edit is pending, and an invalid week is intentionally never persisted.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const pending = pendingSave.current
      if (pending !== null) pendingSave.current = null
    }
  }, [input.barberId])

  const adopt = (loaded: WeekSchedule): void => {
    setWeek(loaded)
    persistedWeek.current = loaded
  }
  const resetStatus = (): void => setWeekSave({ kind: 'idle' })
  const retry = (): void => void doSave(input.barberId, week)

  return { week, status: weekSave, adopt, resetStatus, edit, retry }
}
