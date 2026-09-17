import { cmsNodeId } from '../cms/nodeIdentity'
import { useCms, mergeCmsStrings, mergeCmsPalette, CmsImage } from '../cms/context'
// "Mina bokningar" / My-appointments popup — the customer self-service surface. Built on the SAME
// accessible Dialog + booking-popup styling (knc-sheet-backdrop / knc-sheet-card) as the booking and
// cancellation popups, so it matches the site everywhere it mounts.
//
// Three steps inside one Dialog:
//   1. lookup - request a fresh permanent link using the email from the booking.
//   2. sent - wait for the possession-proof link without disclosing whether data matched.
//   3. list - the customer's confirmed history: an always-visible "Kommande" section and a
//      collapsible "Tidigare" section (starts collapsed). Each row is a framed toggle showing
//      "Weekday D Month kl HH:MM"; expanding it reveals barber · service · price · duration, and —
//      for upcoming rows — a self-cancel with an inline "are you sure?" confirm.
//
// Effects go through the injectable MyBookingsPort. History and cancellation require possession of
// the current high-entropy email-scoped token; requesting another link replaces the previous token.

import type { JSX, Ref } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import { FOCUS_CLS } from '../ui/pseudo'
import { buildBookingStyles, palette, systemRed } from '../booking/bookingStyles'
import { parseEmail } from '../booking/validation'
import { Turnstile, turnstileConfigured } from '../booking/Turnstile'
import type { Lang } from '../i18n/index'
import { myBookingsStrings } from '../i18n/index'
import { customerEmailLinkStrings } from '../i18n/customerEmailLinkStrings'
import type { CustomerProfile, MyBooking, MyBookings } from './domain'
import { defaultMyBookingsPort } from './adapters/index'
import type { MyBookingsPort } from './port'
import { CustomerEmailLink } from './CustomerEmailLink'

type Mode = 'light' | 'dark'
type Step = 'loading' | 'lookup' | 'sent' | 'list'

const BACKDROP_STYLE =
  'position:fixed;inset:0;box-sizing:border-box;background:rgba(10,10,12,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px 16px;z-index:60;animation:kncOverlay .2s ease both;overflow:hidden;'

export interface MyBookingsDialogProps {
  readonly mode: Mode
  readonly lang: Lang
  readonly onClose: () => void
  /** Injected seam (default: env-selected; mock adapter when no backend is configured). */
  readonly port?: MyBookingsPort
  readonly accessToken?: string
  readonly accessError?: 'invalid' | 'cookies_disabled' | 'system'
  readonly onProfile?: (profile: CustomerProfile | undefined) => void
  readonly emailLinkCode?: string | null
}

export function MyBookingsDialog(props: MyBookingsDialogProps): JSX.Element {
  const owner = useRef({
    port: props.port,
    token: props.accessToken,
    error: props.accessError,
    key: 0,
  })
  if (
    owner.current.port !== props.port ||
    owner.current.token !== props.accessToken ||
    owner.current.error !== props.accessError
  ) {
    owner.current = {
      port: props.port,
      token: props.accessToken,
      error: props.accessError,
      key: owner.current.key + 1,
    }
  }
  // A changed credential or port starts a fresh dialog session, clearing prior customer data and
  // invalidating its asynchronous work before the new session can render.
  return <MyBookingsSession key={owner.current.key} {...props} />
}

function MyBookingsSession(props: MyBookingsDialogProps): JSX.Element {
  const _cmsPresentation = useCms().presentation

  const lang = props.lang
  const t = mergeCmsStrings(_cmsPresentation, 'myBookings', lang, myBookingsStrings(lang))
  const dark = props.mode === 'dark'
  const c = mergeCmsPalette(_cmsPresentation, palette(dark), dark ? 'dark' : 'light')
  const s = buildBookingStyles(c, dark, false)
  const red = systemRed(dark)
  const port: MyBookingsPort = props.port ?? defaultMyBookingsPort

  const [step, setStep] = useState<Step>(props.accessError === undefined ? 'loading' : 'lookup')
  const [email, setEmail] = useState<string>('')
  const [emailError, setEmailError] = useState<boolean>(false)
  const initialErrors = {
    invalid: t.errAccess,
    cookies_disabled: t.errCookies,
    system: t.errSystem,
  }
  const [systemError, setSystemError] = useState<string | null>(
    props.accessError === undefined ? null : initialErrors[props.accessError],
  )
  const [busy, setBusy] = useState<boolean>(false)
  const [bookings, setBookings] = useState<MyBookings | null>(null)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [deviceOnly, setDeviceOnly] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(props.accessToken ?? null)
  const lifetime = useRef({ active: true, read: 0, reading: false, request: false, cancel: false })
  useEffect(() => {
    const owner = lifetime.current
    owner.active = true
    return () => {
      owner.active = false
      owner.read++
    }
  }, [])

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
  const actionError = (
    error: 'failed_challenge' | 'rate_limited' | 'system',
    fallback: string,
  ): string => {
    if (error === 'failed_challenge') return t.errChallenge
    if (error === 'rate_limited') return t.errRateLimited
    if (error === 'system') return t.errSystem
    return fallback
  }

  const emailInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (step === 'lookup') emailInputRef.current?.focus()
  }, [step])

  async function loadBookings(token: string, restoring = false): Promise<void> {
    const owner = lifetime.current
    if (!owner.active) return
    const read = ++owner.read
    owner.reading = true
    const current = (): boolean => owner.active && read === owner.read
    setBusy(true)
    setSystemError(null)
    try {
      const result = await port.list({ accessToken: token, lang })
      if (!current()) return
      if (!result.ok) {
        if (result.error === 'system' && bookings !== null) {
          setSystemError(t.errSystem)
          return
        }
        props.onProfile?.(undefined)
        setProfile(null)
        setBookings(null)
        setAccessToken(null)
        setStep('lookup')
        const errors = {
          cookies_disabled: t.errCookies,
          access_denied: restoring ? null : t.errAccess,
          system: t.errSystem,
        }
        setSystemError(errors[result.error])
        return
      }
      setBookings(result.bookings)
      setDeviceOnly(result.authority === 'device')
      setProfile(result.authority === 'verified' ? result.profile : null)
      props.onProfile?.(result.profile)
      // Initial link token is used only for this request. Subsequent operations use HttpOnly cookie.
      setAccessToken('')
      setExpandedId(null)
      setCancelFor(null)
      setPastOpen(false)
      setNotice(null)
      setStep('list')
    } catch {
      if (!current()) return
      if (bookings !== null) {
        setSystemError(t.errSystem)
        return
      }
      props.onProfile?.(undefined)
      setProfile(null)
      setAccessToken(null)
      setStep('lookup')
      setSystemError(t.errSystem)
    } finally {
      if (current()) {
        owner.reading = false
        setBusy(false)
      }
    }
  }

  useEffect(() => {
    if (props.accessToken !== undefined) {
      setAccessToken(props.accessToken)
      void loadBookings(props.accessToken)
    } else if (props.accessError === undefined) {
      void loadBookings('', true)
    }
  }, [props.accessToken])

  async function requestAccess(): Promise<void> {
    const owner = lifetime.current
    if (!owner.active || owner.request) return
    const parsedEmail = parseEmail(email)
    if (!parsedEmail.ok) {
      setEmailError(!parsedEmail.ok)
      return
    }
    owner.request = true
    owner.read++
    owner.reading = false
    setBusy(true)
    setSystemError(null)
    try {
      const result = await port.requestAccess({
        email: parsedEmail.value,
        lang,
        turnstileToken,
      })
      if (!owner.active) return
      if (result.ok) {
        setStep('sent')
      } else {
        setSystemError(actionError(result.error, t.errSystem))
      }
    } catch {
      if (owner.active) setSystemError(t.errSystem)
    } finally {
      owner.request = false
      if (owner.active) {
        setBusy(false)
        setTurnstileToken('')
        setTurnstileNonce((nonce) => nonce + 1)
      }
    }
  }

  const onEmail = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    if (emailError) setEmailError(false)
    setSystemError(null)
    setEmail(e.currentTarget.value)
  }

  const lookupDisabled = busy || email.trim() === '' || (challengeRequired && turnstileToken === '')
  const onLookupClick = (): void => void requestAccess()

  const onChangeDetails = (): void => {
    lifetime.current.read++
    lifetime.current.reading = false
    props.onProfile?.(undefined)
    setProfile(null)
    setBookings(null)
    setBusy(false)
    setStep('lookup')
    setSystemError(null)
    setEmailError(false)
    setAccessToken(null)
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
    const owner = lifetime.current
    if (!owner.active || owner.cancel) return
    owner.cancel = true
    setCancelBusy(true)
    setCancelError(null)
    try {
      if (accessToken === null) {
        setCancelError(t.errAccess)
        return
      }
      const result = await port.cancel(b, accessToken)
      if (!owner.active) return
      if (!result.ok) {
        setCancelError(result.error === 'access_denied' ? t.errAccess : t.errCancel)
        return
      }
      // Drop the cancelled booking from the upcoming list; surface a brief confirmation note.
      const reload = owner.reading
      owner.read++
      owner.reading = false
      setBusy(false)
      setBookings((prev) =>
        prev === null ? prev : { ...prev, upcoming: prev.upcoming.filter((x) => x.id !== b.id) },
      )
      setCancelFor(null)
      setExpandedId(null)
      setNotice(t.cancelledNote)
      // A merge-triggered list read may have captured this booking before cancellation committed.
      if (reload) void loadBookings('')
    } catch {
      if (owner.active) setCancelError(t.errCancel)
    } finally {
      owner.cancel = false
      if (owner.active) setCancelBusy(false)
    }
  }

  // --- shared bits ---------------------------------------------------------------------------------

  const emailNote = emailError ? t.errEmail : null

  const chevron = (open: boolean): JSX.Element => (
    <CmsImage
      data-cms-node="mybookingsdialog-img-1"
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
    <div
      data-cms-node="mybookingsdialog-div-2"
      style="display:flex;justify-content:space-between;gap:12px;font-size:14px;"
    >
      <span data-cms-node="mybookingsdialog-span-3" style="opacity:.55;flex:none;">
        {label}
      </span>
      <span data-cms-node="mybookingsdialog-span-4" style="font-weight:600;text-align:right;">
        {value}
      </span>
    </div>
  )

  const bookingRow = (b: MyBooking, upcoming: boolean): JSX.Element => {
    const open = expandedId === b.id
    const confirming = cancelFor === b.id
    return (
      <div
        data-cms-node={cmsNodeId('mybookingsdialog-div-5', b.id)}
        key={b.id}
        style={{
          border: '.5px solid ' + c.line,
          borderRadius: '12px',
          background: c.card,
          overflow: 'hidden',
        }}
      >
        <button
          data-cms-node={cmsNodeId('mybookingsdialog-button-6', b.id)}
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
          <span
            data-cms-node={cmsNodeId('mybookingsdialog-span-7', b.id)}
            style="font-size:14.5px;font-weight:600;"
          >
            {b.whenLabel}
          </span>
          {chevron(open)}
        </button>
        {open ? (
          <div
            data-cms-node={cmsNodeId('mybookingsdialog-div-8', b.id)}
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
                <div
                  data-cms-node={cmsNodeId('mybookingsdialog-div-9', b.id)}
                  style={{ marginTop: '4px' }}
                >
                  <p
                    data-cms-node={cmsNodeId('mybookingsdialog-p-10', b.id)}
                    data-cms-copy="copy:myBookings:cancelConfirmQ"
                    style="font-size:13px;line-height:1.45;margin:0 0 10px;"
                  >
                    {t.cancelConfirmQ}
                  </p>
                  {cancelError !== null ? (
                    <p
                      data-cms-node={cmsNodeId('mybookingsdialog-p-11', b.id)}
                      role="alert"
                      style={{ ...s.submitErrorStyle, margin: '0 0 10px' }}
                    >
                      {cancelError}
                    </p>
                  ) : null}
                  <div
                    data-cms-node={cmsNodeId('mybookingsdialog-div-12', b.id)}
                    style="display:flex;gap:10px;"
                  >
                    <button
                      data-cms-node={cmsNodeId('mybookingsdialog-button-13', b.id)}
                      data-cms-copy="copy:myBookings:cancelConfirmNo"
                      type="button"
                      onClick={() => {
                        setCancelFor(null)
                        setCancelError(null)
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
                      data-cms-node={cmsNodeId('mybookingsdialog-button-14', b.id)}
                      type="button"
                      onClick={cancelBusy ? undefined : () => void onConfirmCancel(b)}
                      disabled={cancelBusy}
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
                        cursor: cancelBusy ? 'default' : 'pointer',
                        opacity: cancelBusy ? 0.7 : 1,
                      }}
                    >
                      {cancelBusy ? t.cancelling : t.cancelConfirmYes}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  data-cms-node={cmsNodeId('mybookingsdialog-button-15', b.id)}
                  data-cms-copy="copy:myBookings:cancelBtn"
                  type="button"
                  onClick={() => {
                    setCancelFor(b.id)
                    setCancelError(null)
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
    type: 'email' | 'tel',
  ): JSX.Element => (
    <label
      data-cms-node="mybookingsdialog-label-16"
      style="display:flex;flex-direction:column;gap:5px;margin-top:12px;"
    >
      <span
        data-cms-node="mybookingsdialog-span-17"
        style="font-size:12px;font-weight:600;opacity:.55;"
      >
        {label}
      </span>
      <input
        data-cms-node="mybookingsdialog-input-18"
        ref={inputRef}
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        type={type}
        autoComplete={type}
        inputMode={type === 'tel' ? 'tel' : 'email'}
        aria-invalid={invalid ? 'true' : undefined}
        style={invalid ? s.inputErrorStyle : s.inputStyle}
        class={FOCUS_CLS}
      />
      {note !== null ? (
        <span data-cms-node="mybookingsdialog-span-19" role="alert" style={s.fieldErrorNoteStyle}>
          {note}
        </span>
      ) : null}
    </label>
  )

  const changeEmailLink = (
    <button
      data-cms-node="mybookingsdialog-button-20"
      data-cms-copy="copy:myBookings:changeEmail"
      type="button"
      onClick={onChangeDetails}
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
      {t.changeEmail}
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
      <div data-cms-node="mybookingsdialog-div-21" style={s.overlayHeaderStyle}>
        <span
          data-cms-node="mybookingsdialog-span-22"
          data-cms-copy="copy:myBookings:title"
          id="knc-mybookings-title"
          style="font-family:'Inter Variable';font-weight:600;font-size:17px;"
        >
          {t.title}
        </span>
        <button
          data-cms-node="mybookingsdialog-button-23"
          data-cms-copy="copy:myBookings:ariaClose"
          onClick={props.onClose}
          style={s.closeBtnStyle}
          aria-label={t.ariaClose}
        >
          ×
        </button>
      </div>

      <div data-cms-node="mybookingsdialog-div-24" style="padding:16px 18px 18px;">
        {props.emailLinkCode !== undefined && step !== 'loading' ? (
          <CustomerEmailLink
            lang={lang}
            dark={dark}
            port={port}
            profile={step === 'list' ? profile : null}
            code={props.emailLinkCode}
            onLinked={() => void loadBookings('')}
          />
        ) : null}
        {step === 'list' && deviceOnly ? (
          <p
            data-cms-node="mybookingsdialog-p-25"
            data-cms-copy="copy:myBookings:deviceBookingsNote"
            style={{ fontSize: '13px', lineHeight: 1.45, opacity: 0.7, margin: '0 0 14px' }}
          >
            {t.deviceBookingsNote}
          </p>
        ) : null}
        {step === 'loading' ? (
          <p
            data-cms-node="mybookingsdialog-p-26"
            data-cms-copy="copy:myBookings:loadingBookings"
            role="status"
          >
            {t.loadingBookings}
          </p>
        ) : null}
        {step === 'lookup' ? (
          <div data-cms-node="mybookingsdialog-div-27">
            <p
              data-cms-node="mybookingsdialog-p-28"
              data-cms-copy="copy:myBookings:lookupLead"
              style="font-size:13.5px;opacity:.6;line-height:1.45;margin:0;"
            >
              {t.lookupLead}
            </p>
            {contactField(
              t.email,
              email,
              onEmail,
              t.emailPh,
              emailNote,
              emailError,
              emailInputRef,
              'email',
            )}
            {systemError !== null ? (
              <p
                data-cms-node="mybookingsdialog-p-29"
                role="alert"
                style={{ ...s.submitErrorStyle, marginTop: '14px' }}
              >
                {systemError}
              </p>
            ) : null}
            <Turnstile
              action="customer_access"
              lang={lang}
              onToken={setTurnstileToken}
              resetNonce={turnstileNonce}
            />
            <button
              data-cms-node="mybookingsdialog-button-30"
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

        {step === 'sent' ? (
          <div
            data-cms-node="mybookingsdialog-div-31"
            style="display:flex;flex-direction:column;gap:16px;"
          >
            <p
              data-cms-node="mybookingsdialog-p-32"
              data-cms-copy="copy:myBookings:accessSent"
              style="font-size:13.5px;line-height:1.5;margin:0;"
            >
              {t.accessSent}
            </p>
            <div
              data-cms-node="mybookingsdialog-div-33"
              style="display:flex;justify-content:center;padding-top:2px;"
            >
              {changeEmailLink}
            </div>
          </div>
        ) : null}

        {step === 'list' && bookings !== null ? (
          <div
            data-cms-node="mybookingsdialog-div-34"
            style="display:flex;flex-direction:column;gap:16px;"
          >
            {systemError !== null ? (
              <div data-cms-node="mybookingsdialog-div-35">
                <p
                  data-cms-node="mybookingsdialog-p-36"
                  role="alert"
                  style={{ ...s.submitErrorStyle, margin: '0 0 8px' }}
                >
                  {systemError}
                </p>
                <button
                  data-cms-node="mybookingsdialog-button-37"
                  type="button"
                  class={FOCUS_CLS}
                  style={s.bookBtnStyle}
                  disabled={busy}
                  onClick={() => void loadBookings('')}
                >
                  {
                    mergeCmsStrings(
                      _cmsPresentation,
                      'customerEmailLink',
                      lang,
                      customerEmailLinkStrings(lang),
                    ).refresh
                  }
                </button>
              </div>
            ) : null}
            {notice !== null ? (
              <div
                data-cms-node="mybookingsdialog-div-38"
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
                <CmsImage
                  data-cms-node="mybookingsdialog-img-39"
                  src="/icons/checkmark.svg"
                  alt=""
                  style={{ width: '14px', height: '14px', filter: c.iconF, opacity: 0.7 }}
                />
                {notice}
              </div>
            ) : null}

            {/* Upcoming — always visible. */}
            <section
              data-cms-node="mybookingsdialog-section-40"
              style="display:flex;flex-direction:column;gap:9px;"
            >
              <h3
                data-cms-node="mybookingsdialog-h3-41"
                data-cms-copy="copy:myBookings:upcomingTitle"
                style="margin:0;font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.55;"
              >
                {t.upcomingTitle}
              </h3>
              {bookings.upcoming.length === 0 ? (
                <p
                  data-cms-node="mybookingsdialog-p-42"
                  data-cms-copy="copy:myBookings:upcomingEmpty"
                  style="font-size:13.5px;opacity:.55;margin:2px 0 0;"
                >
                  {t.upcomingEmpty}
                </p>
              ) : (
                bookings.upcoming.map((b) => bookingRow(b, true))
              )}
            </section>

            {/* Past — collapsible, starts collapsed. Only shown when there is history. */}
            {bookings.past.length > 0 ? (
              <section
                data-cms-node="mybookingsdialog-section-43"
                style="display:flex;flex-direction:column;gap:9px;"
              >
                <button
                  data-cms-node="mybookingsdialog-button-44"
                  data-cms-copy="copy:myBookings:ariaExpandPast"
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
                  <span
                    data-cms-node="mybookingsdialog-span-45"
                    style="font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.55;"
                  >
                    {t.pastTitle} ({bookings.past.length})
                  </span>
                  {chevron(pastOpen)}
                </button>
                {pastOpen ? bookings.past.map((b) => bookingRow(b, false)) : null}
              </section>
            ) : null}

            {props.emailLinkCode === undefined && profile !== null ? (
              <CustomerEmailLink
                lang={lang}
                dark={dark}
                port={port}
                profile={profile}
                onLinked={() => void loadBookings('')}
              />
            ) : null}

            <div
              data-cms-node="mybookingsdialog-div-46"
              style="display:flex;justify-content:center;padding-top:2px;"
            >
              {changeEmailLink}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
