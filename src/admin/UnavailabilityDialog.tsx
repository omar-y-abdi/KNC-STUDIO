// Unavailability ↔ booking conflict popup (Task 3). Shown when a barber marks themselves off (block a
// day, change the veckoschema, or add ledighet) over a time that has CONFIRMED bookings. It lists the
// clashing customers and offers three explained choices:
//   • Avboka kunder            → cancel those bookings and become free
//   • Ha kvar kunder, blockera resten → keep the bookings; block the rest of the time for new bookings
//   • Avbryt                   → do nothing (the caller reverts its pending change)
// Built on the shared accessible Dialog + admin styles, like ReserveDialog. Parent owns the effects.

import type { JSX } from 'preact'
import { Dialog } from '../ui/Dialog'
import { palette } from '../booking/bookingStyles'
import { formatWhenLabel } from '../booking/calendar'
import { stockholmWallClockDate } from '../booking/stockholmTime'
import { buildAdminStyles } from './adminStyles'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import type { AdminBooking } from './types'
import type { CancelFailure } from './useUnavailabilityConflict'

const TITLE_ID = 'admin-unavail-title'

export interface UnavailabilityDialogProps {
  readonly dark: boolean
  readonly lang: Lang
  /** The confirmed bookings that clash with the requested unavailability. */
  readonly bookings: readonly AdminBooking[]
  /** Cancellation in flight (disables the actions, relabels the cancel button). */
  readonly busy: boolean
  /** A partial-cancellation failure to surface (N of M cancelled); null when none. */
  readonly error: CancelFailure | null
  readonly onCancelCustomers: () => void
  readonly onKeepBlock: () => void
  readonly onAbort: () => void
}

export function UnavailabilityDialog(props: UnavailabilityDialogProps): JSX.Element {
  const c = palette(props.dark)
  const s = buildAdminStyles(c, props.dark)
  const t = adminText(props.lang)

  const backdropStyle =
    'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
    'padding:20px;background:rgba(0,0,0,.42);'
  const cardStyle: JSX.CSSProperties = {
    width: '100%',
    maxWidth: '420px',
    maxHeight: '86vh',
    overflowY: 'auto',
    background: c.bg,
    color: c.text,
    border: '0.5px solid ' + c.line,
    borderRadius: '16px',
    padding: '20px 22px',
    boxShadow: '0 24px 60px rgba(0,0,0,.4)',
    fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
  }

  const onBackdropClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && !props.busy) props.onAbort()
  }

  const stackBtn = (base: JSX.CSSProperties): JSX.CSSProperties => ({
    ...base,
    width: '100%',
    justifyContent: 'center',
    opacity: props.busy ? 0.6 : 1,
    cursor: props.busy ? 'default' : 'pointer',
  })

  return (
    <Dialog
      titleId={TITLE_ID}
      onClose={props.onAbort}
      onBackdropClick={onBackdropClick}
      backdropStyle={backdropStyle}
      backdropClass="knc-admin-unavail-backdrop"
      cardStyle={cardStyle}
      cardClass="knc-admin-unavail-card"
    >
      <h2
        id={TITLE_ID}
        style={{
          fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
          fontSize: '17px',
          fontWeight: 700,
          margin: '0 0 4px',
        }}
      >
        {t.unavailTitle}
      </h2>
      <p style={{ margin: '0 0 12px', fontSize: '13px', opacity: 0.6, lineHeight: 1.45 }}>
        {t.unavailLead}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '16px' }}>
        {props.bookings.map((b) => (
          <div
            key={b.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '10px',
              border: '0.5px solid ' + c.line,
              borderRadius: '10px',
              background: c.card,
              padding: '9px 12px',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '14px' }}>{b.customerName}</span>
            <span style={{ fontSize: '12.5px', opacity: 0.6, textAlign: 'right' }}>
              {formatWhenLabel(props.lang, stockholmWallClockDate(b.startAt))}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          margin: '0 0 16px',
          fontSize: '12.5px',
          opacity: 0.72,
          lineHeight: 1.45,
        }}
      >
        <span>{t.unavailExplainCancel}</span>
        <span>{t.unavailExplainKeep}</span>
      </div>

      {props.error !== null ? (
        <p style={{ ...s.errorText, margin: '0 0 14px', lineHeight: 1.45 }}>
          {t.unavailCancelError
            .replace('{done}', String(props.error.done))
            .replace('{total}', String(props.error.total))}
        </p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        <button
          type="button"
          style={stackBtn(s.dangerBtn)}
          onClick={props.onCancelCustomers}
          disabled={props.busy}
        >
          {props.busy ? t.unavailBusy : t.unavailCancelBtn}
        </button>
        <button
          type="button"
          style={stackBtn(s.primaryBtn)}
          onClick={props.onKeepBlock}
          disabled={props.busy}
        >
          {t.unavailKeepBtn}
        </button>
        <button
          type="button"
          style={stackBtn(s.ghostBtn)}
          onClick={props.onAbort}
          disabled={props.busy}
        >
          {t.unavailAbortBtn}
        </button>
      </div>
    </Dialog>
  )
}
