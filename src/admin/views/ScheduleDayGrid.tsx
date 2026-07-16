// The day grid — the schedule tab's primary surface, built for walk-in/text bookings:
//   a strip of upcoming days, then the working day as HOUR buttons (09:00–17:00). Each hour chip
//   shows a four-segment mini bar (its quarters' states) + a one-word summary; pressing it expands
//   the hour into four 15-MIN QUARTER chips:
//     tap an OPEN quarter    -> block it (saved instantly, optimistic)
//     tap a BLOCKED quarter  -> reopen it
//     BOOKED quarters show the customer's first name (cancel lives in the bookings tab)
//     CLOSED/PAST quarters are inert
//   "Blockera hela timmen" writes four independent 15-min rows so each quarter stays individually
//   reopenable; "Blockera hela dagen" writes a single-day time-off row (and flips to "Öppna dagen").
//
// The quarter-state math is pure (`dayHours` in ../time.ts); this file owns only fetch + tap
// effects. Writes are optimistic and revert with an aria-live error on failure.

import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { cap, formatWhenLabel, monthLabel, weekdayLabel } from '../../booking/calendar'
import { defaultClock } from '../../config'
import type { Lang } from '../../i18n/index'
import { adminText, type AdminStrings } from '../../i18n/adminStrings'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { createManualBooking, listBookings } from '../adapters/bookingsAdmin'
import { ReserveDialog, type ReserveFields } from '../ReserveDialog'
import { addSlotBlock, deleteSlotBlock, listSlotBlocks } from '../adapters/slotBlocksAdmin'
import type { Palette } from '../../booking/bookingStyles'
import { QUARTER_LEN_MIN, dayHours, timeOffCovering, toDateIso, upcomingDates } from '../time'
import type { DayBooking, DaySlot, HourGroup, SlotState } from '../time'
import type {
  AdminBarberId,
  AdminBooking,
  AdminStylesBundle,
  SlotBlock,
  TimeOff,
  WeekSchedule,
} from './viewTypes'

/** How many days the picker strip offers (today + ~2 weeks — the text-booking horizon). */
const STRIP_DAYS = 14

export interface ScheduleDayGridProps {
  readonly c: Palette
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly week: WeekSchedule
  readonly timeOff: readonly TimeOff[]
  /** Block the whole day (parent inserts a single-day time-off row and updates its list). */
  readonly onBlockDay: (dateIso: string) => Promise<boolean>
  /** Reopen a day blocked by a SINGLE-DAY time-off row (parent deletes it + updates its list). */
  readonly onOpenDay: (timeOffId: string) => Promise<boolean>
}

export function ScheduleDayGrid(props: ScheduleDayGridProps): JSX.Element {
  const { c, s, lang } = props
  const t = adminText(lang)
  const today = defaultClock()
  const days = useMemo(() => upcomingDates(today, STRIP_DAYS), [toDateIso(today)])
  const todayIso = toDateIso(today)

  const [dateIso, setDateIso] = useState(todayIso)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [blocks, setBlocks] = useState<readonly SlotBlock[] | null>(null)
  const [bookings, setBookings] = useState<readonly AdminBooking[]>([])
  const [busyQuarters, setBusyQuarters] = useState<readonly number[]>([])
  const [dayBusy, setDayBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "Reservera kund": the hour being reserved (start minute-of-day), plus the async write state. A
  // nonce bump re-runs the bookings fetch so a new reservation shows immediately as a booked slot.
  const [reserveMin, setReserveMin] = useState<number | null>(null)
  const [reserveBusy, setReserveBusy] = useState(false)
  const [reserveError, setReserveError] = useState<string | null>(null)
  const [bookingsNonce, setBookingsNonce] = useState(0)

  // Blocks are per-date; bookings are per-barber (fetched once, filtered per day below).
  useEffect(() => {
    let active = true
    setBlocks(null)
    setError(null)
    void listSlotBlocks(props.barberId, dateIso).then((r) => {
      if (!active) return
      if (r.ok) setBlocks(r.value)
      else setError(r.error.message)
    })
    return () => {
      active = false
    }
  }, [props.barberId, dateIso])

  useEffect(() => {
    let active = true
    setBookings([])
    // Local midnight today — the strip only shows today+forward, so older bookings are dead weight.
    const now = defaultClock()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    void listBookings(props.barberId, midnight.toISOString()).then((r) => {
      if (active && r.ok) setBookings(r.value)
    })
    return () => {
      active = false
    }
  }, [props.barberId, bookingsNonce])

  const off = timeOffCovering(props.timeOff, dateIso)
  const hours = useMemo((): readonly HourGroup[] => {
    const selected = parseIsoLocal(dateIso)
    const now = defaultClock()
    const pastCutoffMin = dateIso === toDateIso(now) ? now.getHours() * 60 + now.getMinutes() : 0
    return dayHours({
      day: props.week[selected.getDay()],
      dayOff: off !== undefined,
      blocks: blocks ?? [],
      bookings: dayBookings(bookings, dateIso),
      pastCutoffMin,
    })
  }, [props.week, off, blocks, bookings, dateIso])

  // The whole day is off (time off / non-working weekday): show a calm state card, not 9 dead chips.
  const dayIsOff = hours.every((h) => h.quarters.every((q) => q.state === 'closed'))

  const selectDate = (iso: string): void => {
    setDateIso(iso)
    setExpanded(null)
    setError(null)
  }

  const blockQuarter = async (startMin: number): Promise<boolean> => {
    const r = await addSlotBlock(props.barberId, dateIso, startMin, startMin + QUARTER_LEN_MIN)
    if (r.ok) {
      const created = r.value
      setBlocks((prev) => [...(prev ?? []), created])
      return true
    }
    setError(r.error.message)
    return false
  }
  const unblockQuarter = async (blockId: string): Promise<boolean> => {
    const r = await deleteSlotBlock(blockId)
    if (r.ok) {
      setBlocks((prev) => (prev ?? []).filter((b) => b.id !== blockId))
      return true
    }
    setError(r.error.message)
    return false
  }

  const toggleQuarter = async (q: DaySlot): Promise<void> => {
    if (busyQuarters.includes(q.startMin)) return
    setBusyQuarters((prev) => [...prev, q.startMin])
    setError(null)
    if (q.state === 'blocked' && q.blockId !== null) await unblockQuarter(q.blockId)
    else await blockQuarter(q.startMin)
    setBusyQuarters((prev) => prev.filter((m) => m !== q.startMin))
  }

  /** Block every open quarter of an hour (4 independent 15-min rows) or reopen its blocked ones. */
  const toggleHourBulk = async (hour: HourGroup, block: boolean): Promise<void> => {
    const targets = hour.quarters.filter((q) =>
      block ? q.state === 'open' : q.state === 'blocked',
    )
    if (targets.length === 0) return
    setBusyQuarters((prev) => [...prev, ...targets.map((q) => q.startMin)])
    setError(null)
    await Promise.all(
      targets.map((q) =>
        block ? blockQuarter(q.startMin) : q.blockId !== null ? unblockQuarter(q.blockId) : null,
      ),
    )
    setBusyQuarters((prev) => prev.filter((m) => !targets.some((q) => q.startMin === m)))
  }

  const toggleDay = async (): Promise<void> => {
    setDayBusy(true)
    setError(null)
    const ok =
      off !== undefined && off.startDate === off.endDate
        ? await props.onOpenDay(off.id)
        : await props.onBlockDay(dateIso)
    setDayBusy(false)
    if (!ok) setError(t.scheduleGridSaveError)
  }

  // Whole-day control: single-day off -> reopen; range off -> managed under Ledighet; else block.
  const inRangeOff = off !== undefined && off.startDate !== off.endDate

  // "Reservera kund": build the salon-local start instant for a given minute-of-day on the selected
  // date (browser TZ = salon TZ, same convention as the public booking flow).
  const startAtFor = (minuteOfDay: number): Date => {
    const base = parseIsoLocal(dateIso)
    return new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      Math.floor(minuteOfDay / 60),
      minuteOfDay % 60,
    )
  }
  const reserveTimeLabel = reserveMin === null ? '' : formatWhenLabel(lang, startAtFor(reserveMin))

  const onReserveSubmit = async (fields: ReserveFields): Promise<void> => {
    if (reserveMin === null) return
    setReserveBusy(true)
    setReserveError(null)
    const r = await createManualBooking(props.barberId, {
      startAt: startAtFor(reserveMin),
      durationMin: 45,
      serviceName: t.reserveServiceName,
      price: fields.price,
      customerName: fields.customerName,
      phone: fields.phone,
    })
    setReserveBusy(false)
    if (!r.ok) {
      setReserveError(r.error.message)
      return
    }
    setReserveMin(null)
    setExpanded(null)
    setBookingsNonce((n) => n + 1)
  }

  const dayChip = (d: Date): JSX.Element => {
    const iso = toDateIso(d)
    const on = iso === dateIso
    return (
      <button
        key={iso}
        type="button"
        onClick={() => selectDate(iso)}
        aria-pressed={on}
        style={{
          flex: 'none',
          border: on ? '0.5px solid ' + c.accent : '0.5px solid ' + c.line,
          borderRadius: '11px',
          padding: '8px 12px',
          fontFamily: 'inherit',
          cursor: 'pointer',
          background: on ? c.accent : c.card,
          color: on ? c.accentText : c.text,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          minWidth: '58px',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, opacity: on ? 0.85 : 0.55 }}>
          {iso === todayIso ? t.scheduleGridToday : cap(weekdayLabel(lang, d.getDay()).slice(0, 3))}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 700 }}>
          {d.getDate()} {cap(monthLabel(lang, d.getMonth()).slice(0, 3))}
        </span>
      </button>
    )
  }

  /** Mini four-segment bar showing the hour's quarter states at a glance. */
  const segmentBar = (hour: HourGroup): JSX.Element => (
    <span style={{ display: 'flex', gap: '3px' }} aria-hidden="true">
      {hour.quarters.map((q) => (
        <span
          key={q.startMin}
          style={{
            width: '13px',
            height: '5px',
            borderRadius: '3px',
            ...segmentColor(c, q.state),
          }}
        />
      ))}
    </span>
  )

  const hourChip = (hour: HourGroup): JSX.Element => {
    const open = hour.quarters.filter((q) => q.state === 'open').length
    const inert = hour.quarters.every((q) => q.state === 'closed' || q.state === 'past')
    const isExpanded = expanded === hour.startMin
    return (
      <button
        key={hour.startMin}
        type="button"
        disabled={inert}
        aria-expanded={isExpanded}
        onClick={() => setExpanded(isExpanded ? null : hour.startMin)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          padding: '11px 6px 10px',
          borderRadius: '12px',
          fontFamily: 'inherit',
          cursor: inert ? 'default' : 'pointer',
          minWidth: 0,
          border: isExpanded ? '1.5px solid ' + c.accent : '0.5px solid ' + c.line,
          background: c.card,
          color: c.text,
          opacity: inert ? 0.38 : 1,
        }}
      >
        <span style={{ fontSize: '15px', fontWeight: 700 }}>{hour.label.slice(0, 2)}</span>
        {segmentBar(hour)}
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            opacity: 0.65,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {hourSummary(hour, open, t)}
        </span>
      </button>
    )
  }

  const quarterChip = (q: DaySlot): JSX.Element => {
    const busy = busyQuarters.includes(q.startMin)
    const tappable = q.state === 'open' || q.state === 'blocked'
    const sub =
      q.state === 'open'
        ? t.scheduleGridSlotFree
        : q.state === 'blocked'
          ? t.scheduleGridSlotBlocked
          : q.state === 'booked'
            ? (q.bookingLabel ?? t.scheduleGridSlotBooked)
            : q.state === 'past'
              ? t.scheduleGridSlotPast
              : t.scheduleGridSlotClosed
    return (
      <button
        key={q.startMin}
        type="button"
        disabled={!tappable || busy}
        onClick={() => void toggleQuarter(q)}
        aria-pressed={q.state === 'blocked'}
        aria-label={
          q.state === 'blocked'
            ? `${t.scheduleGridOpenHour} ${q.label}`
            : `${t.scheduleGridBlockHour} ${q.label} (${sub})`
        }
        style={quarterChipStyle(c, q.state, tappable, busy)}
      >
        <span style={{ fontSize: '14px', fontWeight: 700 }}>{q.label}</span>
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            opacity: 0.7,
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </span>
      </button>
    )
  }

  /** The expanded hour's quarter row + bulk actions, injected full-width under the hour grid. */
  const expandedPanel = (hour: HourGroup): JSX.Element => {
    const anyOpen = hour.quarters.some((q) => q.state === 'open')
    const anyBlocked = hour.quarters.some((q) => q.state === 'blocked')
    const endLabel = String(Number(hour.label.slice(0, 2)) + 1).padStart(2, '0')
    return (
      <div
        key={`x${hour.startMin}`}
        style={{
          gridColumn: '1 / -1',
          border: '0.5px solid ' + c.line,
          borderRadius: '12px',
          background: c.subtle,
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))',
            gap: '8px',
          }}
        >
          {hour.quarters.map(quarterChip)}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            style={{ ...s.primaryBtn, padding: '7px 12px', fontSize: '13px' }}
            onClick={() => {
              setReserveError(null)
              setReserveMin(hour.startMin)
            }}
          >
            {t.reserveBtn}
          </button>
          {anyOpen ? (
            <button
              type="button"
              style={{ ...s.ghostBtn, padding: '7px 12px', fontSize: '13px' }}
              onClick={() => void toggleHourBulk(hour, true)}
            >
              {`${t.scheduleGridBlockHour} ${hour.label.slice(0, 2)}–${endLabel}`}
            </button>
          ) : null}
          {anyBlocked ? (
            <button
              type="button"
              style={{ ...s.ghostBtn, padding: '7px 12px', fontSize: '13px' }}
              onClick={() => void toggleHourBulk(hour, false)}
            >
              {`${t.scheduleGridOpenHour} ${hour.label.slice(0, 2)}–${endLabel}`}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <section style={s.card} aria-labelledby="daygrid-heading">
      <h2 id="daygrid-heading" style={s.sectionTitle}>
        {t.scheduleGridHeading}
      </h2>
      <p style={s.sectionLead}>{t.scheduleGridLead}</p>

      {/* Day strip */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          padding: '12px 2px 10px',
          WebkitOverflowScrolling: 'touch',
        }}
        role="group"
        aria-label={t.scheduleGridAriaDayPicker}
      >
        {days.map(dayChip)}
      </div>

      {/* Hour grid / day-off state */}
      {blocks === null && error === null ? (
        <div style={s.emptyState}>{t.scheduleGridLoading}</div>
      ) : dayIsOff ? (
        <div
          style={{
            border: '0.5px dashed ' + c.inputLine,
            borderRadius: '12px',
            padding: '22px 18px',
            margin: '6px 0 12px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px' }}>
            {off !== undefined ? t.scheduleGridDayOff : t.scheduleGridNonWorkingDay}
          </div>
          <div style={{ ...s.mutedText, fontSize: '13px' }}>
            {off !== undefined
              ? off.reason !== ''
                ? off.reason
                : t.scheduleGridDayBlockedMsg
              : t.scheduleGridDayNotInWeekMsg}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))',
            gap: '8px',
            margin: '6px 0 12px',
          }}
        >
          {hours.flatMap((h) =>
            expanded === h.startMin ? [hourChip(h), expandedPanel(h)] : [hourChip(h)],
          )}
        </div>
      )}

      {/* Whole-day control + legend + errors */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginTop: '4px',
        }}
      >
        {inRangeOff ? (
          <span style={s.mutedText}>{t.scheduleGridRangeOffMsg}</span>
        ) : (
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: dayBusy ? 0.6 : 1 }}
            disabled={dayBusy}
            onClick={() => void toggleDay()}
          >
            {off !== undefined ? t.scheduleGridOpenDay : t.scheduleGridBlockDay}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {legendDot(c, 'open', t.scheduleGridLegendFree)}
          {legendDot(c, 'blocked', t.scheduleGridLegendBlocked)}
          {legendDot(c, 'booked', t.scheduleGridLegendBooked)}
          {legendDot(c, 'closed', t.scheduleGridLegendClosed)}
        </div>
      </div>
      <div aria-live="assertive" style={{ minHeight: '18px', marginTop: '8px' }}>
        {error !== null ? <span style={s.errorText}>{error}</span> : null}
      </div>

      {reserveMin !== null ? (
        <ReserveDialog
          dark={props.dark}
          lang={lang}
          timeLabel={reserveTimeLabel}
          busy={reserveBusy}
          serverError={reserveError}
          onSubmit={(fields) => void onReserveSubmit(fields)}
          onClose={() => {
            if (!reserveBusy) {
              setReserveMin(null)
              setReserveError(null)
            }
          }}
        />
      ) : null}
    </section>
  )
}

/** One-word summary under the hour label. */
function hourSummary(hour: HourGroup, open: number, strings: AdminStrings): string {
  const qs = hour.quarters
  if (qs.every((q) => q.state === 'closed')) return strings.scheduleGridSlotClosed
  const bookedLabel = qs.find((q) => q.bookingLabel !== null)?.bookingLabel
  if (bookedLabel !== undefined && bookedLabel !== null) return bookedLabel
  if (open > 0) return `${open}/4 ${strings.scheduleGridFreeCountSuffix}`
  if (qs.some((q) => q.state === 'blocked')) return strings.scheduleGridSlotBlocked
  return strings.scheduleGridSlotPast
}

/** Mini-bar segment colors per state (fills match the quarter chips). */
function segmentColor(c: Palette, state: SlotState): JSX.CSSProperties {
  switch (state) {
    case 'open':
      return {
        background: 'transparent',
        border: '1px solid ' + c.inputLine,
        boxSizing: 'border-box',
      }
    case 'blocked':
      return { background: c.accent }
    case 'booked':
      return { background: c.dot }
    case 'past':
    case 'closed':
      return { background: c.line }
  }
}

/** Chip style per quarter state — filled accent = blocked, outlined = open, muted = inert. */
function quarterChipStyle(
  c: Palette,
  state: SlotState,
  tappable: boolean,
  busy: boolean,
): JSX.CSSProperties {
  const base: JSX.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    padding: '10px 6px',
    borderRadius: '11px',
    fontFamily: 'inherit',
    cursor: tappable && !busy ? 'pointer' : 'default',
    opacity: busy ? 0.55 : 1,
    minWidth: 0,
  }
  switch (state) {
    case 'open':
      return { ...base, border: '0.5px solid ' + c.inputLine, background: c.card, color: c.text }
    case 'blocked':
      return {
        ...base,
        border: '0.5px solid ' + c.accent,
        background: c.accent,
        color: c.accentText,
      }
    case 'booked':
      return { ...base, border: '0.5px solid ' + c.line, background: c.bg, color: c.text }
    case 'past':
      return {
        ...base,
        border: '0.5px solid ' + c.line,
        background: 'transparent',
        color: c.text,
        opacity: busy ? 0.55 : 0.4,
      }
    case 'closed':
      return {
        ...base,
        border: '0.5px dashed ' + c.line,
        background: 'transparent',
        color: c.text,
        opacity: busy ? 0.55 : 0.4,
      }
  }
}

/** One legend entry (a state-coloured dot + label). */
function legendDot(c: Palette, state: SlotState, label: string): JSX.Element {
  const bg =
    state === 'open' ? c.card : state === 'blocked' ? c.accent : state === 'booked' ? c.dot : c.line
  const border = state === 'open' ? '0.5px solid ' + c.inputLine : '0.5px solid ' + c.line
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px' }}>
      <span
        style={{ width: '10px', height: '10px', borderRadius: '50%', background: bg, border }}
      />
      <span style={{ opacity: 0.65, fontWeight: 600 }}>{label}</span>
    </span>
  )
}

/** Confirmed bookings on one salon-local date, mapped to the day's minute line. */
function dayBookings(bookings: readonly AdminBooking[], dateIso: string): readonly DayBooking[] {
  const out: DayBooking[] = []
  for (const b of bookings) {
    if (b.status !== 'confirmed') continue
    const wall = stockholmWallClockDate(b.startAt)
    if (toDateIso(wall) !== dateIso) continue
    const startMin = wall.getHours() * 60 + wall.getMinutes()
    out.push({
      startMin,
      endMin: startMin + b.durationMin,
      label: b.customerName.trim().split(/\s+/)[0] ?? 'Bokad',
    })
  }
  return out
}

/** Parse `YYYY-MM-DD` into a LOCAL-midnight Date (never UTC-shifts the weekday). */
function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}
