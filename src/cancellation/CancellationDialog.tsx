// "Avbokning" / cancellation popup — its own component, but built on the SAME accessible Dialog and
// the SAME booking-popup styling (knc-sheet-backdrop / knc-sheet-card, the mobile zoom + 19px input
// rule). A single Dialog holds three internal steps:
//
//   1. lookup  — enter the booking phone number, validate (parsePhone), then CancellationPort.lookup.
//   2. confirm — show the looked-up booking (barber · when · service · price) with Avboka / Avbryt.
//   3. done    — "Din tid är avbokad" + booking-list status, with a close button.
//
// Effects (the lookup/cancel calls) go through the injectable CancellationPort (default:
// env-selected — Supabase when configured, the mock otherwise). The dialog is fully theme-aware
// via the booking palette.

import type { JSX, Ref } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import { FOCUS_CLS } from '../ui/pseudo'
import { buildBookingStyles, palette, systemRed } from '../booking/bookingStyles'
import { parsePhone } from '../booking/validation'
import { Turnstile, turnstileConfigured } from '../booking/Turnstile'
import type { Lang } from '../i18n/index'
import { cancelStrings } from '../i18n/index'
import type { CancelBooking } from './domain'
import { defaultCancellationPort } from './adapters/index'
import type { CancellationPort } from './port'

type Mode = 'light' | 'dark'

const BACKDROP_STYLE =
  'position:fixed;inset:0;box-sizing:border-box;background:rgba(10,10,12,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px 16px;z-index:60;animation:kncOverlay .2s ease both;overflow:hidden;'

type Step = 'lookup' | 'confirm' | 'done'

export interface CancellationDialogProps {
  readonly mode: Mode
  readonly lang: Lang
  readonly onClose: () => void
  /** Injected seam (default: env-selected; mock adapter when no backend is configured). */
  readonly port?: CancellationPort
}

export function CancellationDialog(props: CancellationDialogProps): JSX.Element {
  const lang = props.lang
  const t = cancelStrings(lang)
  const dark = props.mode === 'dark'
  const c = palette(dark)
  const s = buildBookingStyles(c, dark, false)
  const red = systemRed(dark)
  const port: CancellationPort = props.port ?? defaultCancellationPort

  const [step, setStep] = useState<Step>('lookup')
  const [phone, setPhone] = useState<string>('')
  const [contactError, setContactError] = useState<boolean>(false)
  const [systemError, setSystemError] = useState<string | null>(null)
  const [busy, setBusy] = useState<boolean>(false)
  const [booking, setBooking] = useState<CancelBooking | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)
  const challengeRequired = turnstileConfigured

  // Move focus (and the on-screen keyboard) straight to the phone field when the lookup step shows.
  const contactInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (step === 'lookup') contactInputRef.current?.focus()
  }, [step])

  const onPhone = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    if (contactError) setContactError(false)
    setSystemError(null)
    setPhone(e.currentTarget.value)
  }

  const lookupDisabled = busy || phone.trim() === '' || (challengeRequired && turnstileToken === '')

  // Step 1 → 2: validate the phone, then look the booking up through the port.
  const onLookup = async (): Promise<void> => {
    const parsed = parsePhone(phone)
    if (!parsed.ok) {
      setContactError(true)
      return
    }
    setBusy(true)
    setSystemError(null)
    try {
      const result = await port.lookup({
        contact: parsed.value,
        lang,
        turnstileToken,
      })
      if (result.ok) {
        setBooking(result.booking)
        setStep('confirm')
      } else {
        setSystemError(t.errLookup)
      }
    } catch {
      setSystemError(t.errLookup)
    } finally {
      setBusy(false)
      if (step === 'lookup') {
        setTurnstileToken('')
        setTurnstileNonce((nonce) => nonce + 1)
      }
    }
  }
  const onLookupClick = (): void => {
    void onLookup()
  }

  // Step 2 → 1: abort returns to the lookup step (keeps entered contact).
  const onAbort = (): void => {
    setSystemError(null)
    setTurnstileToken('')
    setTurnstileNonce((nonce) => nonce + 1)
    setStep('lookup')
  }

  // Step 2 → 3: confirm the cancellation through the port.
  const onConfirmCancel = async (): Promise<void> => {
    if (booking === null) return
    setBusy(true)
    setSystemError(null)
    try {
      const result = await port.cancel(booking, turnstileToken)
      if (result.ok) {
        setStep('done')
      } else {
        setSystemError(t.errCancel)
      }
    } catch {
      setSystemError(t.errCancel)
    } finally {
      setBusy(false)
      setTurnstileToken('')
      setTurnstileNonce((nonce) => nonce + 1)
    }
  }
  const onConfirmCancelClick = (): void => {
    void onConfirmCancel()
  }

  const onBackdrop = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) props.onClose()
  }

  const contactField = (
    label: string,
    value: string,
    onInput: (ev: JSX.TargetedInputEvent<HTMLInputElement>) => void,
    placeholder: string,
    inputMode: 'tel',
    note: string,
    inputRef: Ref<HTMLInputElement>,
  ): JSX.Element => (
    <label style="display:flex;flex-direction:column;gap:5px;margin-top:12px;">
      <span style="font-size:12px;font-weight:600;opacity:.55;">{label}</span>
      <input
        ref={inputRef}
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-invalid={contactError ? 'true' : undefined}
        style={contactError ? s.inputErrorStyle : s.inputStyle}
        class={FOCUS_CLS}
      />
      {contactError ? (
        <span role="alert" style={s.fieldErrorNoteStyle}>
          {note}
        </span>
      ) : null}
    </label>
  )

  return (
    <Dialog
      titleId="knc-cancel-title"
      onClose={props.onClose}
      onBackdropClick={onBackdrop}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <div style={s.overlayHeaderStyle}>
        <span
          id="knc-cancel-title"
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
            {contactField(t.phone, phone, onPhone, t.phonePh, 'tel', t.errPhone, contactInputRef)}

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

        {step === 'confirm' && booking !== null ? (
          <div>
            <p style="font-size:13.5px;opacity:.6;line-height:1.45;margin:0 0 12px;">
              {t.foundLead}
            </p>
            <div style={s.summaryBoxStyle}>
              <div style="display:flex;justify-content:space-between;font-size:14px;">
                <span style="opacity:.55;">{t.fBarber}</span>
                <span style="font-weight:600;">{booking.barber.name}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:14px;">
                <span style="opacity:.55;">{t.fWhen}</span>
                <span style="font-weight:600;text-align:right;">{booking.whenLabel}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:14px;">
                <span style="opacity:.55;">{t.fService}</span>
                <span style="font-weight:600;text-align:right;">
                  {booking.serviceName} · {booking.price} kr
                </span>
              </div>
            </div>

            <p style="font-size:13.5px;line-height:1.5;margin:14px 0 4px;">{t.confirmQuestion}</p>

            {systemError !== null ? (
              <p role="alert" style={{ ...s.submitErrorStyle, marginTop: '12px' }}>
                {systemError}
              </p>
            ) : null}

            <Turnstile onToken={setTurnstileToken} resetNonce={turnstileNonce} />

            <div style="display:flex;gap:10px;margin-top:14px;">
              <button
                onClick={onAbort}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '11px',
                  border: '1px solid ' + c.inputLine,
                  background: c.input,
                  color: c.text,
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {t.abortBtn}
              </button>
              <button
                onClick={
                  busy || (challengeRequired && turnstileToken === '')
                    ? undefined
                    : onConfirmCancelClick
                }
                disabled={busy || (challengeRequired && turnstileToken === '')}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '11px',
                  border: 'none',
                  background: red,
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor:
                    busy || (challengeRequired && turnstileToken === '') ? 'default' : 'pointer',
                  opacity: busy || (challengeRequired && turnstileToken === '') ? 0.7 : 1,
                }}
              >
                {busy ? t.cancelling : t.confirmBtn}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'done' ? (
          <div style="text-align:center;padding:8px 0 4px;">
            <div style={s.successCircleStyle}>
              <img src="/icons/checkmark.svg" alt="" style={s.successCheckStyle} />
            </div>
            <div style="font-family:'Inter Variable';font-weight:600;font-size:20px;margin-bottom:6px;">
              {t.doneTitle}
            </div>
            <div style="font-size:13.5px;opacity:.6;line-height:1.45;max-width:300px;margin:0 auto 18px;">
              {t.doneVia}
            </div>
            <button onClick={props.onClose} style={s.resetBtnStyle}>
              {t.doneBtn}
            </button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
