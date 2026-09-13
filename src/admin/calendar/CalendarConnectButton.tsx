// The "Koppla kalender" panel shown in a barber's own "Mina bokningar". Renders the connection state
// and the connect / disconnect action via useCalendarSync. Owner views never render this (an owner
// cannot consent for a barber's Google account) — the gate lives in the caller (BookingsView prop).

import type { JSX } from 'preact'
import { palette } from '../../booking/bookingStyles'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import type { AdminStylesBundle } from '../views/viewTypes'
import type { CalendarSyncPort } from './port'
import { useCalendarSync } from './useCalendarSync'

export interface CalendarConnectButtonProps {
  readonly s: AdminStylesBundle
  readonly dark: boolean
  readonly lang: Lang
  readonly port?: CalendarSyncPort
}

export function CalendarConnectButton(props: CalendarConnectButtonProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const c = palette(props.dark)
  const cal = useCalendarSync(props.port)

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
    <div
      role="status"
      style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}
    >
      <span style={{ fontSize: '14px', fontWeight: 700 }}>{main}</span>
      {sub !== null ? <span style={{ ...s.mutedText, fontSize: '12.5px' }}>{sub}</span> : null}
    </div>
  )

  const status = cal.status
  const connected = status?.connected === true
  const disconnectPending = status?.disconnectPending === true
  const repairRequired = status?.repairRequired === true
  const disabled = cal.busy || cal.loading

  return (
    <div style={box}>
      {status === null
        ? heading(cal.loading ? t.calendarLoading : t.calendarStatusUnavailable, null)
        : disconnectPending
          ? heading(
              t.calendarDisconnecting,
              repairRequired ? t.calendarRepairHint : t.calendarDisconnectPending,
            )
          : connected
            ? heading(
                '✓ ' + t.calendarConnected,
                repairRequired ? t.calendarRepairHint : status.googleEmail,
              )
            : heading('Google Calendar', t.calendarHint)}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
        {status === null ? null : repairRequired ? (
          <button
            type="button"
            style={{ ...s.primaryBtn, opacity: disabled ? 0.6 : 1 }}
            disabled={disabled}
            onClick={() => void cal.connect()}
          >
            {cal.busy ? t.calendarConnecting : t.calendarRepairAccess}
          </button>
        ) : disconnectPending ? null : connected ? (
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
              style={{ ...s.ghostBtn, opacity: disabled ? 0.6 : 1 }}
              disabled={disabled}
              onClick={() => void cal.disconnect()}
            >
              {cal.busy ? t.calendarDisconnecting : t.calendarDisconnect}
            </button>
          </>
        ) : (
          <button
            type="button"
            style={{ ...s.primaryBtn, opacity: disabled ? 0.6 : 1 }}
            disabled={disabled}
            onClick={() => void cal.connect()}
          >
            {cal.busy ? t.calendarConnecting : t.calendarConnect}
          </button>
        )}
        {disconnectPending || cal.error !== null ? (
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: disabled ? 0.6 : 1 }}
            disabled={disabled}
            onClick={() => void cal.refresh()}
          >
            {cal.loading ? t.calendarLoading : t.calendarRefresh}
          </button>
        ) : null}
        {cal.error !== null ? (
          <span role="alert" style={s.errorText}>
            {cal.error === 'status' ? t.calendarStatusError : t.calendarActionError}
          </span>
        ) : null}
        {connected && status !== null && status.lastSyncError !== null ? (
          <span style={s.errorText}>
            {t.calendarSyncErrorPrefix} {status.lastSyncError}
          </span>
        ) : null}
      </div>
    </div>
  )
}
