// The recurring-breaks block of the Veckoschema card: a weekly locked period (e.g. lunch) that is
// removed from availability on that weekday. Presentation + the form fields only; the write, its
// booking-conflict check and the delete confirmation belong to the caller. Rendered INSIDE
// WeekHoursCard (it shares the card's <section>), below the day rows.

import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { cap, weekdayLabel } from '../../booking/calendar'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { END_OPTIONS, START_OPTIONS, minutesToHHMM } from '../time'
import { DISPLAY_ORDER } from './WeekHoursCard'
import type { AdminStylesBundle, RecurringBreak, StatusMessage, Weekday } from './viewTypes'

export interface RecurringBreaksFormProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly breaks: readonly RecurringBreak[]
  /** An add is in flight. */
  readonly busy: boolean
  readonly message: StatusMessage | null
  /** Add the break described by the form. The caller runs the conflict check and the write. */
  readonly onAdd: (weekday: Weekday, startMin: number, endMin: number) => void
  /** The barber asked to remove a break (the caller confirms before deleting). */
  readonly onRequestRemove: (item: RecurringBreak) => void
}

export function RecurringBreaksForm(props: RecurringBreaksFormProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  const recurringBreaks = props.breaks
  const recurringBusy = props.busy
  const recurringMsg = props.message

  // Open straight away when this barber already has breaks (the card mounts once the breaks loaded).
  const [showRecurringBreakForm, setShowRecurringBreakForm] = useState(recurringBreaks.length > 0)
  const [recurringWeekday, setRecurringWeekday] = useState<Weekday>(1)
  const [recurringStart, setRecurringStart] = useState(720)
  const [recurringEnd, setRecurringEnd] = useState(780)

  return (
    <div
      style={{
        border: s.card.border,
        borderRadius: '12px',
        padding: '12px 13px',
        marginTop: '14px',
      }}
    >
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
        <input
          type="checkbox"
          checked={showRecurringBreakForm}
          onInput={(e) => setShowRecurringBreakForm(e.currentTarget.checked)}
        />
        <span style={{ fontSize: '13px', fontWeight: 600 }}>{t.scheduleRecurringBreakToggle}</span>
      </label>
      <p style={{ ...s.mutedText, fontSize: '12.5px', margin: '7px 0 0' }}>
        {t.scheduleRecurringBreakLead}
      </p>

      {showRecurringBreakForm ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '10px 12px',
            marginTop: '12px',
          }}
        >
          <label>
            <span style={s.label}>{t.scheduleRecurringBreakDay}</span>
            <select
              style={s.select}
              value={recurringWeekday}
              onChange={(e) => setRecurringWeekday(Number(e.currentTarget.value) as Weekday)}
            >
              {DISPLAY_ORDER.map((weekday) => (
                <option key={weekday} value={weekday}>
                  {cap(weekdayLabel(lang, weekday))}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={s.label}>{t.scheduleFrom}</span>
            <select
              style={s.select}
              value={recurringStart}
              onChange={(e) => setRecurringStart(Number(e.currentTarget.value))}
            >
              {START_OPTIONS.map((option) => (
                <option key={option.min} value={option.min}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={s.label}>{t.scheduleTo}</span>
            <select
              style={s.select}
              value={recurringEnd}
              onChange={(e) => setRecurringEnd(Number(e.currentTarget.value))}
            >
              {END_OPTIONS.map((option) => (
                <option key={option.min} value={option.min}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: recurringBusy ? 0.6 : 1 }}
            disabled={recurringBusy || recurringEnd <= recurringStart}
            onClick={() => props.onAdd(recurringWeekday, recurringStart, recurringEnd)}
          >
            {recurringBusy ? t.scheduleRecurringBreakAdding : t.scheduleRecurringBreakAdd}
          </button>
        </div>
      ) : null}

      <div aria-live="polite" style={{ minHeight: '18px', marginTop: '9px' }}>
        {recurringMsg !== null ? (
          <span style={recurringMsg.kind === 'ok' ? s.successText : s.errorText}>
            {recurringMsg.text}
          </span>
        ) : null}
      </div>

      {recurringBreaks.length === 0 ? (
        <span style={{ ...s.mutedText, fontSize: '12.5px' }}>{t.scheduleRecurringBreakEmpty}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '4px' }}>
          {recurringBreaks.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                paddingTop: '7px',
                borderTop: s.card.border,
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600 }}>
                {cap(weekdayLabel(lang, item.weekday))} · {minutesToHHMM(item.startMin)}–
                {minutesToHHMM(item.endMin)}
              </span>
              <button
                type="button"
                style={{ ...s.dangerBtn, padding: '6px 10px', fontSize: '12px' }}
                onClick={() => props.onRequestRemove(item)}
              >
                {t.scheduleRecurringBreakRemove}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
