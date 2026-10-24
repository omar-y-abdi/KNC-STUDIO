// The Ledighet card: block a date range (vacation) with add/remove. Presentation + the form fields
// only; the write, its booking-conflict check and the delete confirmation belong to the caller (the
// day grid's "Blockera hela dagen" writes a single-day row through the same handlers).

import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { cap, monthLabel, parseDateIso } from '../../booking/calendar'
import { defaultClock } from '../../config'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { toDateIso } from '../time'
import { useNarrow } from '../chrome'
import type { AdminStylesBundle, StatusMessage, TimeOff } from './viewTypes'

export interface TimeOffCardProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly timeOff: readonly TimeOff[]
  /** An add is in flight. */
  readonly busy: boolean
  readonly message: StatusMessage | null
  /**
   * Add the range described by the form. The caller runs the conflict check and the write, and calls
   * `onApplied` once the range is stored (immediately, or after the conflict dialog was answered).
   */
  readonly onAdd: (
    startDate: string,
    endDate: string,
    reason: string,
    onApplied: () => void,
  ) => void
  /** The barber asked to remove a range (the caller confirms before deleting). */
  readonly onRequestRemove: (off: TimeOff) => void
}

/** `2026-08-14` -> "14 Aug" using the localized month label (date-only, salon-local). */
function isoToLabel(lang: Lang, iso: string): string {
  const parts = parseDateIso(iso)
  if (parts === null) return iso
  const date = new Date(parts.year, parts.month - 1, parts.day)
  return `${date.getDate()} ${cap(monthLabel(lang, date.getMonth()))}`
}

/** "14 Aug" for a single day, "14 Aug – 21 Aug" for a range. */
export function timeOffRangeLabel(lang: Lang, off: TimeOff): string {
  const start = isoToLabel(lang, off.startDate)
  if (off.startDate === off.endDate) return start
  return `${start} – ${isoToLabel(lang, off.endDate)}`
}

export function TimeOffCard(props: TimeOffCardProps): JSX.Element {
  const { s, lang, timeOff } = props
  const t = adminText(lang)
  const narrow = useNarrow()
  const offBusy = props.busy
  const offMsg = props.message

  const [offStart, setOffStart] = useState(() => toDateIso(defaultClock()))
  const [offEnd, setOffEnd] = useState(() => toDateIso(defaultClock()))
  const [offReason, setOffReason] = useState('')

  const rangeLabel = (off: TimeOff): string => timeOffRangeLabel(lang, off)

  return (
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
          onClick={() => props.onAdd(offStart, offEnd, offReason, () => setOffReason(''))}
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
                onClick={() => props.onRequestRemove(off)}
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
                    <button
                      type="button"
                      style={s.dangerBtn}
                      onClick={() => props.onRequestRemove(off)}
                    >
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
  )
}
