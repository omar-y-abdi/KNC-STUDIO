// The "these customers were cancelled" popup (Task 3), shown after "Avboka kunder" completes. Same
// framed-row aesthetic as the customer "Mina bokningar" dialog, but admin-side: each row shows the
// customer, the appointment time, the service (duration + price), and a tappable phone number (tel:) so the barber can
// reach them if staff need follow-up. Read-only + a close.

import type { JSX } from 'preact'
import { Dialog } from '../ui/Dialog'
import { palette } from '../booking/bookingStyles'
import { formatWhenLabel } from '../booking/calendar'
import { stockholmWallClockDate } from '../booking/stockholmTime'
import { buildAdminStyles } from './adminStyles'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import type { AdminBooking } from './types'

const TITLE_ID = 'admin-cancelled-title'

export interface CancelledCustomersDialogProps {
  readonly dark: boolean
  readonly lang: Lang
  /** The bookings that were just cancelled. */
  readonly bookings: readonly AdminBooking[]
  readonly onClose: () => void
}

export function CancelledCustomersDialog(props: CancelledCustomersDialogProps): JSX.Element {
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
    if (e.target === e.currentTarget) props.onClose()
  }

  return (
    <Dialog
      titleId={TITLE_ID}
      onClose={props.onClose}
      onBackdropClick={onBackdropClick}
      backdropStyle={backdropStyle}
      backdropClass="knc-admin-cancelled-backdrop"
      cardStyle={cardStyle}
      cardClass="knc-admin-cancelled-card"
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
        {t.unavailCancelledTitle}
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: '13px', opacity: 0.6, lineHeight: 1.45 }}>
        {t.unavailCancelledLead}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
        {props.bookings.map((b) => (
          <div
            key={b.id}
            style={{
              border: '0.5px solid ' + c.line,
              borderRadius: '12px',
              background: c.card,
              padding: '11px 13px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '10px',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '14.5px' }}>{b.customerName}</span>
              <span style={{ fontSize: '12.5px', opacity: 0.6, textAlign: 'right' }}>
                {formatWhenLabel(props.lang, stockholmWallClockDate(b.startAt))}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '10px',
                marginTop: '4px',
              }}
            >
              <span style={{ fontSize: '12.5px', opacity: 0.55, minWidth: 0 }}>
                {b.serviceName} · {b.durationMin} min · {b.price} kr
              </span>
              {b.phone !== null ? (
                <a
                  href={'tel:' + b.phone}
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: c.text,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                  }}
                >
                  {b.phone}
                </a>
              ) : (
                <span
                  style={{ fontSize: '12.5px', opacity: 0.4, whiteSpace: 'nowrap', flex: 'none' }}
                >
                  {t.unavailNoPhone}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" style={s.primaryBtn} onClick={props.onClose}>
          {t.unavailClose}
        </button>
      </div>
    </Dialog>
  )
}
