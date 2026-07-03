// The day grid — the schedule tab's primary surface. One horizontal strip of upcoming days, then
// the salon's 12 fixed slots for the chosen day as tappable chips:
//   tap an OPEN slot    -> block it (walk-in/text booking), saved instantly, no extra steps
//   tap a BLOCKED slot  -> reopen it
//   BOOKED slots show the customer's first name (cancel lives in the bookings tab)
//   CLOSED/PAST slots are inert (off-day, outside hours, time off, or already started)
// One button covers the whole-day case ("Blockera hela dagen" <-> "Öppna dagen"), backed by a
// single-day time-off row so the public availability RPC needs no special case.
//
// Writes are optimistic: the chip flips immediately, reverts (with an aria-live error) on failure.
// The slot-state math is pure (`daySlots` in ../time.ts); this file owns only fetch + tap effects.

import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { cap, monthLabel, weekdayLabel } from '../../booking/calendar'
import { defaultClock } from '../../config'
import type { Lang } from '../../i18n/index'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { listBookings } from '../adapters/bookingsAdmin'
import { addSlotBlock, deleteSlotBlock, listSlotBlocks } from '../adapters/slotBlocksAdmin'
import type { Palette } from '../../booking/bookingStyles'
import { SLOT_LEN_MIN, daySlots, timeOffCovering, toDateIso, upcomingDates } from '../time'
import type { DayBooking, DaySlot, SlotState } from '../time'
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
  const today = defaultClock()
  const days = useMemo(() => upcomingDates(today, STRIP_DAYS), [toDateIso(today)])
  const todayIso = toDateIso(today)

  const [dateIso, setDateIso] = useState(todayIso)
  const [blocks, setBlocks] = useState<readonly SlotBlock[] | null>(null)
  const [bookings, setBookings] = useState<readonly AdminBooking[]>([])
  const [busySlots, setBusySlots] = useState<readonly number[]>([])
  const [dayBusy, setDayBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [props.barberId])

  const off = timeOffCovering(props.timeOff, dateIso)
  const slots = useMemo((): readonly DaySlot[] => {
    const selected = parseIsoLocal(dateIso)
    const now = defaultClock()
    const pastCutoffMin = dateIso === toDateIso(now) ? now.getHours() * 60 + now.getMinutes() : 0
    return daySlots({
      day: props.week[selected.getDay()],
      dayOff: off !== undefined,
      blocks: blocks ?? [],
      bookings: dayBookings(bookings, dateIso),
      pastCutoffMin,
    })
  }, [props.week, off, blocks, bookings, dateIso])

  const toggleSlot = async (slot: DaySlot): Promise<void> => {
    if (busySlots.includes(slot.startMin)) return
    setBusySlots((prev) => [...prev, slot.startMin])
    setError(null)
    const result =
      slot.state === 'blocked' && slot.blockId !== null
        ? await deleteSlotBlock(slot.blockId).then((r) => {
            if (r.ok) setBlocks((prev) => (prev ?? []).filter((b) => b.id !== slot.blockId))
            return r
          })
        : await addSlotBlock(
            props.barberId,
            dateIso,
            slot.startMin,
            slot.startMin + SLOT_LEN_MIN,
          ).then((r) => {
            if (r.ok) setBlocks((prev) => [...(prev ?? []), r.value])
            return r
          })
    setBusySlots((prev) => prev.filter((m) => m !== slot.startMin))
    if (!result.ok) setError(result.error.message)
  }

  const toggleDay = async (): Promise<void> => {
    setDayBusy(true)
    setError(null)
    const ok =
      off !== undefined && off.startDate === off.endDate
        ? await props.onOpenDay(off.id)
        : await props.onBlockDay(dateIso)
    setDayBusy(false)
    if (!ok) setError('Kunde inte spara. Försök igen.')
  }

  // Whole-day control: single-day off -> reopen; range off -> managed under Ledighet; else block.
  const inRangeOff = off !== undefined && off.startDate !== off.endDate

  const dayChip = (d: Date): JSX.Element => {
    const iso = toDateIso(d)
    const on = iso === dateIso
    return (
      <button
        key={iso}
        type="button"
        onClick={() => setDateIso(iso)}
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
          {iso === todayIso ? 'Idag' : cap(weekdayLabel(lang, d.getDay()).slice(0, 3))}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 700 }}>
          {d.getDate()} {cap(monthLabel(lang, d.getMonth()).slice(0, 3))}
        </span>
      </button>
    )
  }

  const slotChip = (slot: DaySlot): JSX.Element => {
    const busy = busySlots.includes(slot.startMin)
    const tappable = slot.state === 'open' || slot.state === 'blocked'
    const sub =
      slot.state === 'open'
        ? 'Ledig'
        : slot.state === 'blocked'
          ? 'Blockerad'
          : slot.state === 'booked'
            ? (slot.bookingLabel ?? 'Bokad')
            : slot.state === 'past'
              ? 'Passerad'
              : 'Stängt'
    return (
      <button
        key={slot.startMin}
        type="button"
        disabled={!tappable || busy}
        onClick={() => void toggleSlot(slot)}
        aria-pressed={slot.state === 'blocked'}
        aria-label={
          slot.state === 'blocked' ? `Öppna ${slot.label}` : `Blockera ${slot.label} (${sub})`
        }
        style={slotChipStyle(c, slot.state, tappable, busy)}
      >
        <span style={{ fontSize: '14px', fontWeight: 700 }}>{slot.label}</span>
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

  return (
    <section style={s.card} aria-labelledby="daygrid-heading">
      <h2 id="daygrid-heading" style={s.sectionTitle}>
        Dagsöversikt
      </h2>
      <p style={s.sectionLead}>
        Tryck på en ledig tid för att blockera den (t.ex. bokad via sms) — sparas direkt. Tryck igen
        för att öppna den.
      </p>

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
        aria-label="Välj dag"
      >
        {days.map(dayChip)}
      </div>

      {/* Slot grid */}
      {blocks === null && error === null ? (
        <div style={s.emptyState}>Laddar …</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
            gap: '8px',
            margin: '6px 0 12px',
          }}
        >
          {slots.map(slotChip)}
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
          <span style={s.mutedText}>
            Dagen ingår i en ledighetsperiod — hantera den under Ledighet.
          </span>
        ) : (
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: dayBusy ? 0.6 : 1 }}
            disabled={dayBusy}
            onClick={() => void toggleDay()}
          >
            {off !== undefined ? 'Öppna dagen' : 'Blockera hela dagen'}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {legendDot(c, 'open', 'Ledig')}
          {legendDot(c, 'blocked', 'Blockerad')}
          {legendDot(c, 'booked', 'Bokad')}
          {legendDot(c, 'closed', 'Stängt')}
        </div>
      </div>
      <div aria-live="assertive" style={{ minHeight: '18px', marginTop: '8px' }}>
        {error !== null ? <span style={s.errorText}>{error}</span> : null}
      </div>
    </section>
  )
}

/** Chip style per slot state — filled accent = blocked, outlined = open, muted = inert. */
function slotChipStyle(
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
      return { ...base, border: '0.5px solid ' + c.line, background: c.subtle, color: c.text }
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
    state === 'open'
      ? c.card
      : state === 'blocked'
        ? c.accent
        : state === 'booked'
          ? c.subtle
          : c.dot
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
