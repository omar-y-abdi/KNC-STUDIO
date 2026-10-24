// The Veckoschema card: which weekdays the barber works and the hours of each. Presentation only —
// it builds the next week with the pure reducers from `../time` and hands it to `onChange`; the
// autosave pipeline (useWeekAutosave) and its conflict check live in the caller. The save status
// renders as the card's one aria-live line, with a retry button after a failed save.
//
// `children` render inside the card below the day rows (the recurring-breaks block shares this card).

import type { ComponentChildren, JSX } from 'preact'
import { useState } from 'preact/hooks'
import { cap, weekdayLabel } from '../../booking/calendar'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import {
  DEFAULT_END_MIN,
  DEFAULT_START_MIN,
  END_OPTIONS,
  START_OPTIONS,
  sameTimeAllDays,
  setDayHours,
  toggleWorking,
} from '../time'
import { WorkSwitch, useNarrow } from '../chrome'
import type { WeekSave } from './useWeekAutosave'
import type { AdminStylesBundle, Weekday, WeekSchedule } from './viewTypes'

/** Weekday order for display: Monday-first (1..6, then 0=Sunday) reads naturally for a work week. */
export const DISPLAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

export interface WeekHoursCardProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  /** Display name used by the card heading. */
  readonly barberName: string
  readonly week: WeekSchedule
  readonly status: WeekSave
  /** A week edit, already built from the current week (the caller decides how it is saved). */
  readonly onChange: (next: WeekSchedule) => void
  /** Save the current week again after a failed save. */
  readonly onRetry: () => void
  readonly children?: ComponentChildren
}

export function WeekHoursCard(props: WeekHoursCardProps): JSX.Element {
  const { s, lang, week } = props
  const t = adminText(lang)
  const narrow = useNarrow()
  const weekSave = props.status

  // "Same time all days" bound inputs (default to the salon day 09:00–18:00).
  const [bulkStart, setBulkStart] = useState(DEFAULT_START_MIN)
  const [bulkEnd, setBulkEnd] = useState(DEFAULT_END_MIN)

  const onToggleDay = (weekday: Weekday): void => props.onChange(toggleWorking(week, weekday))
  const onDayStart = (weekday: Weekday, startMin: number): void => {
    const day = week[weekday]
    props.onChange(setDayHours(week, weekday, startMin, day?.endMin ?? DEFAULT_END_MIN))
  }
  const onDayEnd = (weekday: Weekday, endMin: number): void => {
    const day = week[weekday]
    props.onChange(setDayHours(week, weekday, day?.startMin ?? DEFAULT_START_MIN, endMin))
  }
  const applyAllDays = (): void => props.onChange(sameTimeAllDays(week, bulkStart, bulkEnd))

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
              onClick={() => props.onRetry()}
            >
              {t.scheduleRetry}
            </button>
          </span>
        )
    }
  }

  return (
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

      {props.children}
    </section>
  )
}
