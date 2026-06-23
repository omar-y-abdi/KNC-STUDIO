// Bookings view. Shows the selected barber's bookings split into UPCOMING and PAST, each cancellable
// (confirm dialog -> admin_cancel_booking RPC). For the OWNER an `allBarbers` flag lists every
// barber's bookings ("Alla bokningar"); the barber selector in the shell drives `barberId` otherwise.
// The view always makes WHOSE bookings these are explicit via its heading + the shell's banner.
//
// Data effects (load/cancel) are isolated in this component; the table + dialog are otherwise pure.
// Optimistic-feel: on a successful cancel we update the row status locally and surface an aria-live
// success line; on error we show the error and leave the data intact.

import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { cap, monthLabel, pad2, weekdayLabel } from '../../booking/calendar'
import type { Lang } from '../../i18n/index'
import { cancelBooking, listBookings } from '../adapters/bookingsAdmin'
import { ConfirmDialog } from '../ConfirmDialog'
import type { AdminBarber, AdminBarberId, AdminBooking, AdminStylesBundle } from './viewTypes'

export interface BookingsViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  /** Which barber's bookings to show; ignored when `allBarbers` is true. */
  readonly barberId: AdminBarberId | null
  /** Owner-only: show every barber's bookings (the "Alla bokningar" tab). */
  readonly allBarbers: boolean
  /** Roster, to resolve a booking's barber id -> name (owner "all" view). */
  readonly barbers: readonly AdminBarber[]
  /** Heading shown above the tables (e.g. "Mina bokningar" / "Alla bokningar"). */
  readonly heading: string
  readonly lead: string
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly bookings: readonly AdminBooking[] }

/** "Tors 14 Aug, 11:15" — localized weekday + day + month + zero-padded time. */
function whenLabel(lang: Lang, d: Date): string {
  return (
    cap(weekdayLabel(lang, d.getDay())) +
    ' ' +
    d.getDate() +
    ' ' +
    monthLabel(lang, d.getMonth()) +
    ', ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes())
  )
}

export function BookingsView(props: BookingsViewProps): JSX.Element {
  const { s, lang } = props
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [pendingCancel, setPendingCancel] = useState<AdminBooking | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Reload whenever the target (barber / all) changes.
  useEffect(() => {
    let active = true
    setLoad({ kind: 'loading' })
    setNotice(null)
    const target = props.allBarbers ? undefined : (props.barberId ?? undefined)
    void (async () => {
      // A barber with no linked id and not in "all" mode has nothing to show.
      if (!props.allBarbers && props.barberId === null) {
        if (active) setLoad({ kind: 'ready', bookings: [] })
        return
      }
      const result = await listBookings(target)
      if (!active) return
      if (result.ok) setLoad({ kind: 'ready', bookings: result.value })
      else setLoad({ kind: 'error', message: result.error.message })
    })()
    return () => {
      active = false
    }
  }, [props.barberId, props.allBarbers])

  const now = Date.now()
  const { upcoming, past } = useMemo(() => {
    if (load.kind !== 'ready') return { upcoming: [], past: [] }
    const up: AdminBooking[] = []
    const pa: AdminBooking[] = []
    for (const b of load.bookings) {
      if (b.startAt.getTime() >= now) up.push(b)
      else pa.push(b)
    }
    up.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    pa.sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
    return { upcoming: up, past: pa }
  }, [load, now])

  const barberName = (id: AdminBarberId): string =>
    props.barbers.find((b) => b.id === id)?.name ?? id

  const doCancel = async (): Promise<void> => {
    const target = pendingCancel
    if (target === null) return
    setBusy(true)
    const result = await cancelBooking(target.id)
    setBusy(false)
    setPendingCancel(null)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setNotice({ kind: 'ok', text: 'Bokningen avbokad.' })
    // Reflect the cancellation locally (status -> cancelled) without a full refetch.
    setLoad((prev) =>
      prev.kind === 'ready'
        ? {
            kind: 'ready',
            bookings: prev.bookings.map((b) =>
              b.id === target.id ? { ...b, status: 'cancelled' } : b,
            ),
          }
        : prev,
    )
  }

  const renderTable = (rows: readonly AdminBooking[], emptyText: string): JSX.Element => {
    if (rows.length === 0) return <div style={s.emptyState}>{emptyText}</div>
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Tid</th>
              {props.allBarbers ? <th style={s.th}>Barberare</th> : null}
              <th style={s.th}>Kund</th>
              <th style={s.th}>Behandling</th>
              <th style={s.th}>Kontakt</th>
              <th style={s.th}>Status</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Åtgärd</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const contact = b.method === 'sms' ? (b.phone ?? '—') : (b.email ?? '—')
              const cancelled = b.status === 'cancelled'
              return (
                <tr key={b.id}>
                  <td style={s.td}>{whenLabel(lang, b.startAt)}</td>
                  {props.allBarbers ? <td style={s.td}>{barberName(b.barberId)}</td> : null}
                  <td style={s.td}>{b.customerName}</td>
                  <td style={s.td}>
                    {b.serviceName}
                    <span style={s.mutedText}> · {b.durationMin} min</span>
                  </td>
                  <td style={s.td}>{contact}</td>
                  <td style={s.td}>
                    <span
                      style={{
                        ...s.pill,
                        color: cancelled ? s.errorText.color : undefined,
                      }}
                    >
                      {cancelled ? 'Avbokad' : 'Bekräftad'}
                    </span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    {cancelled ? (
                      <span style={s.mutedText}>—</span>
                    ) : (
                      <button
                        type="button"
                        style={s.dangerBtn}
                        onClick={() => setPendingCancel(b)}
                      >
                        Avboka
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <section style={s.card} aria-labelledby="bookings-heading">
        <h2 id="bookings-heading" style={s.sectionTitle}>
          {props.heading}
        </h2>
        <p style={s.sectionLead}>{props.lead}</p>

        <div aria-live="polite" style={{ minHeight: '18px', margin: '8px 0 4px' }}>
          {notice !== null ? (
            <span style={notice.kind === 'ok' ? s.successText : s.errorText}>{notice.text}</span>
          ) : null}
        </div>

        {load.kind === 'loading' ? (
          <div style={s.emptyState}>Laddar bokningar …</div>
        ) : load.kind === 'error' ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{load.message}</div>
        ) : (
          <>
            <h3 style={{ ...s.label, marginTop: '14px', fontSize: '13px' }}>Kommande</h3>
            {renderTable(upcoming, 'Inga kommande bokningar.')}
            <h3 style={{ ...s.label, marginTop: '22px', fontSize: '13px' }}>Tidigare</h3>
            {renderTable(past, 'Inga tidigare bokningar.')}
          </>
        )}
      </section>

      {pendingCancel !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title="Avboka bokningen?"
          body={`${pendingCancel.customerName} · ${whenLabel(lang, pendingCancel.startAt)}. Detta går inte att ångra.`}
          confirmLabel="Avboka"
          cancelLabel="Behåll"
          danger
          busy={busy}
          onConfirm={() => void doCancel()}
          onClose={() => {
            if (!busy) setPendingCancel(null)
          }}
        />
      ) : null}
    </>
  )
}
