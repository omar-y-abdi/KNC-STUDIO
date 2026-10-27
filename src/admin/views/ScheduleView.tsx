// Schedule view — rebuilt around how barbers actually work (they come and go, and clients also
// book over text). Three cards, least friction first:
//   1. Dagsöversikt (ScheduleDayGrid): tap a slot to block/unblock it — saved instantly.
//   2. Veckoschema (WeekHoursCard + RecurringBreaksForm): which weekdays + hours. AUTO-SAVES
//      (debounced, useWeekAutosave) — no Save button, no dirty state to remember; an aria-live line
//      reports "Sparar …/Sparat". Invalid windows (end before start) are flagged inline and simply
//      not saved until fixed.
//   3. Ledighet (TimeOffCard): block a date range (vacation) with add/remove; the day grid's
//      "Blockera hela dagen" writes a single-day row through the same handlers.
//
// This file owns what the cards share: the load for the target barber, the upcoming-bookings list
// the conflict checks read, the time-off / recurring-break writers, the conflict-dialog wiring and
// the persistence lock. The cards render and keep their own form fields.
//
// All schedule mutations are pure reducers from `time.ts`; data effects are isolated here.
// RLS guarantees a barber can only ever save their OWN schedule — the owner edits whoever the
// shell's selector targets.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { cap, weekdayLabel } from '../../booking/calendar'
import { palette } from '../../booking/bookingStyles'
import { defaultClock } from '../../config'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { readWeek } from '../adapters/schedulesAdmin'
import {
  addRecurringBreak,
  deleteRecurringBreak,
  listRecurringBreaks,
} from '../adapters/recurringBreaksAdmin'
import { addSlotBlock } from '../adapters/slotBlocksAdmin'
import { addTimeOff, deleteTimeOff, listTimeOff } from '../adapters/timeOffAdmin'
import { minutesToHHMM } from '../time'
import { ConfirmDialog } from '../ConfirmDialog'
import { ScheduleDayGrid } from './ScheduleDayGrid'
import { listBookings } from '../adapters/bookingsAdmin'
import { orphansInRange, orphansOnDate } from '../scheduleConflicts'
import { ConflictHost, useUnavailabilityConflict } from '../useUnavailabilityConflict'
import type { AvailabilityMutationOutcome, SlotBlock } from '../types'
import { RecurringBreaksForm } from './RecurringBreaksForm'
import { TimeOffCard, timeOffRangeLabel } from './TimeOffCard'
import { WeekHoursCard } from './WeekHoursCard'
import { noRevert, useWeekAutosave } from './useWeekAutosave'
import type {
  AdminBarberId,
  AdminBooking,
  AdminStylesBundle,
  RecurringBreak,
  StatusMessage,
  TimeOff,
  Weekday,
} from './viewTypes'

export interface ScheduleViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  /** Whose schedule is being edited (the shell guarantees this is set for this view). */
  readonly barberId: AdminBarberId
  /** Display name used by schedule heading. */
  readonly barberName: string
  /** Prevent shell navigation while an autosave is pending, invalid, or failed. */
  readonly onPersistenceStateChange: (blocked: boolean) => void
}

export function ScheduleView(props: ScheduleViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  const c = palette(props.dark)

  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Time-off state (shared with the day grid's whole-day toggle through addOff/removeOff).
  const [timeOff, setTimeOff] = useState<readonly TimeOff[]>([])
  const [offBusy, setOffBusy] = useState(false)
  const [offMsg, setOffMsg] = useState<StatusMessage | null>(null)
  const [pendingOff, setPendingOff] = useState<TimeOff | null>(null)
  const [offDeleteBusy, setOffDeleteBusy] = useState(false)
  const [recurringBreaks, setRecurringBreaks] = useState<readonly RecurringBreak[]>([])
  const [recurringBusy, setRecurringBusy] = useState(false)
  const [recurringDeleteBusy, setRecurringDeleteBusy] = useState(false)
  const [recurringMsg, setRecurringMsg] = useState<StatusMessage | null>(null)
  const [pendingRecurringDelete, setPendingRecurringDelete] = useState<RecurringBreak | null>(null)

  // This barber's upcoming bookings, used to detect which confirmed bookings a proposed
  // unavailability would strand (block a day / change the week / add ledighet). A nonce refetches
  // after cancellations — it also flows to the day grid so its display refreshes.
  const [bookings, setBookings] = useState<readonly AdminBooking[]>([])
  const [bookingsNonce, setBookingsNonce] = useState(0)
  const [blocksNonce, setBlocksNonce] = useState(0)
  const [dayGridBlocked, setDayGridBlocked] = useState(false)
  const conflict = useUnavailabilityConflict(() => setBookingsNonce((n) => n + 1))

  const loadConflictBookings = async (
    bookingIds: readonly string[],
  ): Promise<readonly AdminBooking[] | null> => {
    const now = defaultClock()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const fresh = await listBookings(props.barberId, midnight.toISOString())
    if (!fresh.ok) return null
    setBookings(fresh.value)
    const wanted = new Set(bookingIds)
    return fresh.value.filter((booking) => wanted.has(booking.id) && booking.status === 'confirmed')
  }

  const autosave = useWeekAutosave({
    barberId: props.barberId,
    bookings,
    conflict,
    loadConflictBookings,
    loadFailedMessage: t.scheduleGridSaveError,
  })

  useEffect(() => {
    const blocked =
      autosave.status.kind === 'saving' ||
      autosave.status.kind === 'invalid' ||
      autosave.status.kind === 'error' ||
      conflict.pending !== null ||
      conflict.busy ||
      offBusy ||
      offDeleteBusy ||
      recurringBusy ||
      recurringDeleteBusy ||
      dayGridBlocked
    props.onPersistenceStateChange(blocked)
    return () => props.onPersistenceStateChange(false)
  }, [
    conflict.busy,
    conflict.pending,
    dayGridBlocked,
    offBusy,
    offDeleteBusy,
    recurringBusy,
    recurringDeleteBusy,
    props.onPersistenceStateChange,
    autosave.status.kind,
  ])

  /** Bumped on every barber load; lets a late fetch tell whether its barber is still the current one. */
  const barberGen = useRef(0)

  // Load week + time-off + upcoming bookings whenever the target barber changes. AdminShell blocks a
  // switch while persistence/conflict work is unresolved and keys this view by barber. Bookings are part of this
  // gate (cleared up front, refetched here) — NOT a separate ungated fetch — so the editor is never
  // interactive with another barber's, or a not-yet-loaded, bookings list. Otherwise a block/toggle in
  // that window would test the conflict against the wrong (or empty) set: cancel the wrong barber's
  // customer, or miss the warning entirely and strand a real booking.
  useEffect(() => {
    let active = true
    barberGen.current++ // invalidate any in-flight nonce refetch holding the PREVIOUS barber's rows
    setLoaded(false)
    setLoadError(null)
    autosave.resetStatus()
    setOffMsg(null)
    setRecurringMsg(null)
    setRecurringBreaks([])
    setBookings([])
    const now = defaultClock()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    void (async () => {
      const [wk, off, bk, recurring] = await Promise.all([
        readWeek(props.barberId),
        listTimeOff(props.barberId),
        listBookings(props.barberId, midnight.toISOString()),
        listRecurringBreaks(props.barberId),
      ])
      if (!active) return
      if (wk.ok) autosave.adopt(wk.value)
      else setLoadError(wk.error.message)
      if (off.ok) setTimeOff(off.value)
      else setLoadError(off.error.message)
      if (recurring.ok) setRecurringBreaks(recurring.value)
      else setLoadError(recurring.error.message)
      // Bookings MUST fail closed. Without them the conflict check silently sees zero orphans and every
      // unavailability change applies unwarned — stranding the customers this feature exists to protect
      // — and the grid would paint a booked day as free. So a failed read blocks the editor, exactly
      // like a failed week read, instead of quietly handing over a lying UI.
      if (bk.ok) setBookings(bk.value)
      else setLoadError(bk.error.message)
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [props.barberId])

  // Refresh bookings after a reservation or cancellation (both bump the nonce). The initial + per-barber
  // loads are owned by the gate effect above; this fires ONLY on a nonce bump, so it never re-gates or
  // flickers the editor. Skip the initial run — nonce starts at 0 and the gate already has the bookings.
  // This effect does NOT depend on barberId, so a switch never runs its cleanup: an in-flight fetch here
  // still holds the old barber's id. `barberGen` (bumped by the gate) is what makes such a late result
  // drop instead of overwriting the new barber's list — otherwise "Avboka kunder" could cancel a
  // customer belonging to the barber we just switched away from.
  const bookingsPrimed = useRef(false)
  useEffect(() => {
    if (!bookingsPrimed.current) {
      bookingsPrimed.current = true
      return
    }
    let active = true
    const gen = barberGen.current
    const now = defaultClock()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    void listBookings(props.barberId, midnight.toISOString()).then((r) => {
      if (!active || gen !== barberGen.current) return
      if (r.ok) setBookings(r.value)
    })
    return () => {
      active = false
    }
  }, [bookingsNonce])

  // Shared time-off writers (the Ledighet form AND the day grid's whole-day toggle land here).
  const addOff = async (
    startDate: string,
    endDate: string,
    reason: string,
    allowExistingBookings = false,
    onApplied?: () => void,
  ): Promise<'applied' | 'deferred' | 'error'> => {
    const result = await addTimeOff(
      props.barberId,
      startDate,
      endDate,
      reason,
      allowExistingBookings,
    )
    if (result.kind === 'ok') {
      setTimeOff((prev) =>
        [...prev, result.value].sort((a, b) => a.startDate.localeCompare(b.startDate)),
      )
      onApplied?.()
      return 'applied'
    }
    if (result.kind === 'error') {
      setOffMsg({ kind: 'err', text: result.error.message })
      return 'error'
    }

    const orphans = await loadConflictBookings(result.bookingIds)
    if (orphans === null) {
      setOffMsg({ kind: 'err', text: t.scheduleGridSaveError })
      return 'error'
    }
    return conflict.request({
      orphans,
      applyChange: async () => {
        await addOff(startDate, endDate, reason, true, onApplied)
      },
      revert: noRevert,
    })
  }
  const removeOff = async (id: string): Promise<boolean> => {
    const result = await deleteTimeOff(id)
    if (!result.ok) {
      setOffMsg({ kind: 'err', text: result.error.message })
      return false
    }
    setTimeOff((prev) => prev.filter((t) => t.id !== id))
    return true
  }

  const addRecurring = async (
    weekday: Weekday,
    startMin: number,
    endMin: number,
    allowExistingBookings = false,
  ): Promise<void> => {
    setRecurringBusy(true)
    setRecurringMsg(null)
    const result = await addRecurringBreak(
      props.barberId,
      weekday,
      startMin,
      endMin,
      allowExistingBookings,
    )
    setRecurringBusy(false)
    if (result.kind === 'ok') {
      setRecurringBreaks((prev) =>
        [...prev, result.value].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin),
      )
      setRecurringMsg({ kind: 'ok', text: t.scheduleRecurringBreakAdded })
      return
    }
    if (result.kind === 'error') {
      setRecurringMsg({ kind: 'err', text: result.error.message })
      return
    }

    const orphans = await loadConflictBookings(result.bookingIds)
    if (orphans === null) {
      setRecurringMsg({ kind: 'err', text: t.scheduleGridSaveError })
      return
    }
    await conflict.request({
      orphans,
      applyChange: () => addRecurring(weekday, startMin, endMin, true),
      revert: noRevert,
    })
  }

  const removeRecurring = async (id: string): Promise<void> => {
    setRecurringDeleteBusy(true)
    const result = await deleteRecurringBreak(id)
    setRecurringDeleteBusy(false)
    setPendingRecurringDelete(null)
    if (!result.ok) {
      setRecurringMsg({ kind: 'err', text: result.error.message })
      return
    }
    setRecurringBreaks((prev) => prev.filter((item) => item.id !== id))
    setRecurringMsg({ kind: 'ok', text: t.scheduleRecurringBreakRemoved })
  }

  // Trigger C — adding ledighet. If confirmed bookings fall inside the range, the conflict dialog
  // decides; otherwise it's applied straight away (unchanged behavior). `clearReason` empties the
  // card's reason field once the range is stored — now, or after the dialog was answered.
  const onAddTimeOff = async (
    start: string,
    end: string,
    rawReason: string,
    clearReason: () => void,
  ): Promise<void> => {
    if (end < start) {
      setOffMsg({ kind: 'err', text: t.scheduleTimeOffDateError })
      return
    }
    const reason = rawReason.trim()
    const orphans = orphansInRange(bookings, start, end, defaultClock())
    const onApplied = (): void => {
      clearReason()
      setOffMsg({ kind: 'ok', text: t.scheduleTimeOffAdded })
    }
    if (orphans.length === 0) {
      setOffBusy(true)
      setOffMsg(null)
      await addOff(start, end, reason, false, onApplied)
      setOffBusy(false)
      return
    }
    await conflict.request({
      orphans,
      applyChange: async () => {
        setOffBusy(true)
        await addOff(start, end, reason, true, onApplied)
        setOffBusy(false)
      },
      revert: noRevert,
    })
  }

  // Trigger A — the day grid's "Blockera hela dagen". No clash → block straight away (grid shows any
  // error from the boolean). A clash → open the dialog and report success so the grid doesn't flag an
  // error; the dialog then applies the block (and cancels, if chosen).
  const onBlockDay = async (dateIso: string): Promise<boolean> => {
    const orphans = orphansOnDate(bookings, dateIso, defaultClock())
    if (orphans.length === 0) return (await addOff(dateIso, dateIso, '')) !== 'error'
    void conflict.request({
      orphans,
      applyChange: async () => {
        await addOff(dateIso, dateIso, '', true)
      },
      revert: noRevert,
    })
    return true
  }

  const onBlockSlot = async (
    dateIso: string,
    startMin: number,
    endMin: number,
  ): Promise<AvailabilityMutationOutcome<SlotBlock>> => {
    const result = await addSlotBlock(props.barberId, dateIso, startMin, endMin)
    if (result.kind !== 'booking_conflict') return result

    const orphans = await loadConflictBookings(result.bookingIds)
    if (orphans === null) {
      return {
        kind: 'error',
        error: { kind: 'network', message: t.scheduleGridSaveError },
      }
    }
    await conflict.request({
      orphans,
      applyChange: async () => {
        const applied = await addSlotBlock(props.barberId, dateIso, startMin, endMin, true)
        if (applied.kind === 'ok') setBlocksNonce((nonce) => nonce + 1)
        else if (applied.kind === 'error') setOffMsg({ kind: 'err', text: applied.error.message })
      },
      revert: noRevert,
    })
    return result
  }

  const onDeleteTimeOff = async (): Promise<void> => {
    const target = pendingOff
    if (target === null) return
    setOffDeleteBusy(true)
    setOffMsg(null)
    const ok = await removeOff(target.id)
    setOffDeleteBusy(false)
    setPendingOff(null)
    if (ok) setOffMsg({ kind: 'ok', text: t.scheduleTimeOffRemoved })
  }

  if (loadError !== null) {
    return (
      <section style={s.card}>
        <h2 style={s.sectionTitle}>
          {t.scheduleHeadingPrefix} · {props.barberName}
        </h2>
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      </section>
    )
  }
  if (!loaded) {
    return (
      <section style={s.card}>
        <h2 style={s.sectionTitle}>
          {t.scheduleHeadingPrefix} · {props.barberName}
        </h2>
        <div style={s.emptyState}>{t.scheduleLoading}</div>
      </section>
    )
  }

  return (
    <>
      {/* 1. Day grid — tap to block/unblock a slot, saved instantly */}
      <ScheduleDayGrid
        c={c}
        dark={props.dark}
        lang={lang}
        s={s}
        barberId={props.barberId}
        week={autosave.week}
        timeOff={timeOff}
        recurringBreaks={recurringBreaks}
        bookings={bookings}
        blocksNonce={blocksNonce}
        onPersistenceStateChange={setDayGridBlocked}
        onBookingsChanged={() => setBookingsNonce((n) => n + 1)}
        onBlockSlot={onBlockSlot}
        onBlockDay={onBlockDay}
        onOpenDay={(id) => removeOff(id)}
      />

      {/* 2. Weekly working hours — auto-saved */}
      <WeekHoursCard
        dark={props.dark}
        lang={lang}
        s={s}
        barberName={props.barberName}
        week={autosave.week}
        status={autosave.status}
        onChange={autosave.edit}
        onRetry={autosave.retry}
      >
        <RecurringBreaksForm
          lang={lang}
          s={s}
          breaks={recurringBreaks}
          busy={recurringBusy}
          message={recurringMsg}
          onAdd={(weekday, startMin, endMin) => void addRecurring(weekday, startMin, endMin)}
          onRequestRemove={(item) => setPendingRecurringDelete(item)}
        />
      </WeekHoursCard>

      {/* 3. Time off */}
      <TimeOffCard
        lang={lang}
        s={s}
        timeOff={timeOff}
        busy={offBusy}
        message={offMsg}
        onAdd={(start, end, reason, clearReason) =>
          void onAddTimeOff(start, end, reason, clearReason)
        }
        onRequestRemove={(off) => setPendingOff(off)}
      />

      {pendingOff !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.scheduleTimeOffDeleteTitle}
          body={`${timeOffRangeLabel(lang, pendingOff)}${pendingOff.reason === '' ? '' : ` · ${pendingOff.reason}`}`}
          confirmLabel={t.scheduleTimeOffRemove}
          cancelLabel={t.scheduleTimeOffDeleteCancel}
          danger
          busy={offDeleteBusy}
          onConfirm={() => void onDeleteTimeOff()}
          onClose={() => {
            if (!offDeleteBusy) setPendingOff(null)
          }}
        />
      ) : null}

      {pendingRecurringDelete !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.scheduleRecurringBreakDeleteTitle}
          body={`${cap(weekdayLabel(lang, pendingRecurringDelete.weekday))} · ${minutesToHHMM(
            pendingRecurringDelete.startMin,
          )}–${minutesToHHMM(pendingRecurringDelete.endMin)}`}
          confirmLabel={t.scheduleRecurringBreakRemove}
          cancelLabel={t.scheduleRecurringBreakDeleteCancel}
          danger
          busy={recurringDeleteBusy}
          onConfirm={() => void removeRecurring(pendingRecurringDelete.id)}
          onClose={() => {
            if (!recurringDeleteBusy) setPendingRecurringDelete(null)
          }}
        />
      ) : null}

      {/* Trigger A/B/C — the unavailability↔booking conflict dialogs (nothing when no clash). */}
      <ConflictHost dark={props.dark} lang={lang} ctl={conflict} />
    </>
  )
}
