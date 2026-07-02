// Schedule view — the LAYERED weekly editor (ADMIN_SPEC §6, the user's exact words):
//   1. Check which weekdays you work (a per-day working toggle).
//   2. "Samma tid alla dagar" — apply one start/end to ALL working days at once.
//   3. Tap a day to set ITS OWN start/end (per-day dropdowns, on the salon's 45-min grid).
//   4. A time-off list to block a single day or a date range (add / remove).
// Save state is explicit: a dirty indicator, a Save button, and an aria-live "Sparat" confirmation.
//
// All schedule mutations are pure reducers from `time.ts` (no in-place edits); the data effects
// (read/save/time-off) are isolated here. RLS guarantees a barber can only ever save their OWN
// schedule — the owner edits whoever the shell's selector targets.

import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { cap, monthLabel, parseDateIso, weekdayLabel } from '../../booking/calendar'
import type { Lang } from '../../i18n/index'
import { availableSlotsFor, readWeek, saveWeek } from '../adapters/schedulesAdmin'
import { addTimeOff, deleteTimeOff, listTimeOff } from '../adapters/timeOffAdmin'
import {
  END_OPTIONS,
  START_OPTIONS,
  defaultWeek,
  sameTimeAllDays,
  setDayHours,
  toDateIso,
  toggleWorking,
  weekIsValid,
} from '../time'
import { ConfirmDialog } from '../ConfirmDialog'
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Weekday order for display: Monday-first (1..6, then 0=Sunday) reads naturally for a work week. */
const DISPLAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

export function ScheduleView(props: ScheduleViewProps): JSX.Element {
  const { s, lang } = props

  const [week, setWeek] = useState<WeekSchedule>(defaultWeek)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // "Same time all days" bound inputs (default to the salon day 09:00–18:00).
  const [bulkStart, setBulkStart] = useState(540)
  const [bulkEnd, setBulkEnd] = useState(1080)

  // Time-off state.
  const [timeOff, setTimeOff] = useState<readonly TimeOff[]>([])
  const [offStart, setOffStart] = useState(() => toDateIso(new Date()))
  const [offEnd, setOffEnd] = useState(() => toDateIso(new Date()))
  const [offReason, setOffReason] = useState('')
  const [offBusy, setOffBusy] = useState(false)
  const [offMsg, setOffMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pendingOff, setPendingOff] = useState<TimeOff | null>(null)
  const [offDeleteBusy, setOffDeleteBusy] = useState(false)

  // Live "what customers see" preview: the bookable slots a SAVED schedule produces for a chosen
  // date (45-min haircut by default). Calls the same anon `available_slots` RPC the booking flow uses.
  const [previewDate, setPreviewDate] = useState(() => toDateIso(new Date()))
  const [previewSlots, setPreviewSlots] = useState<readonly string[] | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Load the week + time-off whenever the target barber changes.
  useEffect(() => {
    let active = true
    setLoaded(false)
    setLoadError(null)
    setDirty(false)
    setSaveState('idle')
    setSaveMsg(null)
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

  const valid = useMemo(() => weekIsValid(week), [week])

  const mutate = (next: WeekSchedule): void => {
    setWeek(next)
    setDirty(true)
    setSaveState('idle')
    setSaveMsg(null)
  }

  const onToggleDay = (weekday: Weekday): void => mutate(toggleWorking(week, weekday))
  const onDayStart = (weekday: Weekday, startMin: number): void => {
    const day = week[weekday]
    mutate(setDayHours(week, weekday, startMin, day?.endMin ?? 1080))
  }
  const onDayEnd = (weekday: Weekday, endMin: number): void => {
    const day = week[weekday]
    mutate(setDayHours(week, weekday, day?.startMin ?? 540, endMin))
  }
  const applyAllDays = (): void => mutate(sameTimeAllDays(week, bulkStart, bulkEnd))

  const onSave = async (): Promise<void> => {
    if (!valid) return
    setSaveState('saving')
    setSaveMsg(null)
    const result = await saveWeek(props.barberId, week)
    if (result.ok) {
      setSaveState('saved')
      setSaveMsg('Schemat sparat.')
      setDirty(false)
    } else {
      setSaveState('error')
      setSaveMsg(result.error.message)
    }
  }

  const onAddTimeOff = async (): Promise<void> => {
    if (offEnd < offStart) {
      setOffMsg({ kind: 'err', text: 'Slutdatum måste vara samma eller efter startdatum.' })
      return
    }
    setOffBusy(true)
    setOffMsg(null)
    const result = await addTimeOff(props.barberId, offStart, offEnd, offReason.trim())
    setOffBusy(false)
    if (!result.ok) {
      setOffMsg({ kind: 'err', text: result.error.message })
      return
    }
    setTimeOff((prev) =>
      [...prev, result.value].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    )
    setOffReason('')
    setOffMsg({ kind: 'ok', text: 'Ledighet tillagd.' })
  }

  const onDeleteTimeOff = async (): Promise<void> => {
    const target = pendingOff
    if (target === null) return
    setOffDeleteBusy(true)
    const result = await deleteTimeOff(target.id)
    setOffDeleteBusy(false)
    setPendingOff(null)
    if (!result.ok) {
      setOffMsg({ kind: 'err', text: result.error.message })
      return
    }
    setTimeOff((prev) => prev.filter((t) => t.id !== target.id))
    setOffMsg({ kind: 'ok', text: 'Ledighet borttagen.' })
  }

  const rangeLabel = (t: TimeOff): string => {
    const start = isoToLabel(lang, t.startDate)
    if (t.startDate === t.endDate) return start
    return `${start} – ${isoToLabel(lang, t.endDate)}`
  }

  // Default haircut duration for the preview (the salon's 45-min slot grid).
  const PREVIEW_DURATION = 45
  const runPreview = async (): Promise<void> => {
    setPreviewBusy(true)
    setPreviewError(null)
    const result = await availableSlotsFor(props.barberId, previewDate, PREVIEW_DURATION)
    setPreviewBusy(false)
    if (result.ok) setPreviewSlots(result.value)
    else {
      setPreviewSlots(null)
      setPreviewError(result.error.message)
    }
  }

  return (
    <>
      {/* Weekly working hours */}
      <section style={s.card} aria-labelledby="schedule-heading">
        <h2 id="schedule-heading" style={s.sectionTitle}>
          Schema · {props.barberName}
        </h2>
        <p style={s.sectionLead}>
          Markera vilka dagar du jobbar och sätt tider. Använd “samma tid alla dagar” för att fylla
          i snabbt, eller justera varje dag för sig.
        </p>

        {loadError !== null ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
        ) : !loaded ? (
          <div style={s.emptyState}>Laddar schema …</div>
        ) : (
          <>
            {/* Same-time-all-days shortcut */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                gap: '12px',
                padding: '14px',
                border: s.card.border,
                borderRadius: '12px',
                margin: '12px 0 18px',
              }}
            >
              <div>
                <label htmlFor="bulk-start" style={s.label}>
                  Från
                </label>
                <select
                  id="bulk-start"
                  style={s.select}
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
              <div>
                <label htmlFor="bulk-end" style={s.label}>
                  Till
                </label>
                <select
                  id="bulk-end"
                  style={s.select}
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
              <button type="button" style={s.ghostBtn} onClick={applyAllDays}>
                Samma tid alla dagar
              </button>
            </div>

            {/* Per-day rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {DISPLAY_ORDER.map((wd) => {
                const day = week[wd]
                if (day === undefined) return null
                const invalid = day.working && day.endMin <= day.startMin
                return (
                  <div
                    key={wd}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 12px',
                      border: s.card.border,
                      borderRadius: '11px',
                      opacity: day.working ? 1 : 0.62,
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '9px',
                        minWidth: '128px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '14px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={day.working}
                        onChange={() => onToggleDay(wd)}
                        aria-label={`Jobbar ${cap(weekdayLabel(lang, wd))}`}
                      />
                      {cap(weekdayLabel(lang, wd))}
                    </label>

                    {day.working ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          aria-label={`Starttid ${cap(weekdayLabel(lang, wd))}`}
                          style={s.select}
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
                          aria-label={`Sluttid ${cap(weekdayLabel(lang, wd))}`}
                          style={s.select}
                          value={day.endMin}
                          onChange={(e) => onDayEnd(wd, Number(e.currentTarget.value))}
                        >
                          {END_OPTIONS.map((o) => (
                            <option key={o.min} value={o.min}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {invalid ? (
                          <span style={s.errorText}>Sluttid måste vara efter starttid</span>
                        ) : null}
                      </div>
                    ) : (
                      <span style={s.mutedText}>Ledig</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Save row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                marginTop: '18px',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                style={{
                  ...s.primaryBtn,
                  opacity: !valid || saveState === 'saving' ? 0.55 : 1,
                  cursor: !valid || saveState === 'saving' ? 'default' : 'pointer',
                }}
                onClick={() => void onSave()}
                disabled={!valid || saveState === 'saving'}
              >
                {saveState === 'saving' ? 'Sparar …' : 'Spara schema'}
              </button>
              {dirty && saveState === 'idle' ? (
                <span style={s.mutedText}>Osparade ändringar</span>
              ) : null}
              <span aria-live="polite">
                {saveMsg !== null ? (
                  <span style={saveState === 'error' ? s.errorText : s.successText}>{saveMsg}</span>
                ) : null}
              </span>
            </div>
          </>
        )}
      </section>

      {/* Time off */}
      <section style={s.card} aria-labelledby="timeoff-heading">
        <h2 id="timeoff-heading" style={s.sectionTitle}>
          Ledighet
        </h2>
        <p style={s.sectionLead}>
          Blockera en dag eller en period (semester, ledig dag). Blockerade datum visas inte som
          bokningsbara.
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '12px',
            margin: '14px 0 6px',
          }}
        >
          <div>
            <label htmlFor="off-start" style={s.label}>
              Från
            </label>
            <input
              id="off-start"
              type="date"
              style={s.input}
              value={offStart}
              onInput={(e) => setOffStart(e.currentTarget.value)}
            />
          </div>
          <div>
            <label htmlFor="off-end" style={s.label}>
              Till
            </label>
            <input
              id="off-end"
              type="date"
              style={s.input}
              value={offEnd}
              onInput={(e) => setOffEnd(e.currentTarget.value)}
            />
          </div>
          <div style={{ flex: '1 1 180px', minWidth: '160px' }}>
            <label htmlFor="off-reason" style={s.label}>
              Anledning (valfritt)
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
            style={{ ...s.primaryBtn, opacity: offBusy ? 0.6 : 1 }}
            onClick={() => void onAddTimeOff()}
            disabled={offBusy}
          >
            {offBusy ? 'Lägger till …' : 'Lägg till'}
          </button>
        </div>

        <div aria-live="polite" style={{ minHeight: '18px', marginBottom: '8px' }}>
          {offMsg !== null ? (
            <span style={offMsg.kind === 'ok' ? s.successText : s.errorText}>{offMsg.text}</span>
          ) : null}
        </div>

        {timeOff.length === 0 ? (
          <div style={s.emptyState}>Ingen ledighet inlagd.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Period</th>
                  <th style={s.th}>Anledning</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {timeOff.map((t) => (
                  <tr key={t.id}>
                    <td style={s.td}>{rangeLabel(t)}</td>
                    <td style={s.td}>
                      {t.reason === '' ? <span style={s.mutedText}>—</span> : t.reason}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <button type="button" style={s.dangerBtn} onClick={() => setPendingOff(t)}>
                        Ta bort
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Live availability preview (what customers will see for a given day) */}
      <section style={s.card} aria-labelledby="preview-heading">
        <h2 id="preview-heading" style={s.sectionTitle}>
          Förhandsgranska lediga tider
        </h2>
        <p style={s.sectionLead}>
          Visa de bokningsbara tiderna en viss dag (45 min) utifrån sparat schema och ledighet — så
          som kunderna ser dem. Spara schemat först för att se ändringar.
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '12px',
            margin: '12px 0',
          }}
        >
          <div>
            <label htmlFor="preview-date" style={s.label}>
              Datum
            </label>
            <input
              id="preview-date"
              type="date"
              style={s.input}
              value={previewDate}
              onInput={(e) => {
                setPreviewDate(e.currentTarget.value)
                setPreviewSlots(null)
              }}
            />
          </div>
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: previewBusy ? 0.6 : 1 }}
            onClick={() => void runPreview()}
            disabled={previewBusy}
          >
            {previewBusy ? 'Hämtar …' : 'Visa lediga tider'}
          </button>
        </div>
        <div aria-live="polite">
          {previewError !== null ? (
            <span style={s.errorText}>{previewError}</span>
          ) : previewSlots === null ? (
            <span style={s.mutedText}>Välj ett datum och tryck på knappen.</span>
          ) : previewSlots.length === 0 ? (
            <span style={s.mutedText}>
              Inga lediga tider den dagen (ledig, stängt eller fullbokat).
            </span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {previewSlots.map((t) => (
                <span key={t} style={s.pill}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {pendingOff !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title="Ta bort ledigheten?"
          body={`${rangeLabel(pendingOff)}${pendingOff.reason === '' ? '' : ` · ${pendingOff.reason}`}`}
          confirmLabel="Ta bort"
          cancelLabel="Avbryt"
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
