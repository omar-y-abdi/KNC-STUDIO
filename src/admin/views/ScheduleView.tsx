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
import type { AdminBarberId, AdminStylesBundle, TimeOff, Weekday, WeekSchedule } from './viewTypes'

export interface ScheduleViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  /** Whose schedule is being edited (the shell guarantees this is set for this view). */
  readonly barberId: AdminBarberId
  /** Display name, for the heading ("Schema · Victor"). */
  readonly barberName: string
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

  // Auto-save plumbing: a debounce timer + a generation counter so a stale response (or a save for
  // a previously-selected barber) can never clobber newer state.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveGen = useRef(0)
  const pendingSave = useRef<WeekSchedule | null>(null)

  const doSave = async (barberId: AdminBarberId, next: WeekSchedule): Promise<void> => {
    const gen = ++saveGen.current
    pendingSave.current = null
    setWeekSave({ kind: 'saving' })
    const result = await saveWeek(barberId, next)
    if (gen !== saveGen.current) return // superseded by a newer edit/save
    if (result.ok) setWeekSave({ kind: 'saved' })
    else setWeekSave({ kind: 'error', message: result.error.message })
  }

  const mutate = (next: WeekSchedule): void => {
    setWeek(next)
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveGen.current++ // invalidate any in-flight save; this edit supersedes it
    if (!weekIsValid(next)) {
      pendingSave.current = null
      setWeekSave({ kind: 'invalid' })
      return
    }
    setWeekSave({ kind: 'saving' })
    pendingSave.current = next
    const barberId = props.barberId
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void doSave(barberId, next)
    }, SAVE_DEBOUNCE_MS)
  }

  // Load the week + time-off whenever the target barber changes; flush any pending save for the
  // PREVIOUS barber first so a quick barber-switch never drops an edit.
  useEffect(() => {
    let active = true
    setLoaded(false)
    setLoadError(null)
    setWeekSave({ kind: 'idle' })
    setOffMsg(null)
    void (async () => {
      const [wk, off] = await Promise.all([readWeek(props.barberId), listTimeOff(props.barberId)])
      if (!active) return
      if (wk.ok) setWeek(wk.value)
      else setLoadError(wk.error.message)
      if (off.ok) setTimeOff(off.value)
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [props.barberId])

  // Flush a pending (debounced) save on unmount/barber-switch instead of dropping it.
  useEffect(() => {
    const barberId = props.barberId
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const pending = pendingSave.current
      if (pending !== null) {
        pendingSave.current = null
        void saveWeek(barberId, pending)
      }
    }
  }, [props.barberId])

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
  const addOff = async (startDate: string, endDate: string, reason: string): Promise<boolean> => {
    const result = await addTimeOff(props.barberId, startDate, endDate, reason)
    if (!result.ok) {
      setOffMsg({ kind: 'err', text: result.error.message })
      return false
    }
    setTimeOff((prev) =>
      [...prev, result.value].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    )
    return true
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

  const onAddTimeOff = async (): Promise<void> => {
    if (offEnd < offStart) {
      setOffMsg({ kind: 'err', text: t.scheduleTimeOffDateError })
      return
    }
    setOffBusy(true)
    setOffMsg(null)
    const ok = await addOff(offStart, offEnd, offReason.trim())
    setOffBusy(false)
    if (ok) {
      setOffReason('')
      setOffMsg({ kind: 'ok', text: t.scheduleTimeOffAdded })
    }
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
        <h2 style={s.sectionTitle}>{t.scheduleHeadingPrefix} · {props.barberName}</h2>
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      </section>
    )
  }
  if (!loaded) {
    return (
      <section style={s.card}>
        <h2 style={s.sectionTitle}>{t.scheduleHeadingPrefix} · {props.barberName}</h2>
        <div style={s.emptyState}>{t.scheduleLoading}</div>
      </section>
    )
  }

  return (
    <>
      {/* 1. Day grid — tap to block/unblock a slot, saved instantly */}
      <ScheduleDayGrid
        c={c}
        lang={lang}
        s={s}
        barberId={props.barberId}
        week={week}
        timeOff={timeOff}
        onBlockDay={(dateIso) => addOff(dateIso, dateIso, '')}
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
                {invalid ? (
                  <span style={s.errorText}>{t.scheduleInvalidHours}</span>
                ) : null}
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
