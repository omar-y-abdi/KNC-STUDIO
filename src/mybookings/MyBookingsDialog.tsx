// "Mina bokningar" / My-appointments popup — the customer self-service surface. Built on the SAME
// accessible Dialog + booking-popup styling (knc-sheet-backdrop / knc-sheet-card) as the booking and
// cancellation popups, so it matches the site everywhere it mounts.
//
// Two steps inside one Dialog:
//   1. lookup — enter the phone the bookings were made with (prefilled when this device remembers
//      a number). Unknown number → red field + a notice; the SAME
//      number a second time escalates to "contact the salon".
//   2. list — the customer's confirmed history: an always-visible "Kommande" section and a
//      collapsible "Tidigare" section (starts collapsed). Each row is a framed toggle showing
//      "Weekday D Month kl HH:MM"; expanding it reveals barber · service · price · duration, and —
//      for upcoming rows — a self-cancel with an inline "are you sure?" confirm.
//
// Effects (list/cancel) go through the injectable MyBookingsPort (default: env-selected — Supabase
// when configured, the mock otherwise). The proven phone is remembered on this device (localStorage)
// so a returning customer never re-types it. Fully theme-aware via the booking palette.

import type { JSX, Ref } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import { FOCUS_CLS } from '../ui/pseudo'
import { buildBookingStyles, palette, systemRed } from '../booking/bookingStyles'
import { parsePhone } from '../booking/validation'
import { Turnstile, turnstileConfigured } from '../booking/Turnstile'
import type { Lang } from '../i18n/index'
import { myBookingsStrings } from '../i18n/index'
import type { MyBooking, MyBookings } from './domain'
import { defaultMyBookingsPort } from './adapters/index'
import { recalledPhone, rememberPhone } from './deviceMemory'
import { initialEscalation, nextEscalation } from './escalation'
import type { EscalationState, LookupFailureLevel } from './escalation'
import type { MyBookingsPort } from './port'

type Mode = 'light' | 'dark'
type Step = 'lookup' | 'list'

const BACKDROP_STYLE =
  'position:fixed;inset:0;box-sizing:border-box;background:rgba(10,10,12,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px 16px;z-index:60;animation:kncOverlay .2s ease both;overflow:hidden;'

export interface MyBookingsDialogProps {
  readonly mode: Mode
  readonly lang: Lang
  readonly onClose: () => void
  /** Injected seam (default: env-selected; mock adapter when no backend is configured). */
  readonly port?: MyBookingsPort
}

export function MyBookingsDialog(props: MyBookingsDialogProps): JSX.Element {
  const lang = props.lang
  const t = myBookingsStrings(lang)
  const dark = props.mode === 'dark'
  const c = palette(dark)
  const s = buildBookingStyles(c, dark, false)
  const red = systemRed(dark)
  const port: MyBookingsPort = props.port ?? defaultMyBookingsPort

  const [step, setStep] = useState<Step>('lookup')
  const [phone, setPhone] = useState<string>('')
  const [contact, setContact] = useState<string>('')
  const [contactError, setContactError] = useState<boolean>(false)
  const [notFound, setNotFound] = useState<LookupFailureLevel | null>(null)
  const [systemError, setSystemError] = useState<string | null>(null)
  const [escalation, setEscalation] = useState<EscalationState>(initialEscalation)
  const [busy, setBusy] = useState<boolean>(false)
  const [bookings, setBookings] = useState<MyBookings | null>(null)

  // List-view local state.
  const [pastOpen, setPastOpen] = useState<boolean>(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cancelFor, setCancelFor] = useState<string | null>(null)
  const [cancelBusy, setCancelBusy] = useState<boolean>(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)
  const challengeRequired = turnstileConfigured

  const contactInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (step === 'lookup') contactInputRef.current?.focus()
  }, [step])

  // Remembered phone only prefills the field. Every lookup still requires a fresh Turnstile token.
  useEffect(() => {
    const remembered = recalledPhone()
    if (remembered === null) return
    setPhone(remembered)
  }, [])

  async function runLookup(raw: string, silent: boolean): Promise<void> {
    const parsed = parsePhone(raw)
    if (!parsed.ok) {
      if (!silent) setContactError(true)
      return
    }
    setBusy(true)
    setSystemError(null)
    setNotFound(null)
    try {
      const result = await port.listByPhone({
        contact: parsed.value,
        lang,
        turnstileToken,
      })
      if (result.ok) {
        setBookings(result.bookings)
        setContact(parsed.value)
        rememberPhone(parsed.value)
        setExpandedId(null)
        setCancelFor(null)
        setPastOpen(false)
        setNotice(null)
        setStep('list')
      } else if (result.error === 'not_found') {
        if (!silent) {
          const next = nextEscalation(escalation, parsed.value)
          setEscalation(next.state)
          setNotFound(next.level)
        }
      } else if (!silent) {
        setSystemError(t.errSystem)
      }
    } catch {
      if (!silent) setSystemError(t.errSystem)
    } finally {
      setBusy(false)
      setTurnstileToken('')
      setTurnstileNonce((nonce) => nonce + 1)
    }
  }

  const onPhone = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    if (contactError) setContactError(false)
    if (notFound !== null) setNotFound(null)
    setSystemError(null)
    setPhone(e.currentTarget.value)
  }

  const lookupDisabled = busy || phone.trim() === '' || (challengeRequired && turnstileToken === '')
  const onLookupClick = (): void => void runLookup(phone, false)

  // "Byt nummer" — back to the lookup step to check a different number (keeps the escalation memory).
  const onChangeNumber = (): void => {
    setStep('lookup')
    setNotFound(null)
    setSystemError(null)
    setContactError(false)
    setTurnstileToken('')
    setTurnstileNonce((nonce) => nonce + 1)
  }

  const onBackdrop = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) props.onClose()
  }

  const toggleRow = (id: string): void => {
    setCancelFor(null)
    setCancelError(null)
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const onConfirmCancel = async (b: MyBooking): Promise<void> => {
    setCancelBusy(true)
    setCancelError(null)
    try {
      const result = await port.cancel(b, contact, turnstileToken)
      if (!result.ok) {
        setCancelError(t.errCancel)
        return
      }
      // Drop the cancelled booking from the upcoming list; surface a brief confirmation note.
      setBookings((prev) =>
        prev === null ? prev : { ...prev, upcoming: prev.upcoming.filter((x) => x.id !== b.id) },
      )
      setCancelFor(null)
      setExpandedId(null)
      setNotice(t.cancelledNote)
    } catch {
      setCancelError(t.errCancel)
    } finally {
      setCancelBusy(false)
      setTurnstileToken('')
      setTurnstileNonce((nonce) => nonce + 1)
    }
  }

  // --- shared bits ---------------------------------------------------------------------------------

  const noteText: string | null = contactError
    ? t.errPhone
    : notFound === 'escalated'
      ? t.notFoundEscalated
      : notFound === 'first'
        ? t.notFoundFirst
        : null
  const fieldInvalid = contactError || notFound !== null

  const chevron = (open: boolean): JSX.Element => (
    <img
      src="/icons/chevron.down.svg"
      alt=""
      style={{
        width: '12px',
        height: '12px',
        flex: 'none',
        filter: c.iconF,
        opacity: 0.5,
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform .2s ease',
      }}
    />
  )

  const detailRow = (label: string, value: string): JSX.Element => (
    <div style="display:flex;justify-content:space-between;gap:12px;font-size:14px;">
      <span style="opacity:.55;flex:none;">{label}</span>
      <span style="font-weight:600;text-align:right;">{value}</span>
    </div>
  )

  const bookingRow = (b: MyBooking, upcoming: boolean): JSX.Element => {
    const open = expandedId === b.id
    const confirming = cancelFor === b.id
    return (
      <div
        key={b.id}
        style={{
          border: '.5px solid ' + c.line,
          borderRadius: '12px',
          background: c.card,
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={() => toggleRow(b.id)}
          aria-expanded={open}
          aria-label={`${b.whenLabel} — ${t.ariaExpandRow}`}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            padding: '13px 14px',
            border: 'none',
            background: 'transparent',
            color: c.text,
            fontFamily: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style="font-size:14.5px;font-weight:600;">{b.whenLabel}</span>
          {chevron(open)}
        </button>
        {open ? (
          <div
            style={{
              borderTop: '.5px solid ' + c.line,
              background: c.subtle,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {detailRow(t.fBarber, b.barber.name)}
            {detailRow(t.fService, `${b.serviceName} · ${b.price} kr`)}
            {detailRow(t.fDuration, `${b.durationMin} ${t.min}`)}
            {upcoming ? (
              confirming ? (
                <div style={{ marginTop: '4px' }}>
                  <p style="font-size:13px;line-height:1.45;margin:0 0 10px;">{t.cancelConfirmQ}</p>
                  {cancelError !== null ? (
                    <p role="alert" style={{ ...s.submitErrorStyle, margin: '0 0 10px' }}>
                      {cancelError}
                    </p>
                  ) : null}
                  <Turnstile onToken={setTurnstileToken} resetNonce={turnstileNonce} />
                  <div style="display:flex;gap:10px;">
                    <button
                      type="button"
                      onClick={() => {
                        setCancelFor(null)
                        setCancelError(null)
                        setTurnstileToken('')
                        setTurnstileNonce((nonce) => nonce + 1)
                      }}
                      disabled={cancelBusy}
                      style={{
                        flex: 1,
                        padding: '11px',
                        borderRadius: '10px',
                        border: '1px solid ' + c.inputLine,
                        background: c.input,
                        color: c.text,
                        fontFamily: 'inherit',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: cancelBusy ? 'default' : 'pointer',
                        opacity: cancelBusy ? 0.6 : 1,
                      }}
                    >
                      {t.cancelConfirmNo}
                    </button>
                    <button
                      type="button"
                      onClick={
                        cancelBusy || (challengeRequired && turnstileToken === '')
                          ? undefined
                          : () => void onConfirmCancel(b)
                      }
                      disabled={cancelBusy || (challengeRequired && turnstileToken === '')}
                      style={{
                        flex: 1,
                        padding: '11px',
                        borderRadius: '10px',
                        border: 'none',
                        background: red,
                        color: '#fff',
                        fontFamily: 'inherit',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor:
                          cancelBusy || (challengeRequired && turnstileToken === '')
                            ? 'default'
                            : 'pointer',
                        opacity:
                          cancelBusy || (challengeRequired && turnstileToken === '') ? 0.7 : 1,
                      }}
                    >
                      {cancelBusy ? t.cancelling : t.cancelConfirmYes}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCancelFor(b.id)
                    setCancelError(null)
                    setTurnstileToken('')
                    setTurnstileNonce((nonce) => nonce + 1)
                  }}
                  style={{
                    marginTop: '2px',
                    alignSelf: 'flex-start',
                    padding: '9px 14px',
                    borderRadius: '10px',
                    border: '1px solid ' + red,
                    background: 'transparent',
                    color: red,
                    fontFamily: 'inherit',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {t.cancelBtn}
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const contactField = (
    label: string,
    value: string,
    onInput: (ev: JSX.TargetedInputEvent<HTMLInputElement>) => void,
    placeholder: string,
    note: string | null,
    invalid: boolean,
    inputRef: Ref<HTMLInputElement>,
  ): JSX.Element => (
    <label style="display:flex;flex-direction:column;gap:5px;margin-top:12px;">
      <span style="font-size:12px;font-weight:600;opacity:.55;">{label}</span>
      <input
        ref={inputRef}
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        inputMode="tel"
        aria-invalid={invalid ? 'true' : undefined}
        style={invalid ? s.inputErrorStyle : s.inputStyle}
        class={FOCUS_CLS}
      />
      {note !== null ? (
        <span role="alert" style={s.fieldErrorNoteStyle}>
          {note}
        </span>
      ) : null}
    </label>
  )

  const changeNumberLink = (
    <button
      type="button"
      onClick={onChangeNumber}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        opacity: 0.6,
        fontFamily: 'inherit',
        fontSize: '13px',
        fontWeight: 600,
        textDecoration: 'underline',
        textUnderlineOffset: '3px',
        cursor: 'pointer',
        padding: '4px 0',
      }}
    >
      {t.changeNumber}
    </button>
  )

  return (
    <Dialog
      titleId="knc-mybookings-title"
      onClose={props.onClose}
      onBackdropClick={onBackdrop}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <div style={s.overlayHeaderStyle}>
        <span
          id="knc-mybookings-title"
          style="font-family:'Inter Variable';font-weight:600;font-size:17px;"
        >
          {t.title}
        </span>
        <button onClick={props.onClose} style={s.closeBtnStyle} aria-label={t.ariaClose}>
          ×
        </button>
      </div>

      <div style="padding:16px 18px 18px;">
        {step === 'lookup' ? (
          <div>
            <p style="font-size:13.5px;opacity:.6;line-height:1.45;margin:0;">{t.lookupLead}</p>
            {contactField(
              t.phone,
              phone,
              onPhone,
              t.phonePh,
              noteText,
              fieldInvalid,
              contactInputRef,
            )}
            {systemError !== null ? (
              <p role="alert" style={{ ...s.submitErrorStyle, marginTop: '14px' }}>
                {systemError}
              </p>
            ) : null}
            <Turnstile onToken={setTurnstileToken} resetNonce={turnstileNonce} />
            <button
              onClick={lookupDisabled ? undefined : onLookupClick}
              disabled={lookupDisabled}
              style={{
                ...s.bookBtnStyle,
                marginTop: '16px',
                cursor: lookupDisabled ? 'default' : 'pointer',
                background: lookupDisabled ? c.subtle : c.accent,
                color: lookupDisabled ? c.text : c.accentText,
                opacity: lookupDisabled ? 0.5 : 1,
              }}
            >
              {busy ? t.lookingUp : t.lookupBtn}
            </button>
          </div>
        ) : null}

        {step === 'list' && bookings !== null ? (
          <div style="display:flex;flex-direction:column;gap:16px;">
            {notice !== null ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: c.text,
                  background: c.subtle,
                  border: '.5px solid ' + c.line,
                  borderRadius: '10px',
                  padding: '10px 12px',
                }}
              >
                <img
                  src="/icons/checkmark.svg"
                  alt=""
                  style={{ width: '14px', height: '14px', filter: c.iconF, opacity: 0.7 }}
                />
                {notice}
              </div>
            ) : null}

            {/* Upcoming — always visible. */}
            <section style="display:flex;flex-direction:column;gap:9px;">
              <h3 style="margin:0;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.55;">
                {t.upcomingTitle}
              </h3>
              {bookings.upcoming.length === 0 ? (
                <p style="font-size:13.5px;opacity:.55;margin:2px 0 0;">{t.upcomingEmpty}</p>
              ) : (
                bookings.upcoming.map((b) => bookingRow(b, true))
              )}
            </section>

            {/* Past — collapsible, starts collapsed. Only shown when there is history. */}
            {bookings.past.length > 0 ? (
              <section style="display:flex;flex-direction:column;gap:9px;">
                <button
                  type="button"
                  onClick={() => setPastOpen((v) => !v)}
                  aria-expanded={pastOpen}
                  aria-label={t.ariaExpandPast}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    width: '100%',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    color: c.text,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <span style="font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.55;">
                    {t.pastTitle} ({bookings.past.length})
                  </span>
                  {chevron(pastOpen)}
                </button>
                {pastOpen ? bookings.past.map((b) => bookingRow(b, false)) : null}
              </section>
            ) : null}

            <div style="display:flex;justify-content:center;padding-top:2px;">
              {changeNumberLink}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
