// Schedule view — rebuilt around how barbers actually work (they come and go, and clients also
// book over text). Three cards, least friction first:
//   1. Dagsöversikt (ScheduleDayGrid): tap a slot to block/unblock it — saved instantly.
//   2. Veckoschema: which weekdays + hours. AUTO-SAVES (debounced) — no Save button, no dirty
//      state to remember; an aria-live line reports "Sparar …/Sparat". Invalid windows (end
//      before start) are flagged inline and simply not saved until fixed.
//   3. Ledighet: block a date range (vacation) with add/remove; the day grid's "Blockera hela
//      dagen" writes a single-day row through the same handlers.
//
// All schedule mutations are pure reducers from `time.ts`; data effects are isolated here.
// RLS guarantees a barber can only ever save their OWN schedule — the owner edits whoever the
// shell's selector targets.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { cap, monthLabel, parseDateIso, weekdayLabel } from '../../booking/calendar'
import { palette } from '../../booking/bookingStyles'
import { defaultClock } from '../../config'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { readWeek, saveWeek } from '../adapters/schedulesAdmin'
import { addSlotBlock } from '../adapters/slotBlocksAdmin'
import { addTimeOff, deleteTimeOff, listTimeOff } from '../adapters/timeOffAdmin'
import {
  DEFAULT_END_MIN,
  DEFAULT_START_MIN,
  END_OPTIONS,
  START_OPTIONS,
  defaultWeek,
  sameTimeAllDays,
  setDayHours,
  toDateIso,
  toggleWorking,
  weekIsValid,
} from '../time'
import { WorkSwitch, useNarrow } from '../chrome'
import { ConfirmDialog } from '../ConfirmDialog'
import { ScheduleDayGrid } from './ScheduleDayGrid'
import { listBookings } from '../adapters/bookingsAdmin'
import { orphansInRange, orphansOnDate, orphansUnderWeek } from '../scheduleConflicts'
import { ConflictHost, useUnavailabilityConflict } from '../useUnavailabilityConflict'
import type { AvailabilityMutationOutcome, SlotBlock } from '../types'
import type {
  AdminBarberId,
  AdminBooking,
  AdminStylesBundle,
  TimeOff,
  Weekday,
  WeekSchedule,
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

/** Auto-save status of the week editor (one aria-live line renders it). */
type WeekSave =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'error'; readonly message: string }

/** Debounce for week auto-save: long enough to batch a burst of edits, short enough to feel live. */
const SAVE_DEBOUNCE_MS = 600

/** Weekday order for display: Monday-first (1..6, then 0=Sunday) reads naturally for a work week. */
const DISPLAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

/** A deferred conflict change is never applied before the barber chooses, so aborting undoes nothing. */
const noRevert = (): void => undefined

export function ScheduleView(props: ScheduleViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  const c = palette(props.dark)
  const narrow = useNarrow()

  const [week, setWeek] = useState<WeekSchedule>(defaultWeek)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [weekSave, setWeekSave] = useState<WeekSave>({ kind: 'idle' })

  // "Same time all days" bound inputs (default to the salon day 09:00–18:00).
  const [bulkStart, setBulkStart] = useState(DEFAULT_START_MIN)
  const [bulkEnd, setBulkEnd] = useState(DEFAULT_END_MIN)

  // Time-off state (shared with the day grid's whole-day toggle through addOff/removeOff).
  const [timeOff, setTimeOff] = useState<readonly TimeOff[]>([])
  const [offStart, setOffStart] = useState(() => toDateIso(defaultClock()))
  const [offEnd, setOffEnd] = useState(() => toDateIso(defaultClock()))
  const [offReason, setOffReason] = useState('')
  const [offBusy, setOffBusy] = useState(false)
  const [offMsg, setOffMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pendingOff, setPendingOff] = useState<TimeOff | null>(null)
  const [offDeleteBusy, setOffDeleteBusy] = useState(false)

  // This barber's upcoming bookings, used to detect which confirmed bookings a proposed
  // unavailability would strand (block a day / change the week / add ledighet). A nonce refetches
  // after cancellations — it also flows to the day grid so its display refreshes.
  const [bookings, setBookings] = useState<readonly AdminBooking[]>([])
  const [bookingsNonce, setBookingsNonce] = useState(0)
  const [blocksNonce, setBlocksNonce] = useState(0)
  const [dayGridBlocked, setDayGridBlocked] = useState(false)
  const conflict = useUnavailabilityConflict(() => setBookingsNonce((n) => n + 1))

  useEffect(() => {
    const blocked =
      weekSave.kind === 'saving' ||
      weekSave.kind === 'invalid' ||
      weekSave.kind === 'error' ||
      conflict.pending !== null ||
      conflict.busy ||
      offBusy ||
      offDeleteBusy ||
      dayGridBlocked
    props.onPersistenceStateChange(blocked)
    return () => props.onPersistenceStateChange(false)
  }, [
    conflict.busy,
    conflict.pending,
    dayGridBlocked,
    offBusy,
    offDeleteBusy,
    props.onPersistenceStateChange,
    weekSave.kind,
  ])

  // Auto-save plumbing: a debounce timer + a generation counter so a stale response (or a save for
  // a previously-selected barber) can never clobber newer state.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGen = useRef(0)
  const pendingSave = useRef<{
    readonly week: WeekSchedule
    readonly allowExistingBookings: boolean
  } | null>(null)
  const persistedWeek = useRef<WeekSchedule>(defaultWeek())
  /** Bumped on every barber load; lets a late fetch tell whether its barber is still the current one. */
  const barberGen = useRef(0)

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
      setWeekSave({ kind: 'error', message: t.scheduleGridSaveError })
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
    const barberId = props.barberId
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
  const mutate = (next: WeekSchedule): void => {
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
    setWeekSave({ kind: 'idle' })
    setOffMsg(null)
    setBookings([])
    const now = defaultClock()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    void (async () => {
      const [wk, off, bk] = await Promise.all([
        readWeek(props.barberId),
        listTimeOff(props.barberId),
        listBookings(props.barberId, midnight.toISOString()),
      ])
      if (!active) return
      if (wk.ok) {
        setWeek(wk.value)
        persistedWeek.current = wk.value
      } else setLoadError(wk.error.message)
      if (off.ok) setTimeOff(off.value)
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

  const onToggleDay = (weekday: Weekday): void => mutate(toggleWorking(week, weekday))
  const onDayStart = (weekday: Weekday, startMin: number): void => {
    const day = week[weekday]
    mutate(setDayHours(week, weekday, startMin, day?.endMin ?? DEFAULT_END_MIN))
  }
  const onDayEnd = (weekday: Weekday, endMin: number): void => {
    const day = week[weekday]
    mutate(setDayHours(week, weekday, day?.startMin ?? DEFAULT_START_MIN, endMin))
  }
  const applyAllDays = (): void => mutate(sameTimeAllDays(week, bulkStart, bulkEnd))

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

  // Trigger C — adding ledighet. If confirmed bookings fall inside the range, the conflict dialog
  // decides; otherwise it's applied straight away (unchanged behavior).
  const onAddTimeOff = async (): Promise<void> => {
    if (offEnd < offStart) {
      setOffMsg({ kind: 'err', text: t.scheduleTimeOffDateError })
      return
    }
    const now = defaultClock().getTime()
    const start = offStart
    const end = offEnd
    const reason = offReason.trim()
    const orphans = orphansInRange(bookings, start, end).filter((b) => b.startAt.getTime() >= now)
    if (orphans.length === 0) {
      setOffBusy(true)
      setOffMsg(null)
      await addOff(start, end, reason, false, () => {
        setOffReason('')
        setOffMsg({ kind: 'ok', text: t.scheduleTimeOffAdded })
      })
      setOffBusy(false)
      return
    }
    await conflict.request({
      orphans,
      applyChange: async () => {
        setOffBusy(true)
        await addOff(start, end, reason, true, () => {
          setOffReason('')
          setOffMsg({ kind: 'ok', text: t.scheduleTimeOffAdded })
        })
        setOffBusy(false)
      },
      revert: noRevert,
    })
  }

  // Trigger A — the day grid's "Blockera hela dagen". No clash → block straight away (grid shows any
  // error from the boolean). A clash → open the dialog and report success so the grid doesn't flag an
  // error; the dialog then applies the block (and cancels, if chosen).
  const onBlockDay = async (dateIso: string): Promise<boolean> => {
    const now = defaultClock().getTime()
    const orphans = orphansOnDate(bookings, dateIso).filter((b) => b.startAt.getTime() >= now)
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

  const rangeLabel = (t: TimeOff): string => {
    const start = isoToLabel(lang, t.startDate)
    if (t.startDate === t.endDate) return start
    return `${start} – ${isoToLabel(lang, t.endDate)}`
  }

  const saveLine = (): JSX.Element | null => {
    switch (weekSave.kind) {
      case 'idle':
        return null
      case 'saving':
        return <span style={s.mutedText}>{t.scheduleSaving}</span>
      case 'saved':
        return <span style={s.successText}>{t.scheduleSaved}</span>
      case 'invalid':
        return <span style={s.errorText}>{t.scheduleInvalidHours}</span>
      case 'error':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
            <span style={s.errorText}>{weekSave.message}</span>
            <button
              type="button"
              style={{ ...s.ghostBtn, padding: '4px 10px', fontSize: '12px' }}
              onClick={() => void doSave(props.barberId, week)}
            >
              {t.scheduleRetry}
            </button>
          </span>
        )
    }
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
        week={week}
        timeOff={timeOff}
        bookings={bookings}
        blocksNonce={blocksNonce}
        onPersistenceStateChange={setDayGridBlocked}
        onBookingsChanged={() => setBookingsNonce((n) => n + 1)}
        onBlockSlot={onBlockSlot}
        onBlockDay={onBlockDay}
        onOpenDay={(id) => removeOff(id)}
      />

      {/* 2. Weekly working hours — auto-saved */}
      <section style={s.card} aria-labelledby="schedule-heading">
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <h2 id="schedule-heading" style={s.sectionTitle}>
            {t.scheduleWeekHeadingPrefix} · {props.barberName}
          </h2>
          <span aria-live="polite">{saveLine()}</span>
        </div>
        <p style={s.sectionLead}>{t.scheduleWeekLead}</p>

        {/* Same-time-all-days shortcut. On phones the selects share one full-width line and the
            button gets its own — nothing cramped, nothing wrapping mid-control. */}
        <div
          style={{
            display: 'flex',
            flexDirection: narrow ? 'column' : 'row',
            alignItems: narrow ? 'stretch' : 'flex-end',
            gap: '12px',
            padding: '14px',
            border: s.card.border,
            borderRadius: '12px',
            margin: '12px 0 18px',
          }}
        >
          <div
            style={{
              display: 'grid',
              // minmax(0,1fr): a select/input has an intrinsic min width and would otherwise
              // force the grid WIDER than the card, colliding with its border on phones.
              gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
              alignItems: 'end',
              gap: '8px',
              flex: narrow ? undefined : 'none',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <label htmlFor="bulk-start" style={s.label}>
                {t.scheduleFrom}
              </label>
              <select
                id="bulk-start"
                style={{ ...s.select, width: '100%', minWidth: 0 }}
                value={bulkStart}
                onChange={(e) => setBulkStart(Number(e.currentTarget.value))}
              >
                {START_OPTIONS.map((o) => (
                  <option key={o.min} value={o.min}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <span style={{ ...s.mutedText, paddingBottom: '9px' }}>–</span>
            <div style={{ minWidth: 0 }}>
              <label htmlFor="bulk-end" style={s.label}>
                {t.scheduleTo}
              </label>
              <select
                id="bulk-end"
                style={{ ...s.select, width: '100%', minWidth: 0 }}
                value={bulkEnd}
                onChange={(e) => setBulkEnd(Number(e.currentTarget.value))}
              >
                {END_OPTIONS.map((o) => (
                  <option key={o.min} value={o.min}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" style={s.ghostBtn} onClick={applyAllDays}>
            {t.scheduleSameTimeAllDays}
          </button>
        </div>

        {/* Per-day rows: name + switch, then the time range. On phones the row stacks: the day
            name and switch share the top line, the two selects share the line below (full width,
            big tap targets). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {DISPLAY_ORDER.map((wd) => {
            const day = week[wd]
            if (day === undefined) return null
            const invalid = day.working && day.endMin <= day.startMin
            const dayName = cap(weekdayLabel(lang, wd))
            const timeControls = day.working ? (
              <div
                style={{
                  display: 'grid',
                  // minmax(0,1fr) lets the selects shrink instead of pushing past the row border.
                  gridTemplateColumns: narrow
                    ? 'minmax(0, 1fr) auto minmax(0, 1fr)'
                    : 'auto auto auto',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <select
                  aria-label={`${t.scheduleStartTimeAria} ${dayName}`}
                  style={{ ...s.select, width: narrow ? '100%' : undefined, minWidth: 0 }}
                  value={day.startMin}
                  onChange={(e) => onDayStart(wd, Number(e.currentTarget.value))}
                >
                  {START_OPTIONS.map((o) => (
                    <option key={o.min} value={o.min}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span style={s.mutedText}>–</span>
                <select
                  aria-label={`${t.scheduleEndTimeAria} ${dayName}`}
                  style={{ ...s.select, width: narrow ? '100%' : undefined, minWidth: 0 }}
                  value={day.endMin}
                  onChange={(e) => onDayEnd(wd, Number(e.currentTarget.value))}
                >
                  {END_OPTIONS.map((o) => (
                    <option key={o.min} value={o.min}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span style={s.mutedText}>{t.scheduleDayOffLabel}</span>
            )
            return (
              <div
                key={wd}
                style={{
                  display: 'flex',
                  flexDirection: narrow ? 'column' : 'row',
                  alignItems: narrow ? 'stretch' : 'center',
                  gap: narrow ? '10px' : '14px',
                  padding: '11px 13px',
                  border: invalid ? '0.5px solid ' + String(s.errorText.color) : s.card.border,
                  borderRadius: '12px',
                  opacity: day.working ? 1 : 0.62,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    minWidth: narrow ? undefined : '176px',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{dayName}</span>
                  <WorkSwitch
                    on={day.working}
                    onToggle={() => onToggleDay(wd)}
                    label={`${t.scheduleWorkingAria} ${dayName}`}
                    dark={props.dark}
                  />
                </div>
                {timeControls}
                {invalid ? <span style={s.errorText}>{t.scheduleInvalidHours}</span> : null}
              </div>
            )
          })}
        </div>
      </section>

      {/* 3. Time off */}
      <section style={s.card} aria-labelledby="timeoff-heading">
        <h2 id="timeoff-heading" style={s.sectionTitle}>
          {t.scheduleTimeOffHeading}
        </h2>
        <p style={s.sectionLead}>{t.scheduleTimeOffLead}</p>

        <div
          style={{
            display: narrow ? 'grid' : 'flex',
            // On narrow screens a single column stacks Från/Till vertically so the date inputs
            // (which have a browser-enforced minimum width) never push outside the card border.
            // On wider screens the flex + wrap handles layout; gridTemplateColumns has no effect.
            gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '12px',
            margin: '14px 0 6px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <label htmlFor="off-start" style={s.label}>
              {t.scheduleFrom}
            </label>
            <input
              id="off-start"
              type="date"
              style={{ ...s.input, width: narrow ? '100%' : undefined, minWidth: 0 }}
              value={offStart}
              onInput={(e) => setOffStart(e.currentTarget.value)}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <label htmlFor="off-end" style={s.label}>
              {t.scheduleTo}
            </label>
            <input
              id="off-end"
              type="date"
              style={{ ...s.input, width: narrow ? '100%' : undefined, minWidth: 0 }}
              value={offEnd}
              onInput={(e) => setOffEnd(e.currentTarget.value)}
            />
          </div>
          <div style={narrow ? { gridColumn: '1 / -1' } : { flex: '1 1 180px', minWidth: '160px' }}>
            <label htmlFor="off-reason" style={s.label}>
              {t.scheduleTimeOffReason}
            </label>
            <input
              id="off-reason"
              type="text"
              maxLength={120}
              style={s.input}
              value={offReason}
              onInput={(e) => setOffReason(e.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            style={{
              ...s.primaryBtn,
              opacity: offBusy ? 0.6 : 1,
              gridColumn: narrow ? '1 / -1' : undefined,
            }}
            onClick={() => void onAddTimeOff()}
            disabled={offBusy}
          >
            {offBusy ? t.scheduleTimeOffAdding : t.scheduleTimeOffAdd}
          </button>
        </div>

        <div aria-live="polite" style={{ minHeight: '18px', marginBottom: '8px' }}>
          {offMsg !== null ? (
            <span style={offMsg.kind === 'ok' ? s.successText : s.errorText}>{offMsg.text}</span>
          ) : null}
        </div>

        {timeOff.length === 0 ? (
          <div style={s.emptyState}>{t.scheduleTimeOffEmpty}</div>
        ) : narrow ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {timeOff.map((off) => (
              <div
                key={off.id}
                style={{
                  border: s.card.border,
                  borderRadius: '12px',
                  padding: '11px 13px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>{rangeLabel(off)}</div>
                  {off.reason !== '' ? (
                    <div style={{ ...s.mutedText, fontSize: '12.5px', marginTop: '2px' }}>
                      {off.reason}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  style={{ ...s.dangerBtn, padding: '7px 13px', fontSize: '13px', flex: 'none' }}
                  onClick={() => setPendingOff(off)}
                >
                  {t.scheduleTimeOffRemove}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t.scheduleTimeOffColPeriod}</th>
                  <th style={s.th}>{t.scheduleTimeOffColReason}</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>{t.scheduleTimeOffColAction}</th>
                </tr>
              </thead>
              <tbody>
                {timeOff.map((off) => (
                  <tr key={off.id}>
                    <td style={s.td}>{rangeLabel(off)}</td>
                    <td style={s.td}>
                      {off.reason === '' ? <span style={s.mutedText}>—</span> : off.reason}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <button type="button" style={s.dangerBtn} onClick={() => setPendingOff(off)}>
                        {t.scheduleTimeOffRemove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pendingOff !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.scheduleTimeOffDeleteTitle}
          body={`${rangeLabel(pendingOff)}${pendingOff.reason === '' ? '' : ` · ${pendingOff.reason}`}`}
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

      {/* Trigger A/B/C — the unavailability↔booking conflict dialogs (nothing when no clash). */}
      <ConflictHost dark={props.dark} lang={lang} ctl={conflict} />
    </>
  )
}

/** `2026-08-14` -> "14 Aug" using the localized month label (date-only, salon-local). */
function isoToLabel(lang: Lang, iso: string): string {
  const parts = parseDateIso(iso)
  if (parts === null) return iso
  const date = new Date(parts.year, parts.month - 1, parts.day)
  return `${date.getDate()} ${cap(monthLabel(lang, date.getMonth()))}`
}
