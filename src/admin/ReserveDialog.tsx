// "Reservera kund" dialog (Task 2 §4) — a compact admin popup to write a manual booking into the
// schedule at a given time. Name / price / phone are ALL optional (a blank name → the localized
// default; a blank/invalid phone → a contact-less walk-in). A valid phone makes the booking visible
// under "Mina bokningar". Built on the shared accessible Dialog + admin styles, like ConfirmDialog.
//
// The dialog owns its input state + phone-format validation; the parent owns the async write (busy +
// server error passed in) and refetches the grid on success.

import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import { palette, systemRed } from '../booking/bookingStyles'
import { parsePhone } from '../booking/validation'
import { buildAdminStyles } from './adminStyles'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'

const TITLE_ID = 'admin-reserve-title'

/** Generic block length (minutes) when the barber has no service menu — preserves prior behavior. */
const FALLBACK_DURATION_MIN = 45

/** A bookable service the picker offers — the subset of an admin service the reservation needs. */
export interface ReserveService {
  readonly id: string
  readonly name: string
  readonly price: number
  readonly durationMin: number
}

/** The normalized reservation fields the parent sends to `createManualBooking`. */
export interface ReserveFields {
  readonly customerName: string
  readonly price: number
  /** Normalized phone, or null for a contact-less walk-in. */
  readonly phone: string | null
  /** Length of the reserved block (minutes) — from the picked service or the generic fallback. */
  readonly durationMin: number
  /** Name of the reserved service — from the picked service or the generic fallback. */
  readonly serviceName: string
}

export interface ReserveDialogProps {
  readonly dark: boolean
  readonly lang: Lang
  /** Human label of the slot being reserved (e.g. "Måndag 13 juli 12:00"). */
  readonly timeLabel: string
  /** The barber's ACTIVE services. Empty → a generic 45-min reservation with no picker shown. */
  readonly services: readonly ReserveService[]
  readonly busy: boolean
  /** Server-side error to show above the actions (null when none). */
  readonly serverError: string | null
  readonly onSubmit: (fields: ReserveFields) => void
  readonly onClose: () => void
}

export function ReserveDialog(props: ReserveDialogProps): JSX.Element {
  const c = palette(props.dark)
  const s = buildAdminStyles(c, props.dark)
  const t = adminText(props.lang)
  const red = systemRed(props.dark)

  // The service picker drives the reservation's duration + name; the price input is PRE-FILLED from the
  // picked service but stays editable. An empty menu → no picker + a generic fallback block.
  const hasServices = props.services.length > 0
  const [serviceId, setServiceId] = useState<string>(() => props.services[0]?.id ?? '')
  const [name, setName] = useState('')
  const [price, setPrice] = useState<string>(() =>
    props.services[0] !== undefined ? String(props.services[0].price) : '',
  )
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState(false)

  const selectedService = props.services.find((svc) => svc.id === serviceId)

  const onServiceChange = (id: string): void => {
    setServiceId(id)
    const svc = props.services.find((s2) => s2.id === id)
    if (svc !== undefined) setPrice(String(svc.price))
  }

  const backdropStyle =
    'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
    'padding:20px;background:rgba(0,0,0,.42);'
  const cardStyle: JSX.CSSProperties = {
    width: '100%',
    maxWidth: '380px',
    background: c.bg,
    color: c.text,
    border: '0.5px solid ' + c.line,
    borderRadius: '16px',
    padding: '20px 22px',
    boxShadow: '0 24px 60px rgba(0,0,0,.4)',
    fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
  }

  const onBackdropClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && !props.busy) props.onClose()
  }

  const submit = (): void => {
    // Phone is optional; if given it must be a valid Swedish mobile (else flag + stop).
    let normalizedPhone: string | null = null
    if (phone.trim() !== '') {
      const parsed = parsePhone(phone)
      if (!parsed.ok) {
        setPhoneError(true)
        return
      }
      normalizedPhone = parsed.value
    }
    const priceNum = Number.parseInt(price, 10)
    props.onSubmit({
      customerName: name.trim() === '' ? t.reserveDefaultName : name.trim(),
      price: Number.isInteger(priceNum) && priceNum >= 0 ? priceNum : 0,
      phone: normalizedPhone,
      durationMin: selectedService?.durationMin ?? FALLBACK_DURATION_MIN,
      serviceName: selectedService?.name ?? t.reserveServiceName,
    })
  }

  const field = (
    label: string,
    value: string,
    onInput: (v: string) => void,
    placeholder: string,
    opts?: { inputMode?: 'tel' | 'numeric'; invalid?: boolean; note?: string | undefined },
  ): JSX.Element => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '12px' }}>
      <span style={s.label}>{label}</span>
      <input
        style={opts?.invalid === true ? { ...s.input, borderColor: red } : s.input}
        value={value}
        placeholder={placeholder}
        inputMode={opts?.inputMode}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
      {opts?.note !== undefined ? <span style={s.errorText}>{opts.note}</span> : null}
    </label>
  )

  return (
    <Dialog
      titleId={TITLE_ID}
      onClose={props.onClose}
      onBackdropClick={onBackdropClick}
      backdropStyle={backdropStyle}
      backdropClass="knc-admin-reserve-backdrop"
      cardStyle={cardStyle}
      cardClass="knc-admin-reserve-card"
    >
      <h2
        id={TITLE_ID}
        style={{
          fontFamily: "'SF Pro Display',-apple-system,system-ui,sans-serif",
          fontSize: '17px',
          fontWeight: 700,
          margin: '0 0 4px',
        }}
      >
        {t.reserveTitle}
      </h2>
      <p style={{ margin: 0, fontSize: '13px', opacity: 0.6 }}>
        {t.reserveLeadPrefix} {props.timeLabel}
      </p>

      {hasServices ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '12px' }}>
          <span style={s.label}>{t.reserveService}</span>
          <select
            style={{ ...s.select, width: '100%', minWidth: 0 }}
            value={serviceId}
            onChange={(e) => onServiceChange(e.currentTarget.value)}
          >
            {props.services.map((svc) => (
              <option key={svc.id} value={svc.id}>
                {svc.name} · {svc.durationMin} min · {svc.price} kr
              </option>
            ))}
          </select>
          {selectedService !== undefined ? (
            <span style={s.mutedText}>{selectedService.durationMin} min</span>
          ) : null}
        </label>
      ) : null}

      {field(t.reserveName, name, setName, t.reserveNamePh)}
      {field(t.reservePrice, price, setPrice, t.reservePricePh, { inputMode: 'numeric' })}
      {field(
        t.reservePhone,
        phone,
        (v) => {
          if (phoneError) setPhoneError(false)
          setPhone(v)
        },
        t.reservePhonePh,
        { inputMode: 'tel', invalid: phoneError, note: phoneError ? t.reserveErrPhone : undefined },
      )}

      {props.serverError !== null ? (
        <p role="alert" style={{ ...s.errorText, margin: '14px 0 0' }}>
          {props.serverError}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px' }}>
        <button type="button" style={s.ghostBtn} onClick={props.onClose} disabled={props.busy}>
          {t.reserveCancel}
        </button>
        <button
          type="button"
          style={{
            ...s.primaryBtn,
            opacity: props.busy ? 0.6 : 1,
            cursor: props.busy ? 'default' : 'pointer',
          }}
          onClick={submit}
          disabled={props.busy}
        >
          {props.busy ? t.reserveBusy : t.reserveConfirm}
        </button>
      </div>
    </Dialog>
  )
}
