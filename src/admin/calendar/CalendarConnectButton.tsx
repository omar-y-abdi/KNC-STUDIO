// The "Koppla kalender" panel shown in a barber's own "Mina bokningar". Renders the connection state
// and the connect / disconnect action via useCalendarSync. Owner views never render this (an owner
// cannot consent for a barber's Google account) — the gate lives in the caller (BookingsView prop).

import type { JSX } from 'preact'
import { palette } from '../../booking/bookingStyles'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import type { AdminStylesBundle } from '../views/viewTypes'
import { useCalendarSync } from './useCalendarSync'

export interface CalendarConnectButtonProps {
  readonly s: AdminStylesBundle
  readonly dark: boolean
  readonly lang: Lang
}

export function CalendarConnectButton(props: CalendarConnectButtonProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const c = palette(props.dark)
  const cal = useCalendarSync()

  const box: JSX.CSSProperties = {
    border: '0.5px solid ' + c.line,
    borderRadius: '12px',
    background: c.subtle,
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    margin: '10px 0 2px',
  }

  const heading = (main: string, sub: string | null): JSX.Element => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <span style={{ fontSize: '14px', fontWeight: 700 }}>{main}</span>
      {sub !== null ? <span style={{ ...s.mutedText, fontSize: '12.5px' }}>{sub}</span> : null}
    </div>
  )

  if (cal.loading) {
    return <div style={box}>{heading(t.calendarLoading, null)}</div>
  }

  const status = cal.status
  const connected = status?.connected === true
  const disconnectPending = status?.disconnectPending === true
  const repairRequired = status?.repairRequired === true

  return (
    <div style={box}>
      {connected && repairRequired
        ? heading('✓ ' + t.calendarConnected, t.calendarRepairHint)
        : connected
          ? heading('✓ ' + t.calendarConnected, status?.googleEmail ?? null)
          : disconnectPending
            ? heading(
                t.calendarDisconnecting,
                repairRequired ? t.calendarRepairHint : t.calendarDisconnectPending,
              )
            : heading('Google Calendar', t.calendarHint)}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
        {repairRequired ? (
          <button
            type="button"
            style={{ ...s.primaryBtn, opacity: cal.busy ? 0.6 : 1 }}
            disabled={cal.busy}
            onClick={() => void cal.connect()}
          >
            {cal.busy ? t.calendarConnecting : t.calendarRepairAccess}
          </button>
        ) : connected ? (
          <>
            <a
              href="https://calendar.google.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                ...s.ghostBtn,
                display: 'inline-block',
                textAlign: 'center',
                textDecoration: 'none',
              }}
            >
              {t.calendarOpenApp}
            </a>
            <button
              type="button"
              style={{ ...s.ghostBtn, opacity: cal.busy ? 0.6 : 1 }}
              disabled={cal.busy}
              onClick={() => void cal.disconnect()}
            >
              {cal.busy ? t.calendarDisconnecting : t.calendarDisconnect}
            </button>
          </>
        ) : disconnectPending ? null : (
          <button
            type="button"
            style={{ ...s.primaryBtn, opacity: cal.busy ? 0.6 : 1 }}
            disabled={cal.busy}
            onClick={() => void cal.connect()}
          >
            {cal.busy ? t.calendarConnecting : t.calendarConnect}
          </button>
        )}
        {cal.error !== null ? <span style={s.errorText}>{cal.error}</span> : null}
        {connected && status !== null && status.lastSyncError !== null ? (
          <span style={s.errorText}>
            {t.calendarSyncErrorPrefix} {status.lastSyncError}
          </span>
        ) : null}
      </div>
    </div>
  )
}
