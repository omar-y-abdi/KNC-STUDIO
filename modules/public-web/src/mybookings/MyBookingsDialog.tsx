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
//      for upcoming rows — a self-cancel with an inline "are you sure?" confirm. Once the online
//      cancellation deadline has passed, the row says so and how to reach the salon instead.
//
// Effects go through the injectable MyBookingsPort. History and cancellation require possession of
// the current high-entropy email-scoped token; requesting another link replaces the previous token.

import type { JSX } from 'preact'
import { useContext, useEffect, useRef, useState } from 'preact/hooks'
import { PreviewPorts } from '../cms/PreviewPorts'
import { CmsSceneContext } from '../cms/Scene'
import { NativeRegion, type NativeInstanceOptions } from '../cms/NativeSurface'
import { createInstanceScope } from '../cms/instanceScope'
import { defaultClock } from '../config'
import type { Clock } from '../config'
import type { BusinessSettings } from '../site/siteChrome'
import { Dialog } from '../ui/Dialog'
import { focusQuietly } from '../ui/pageFocus'
import { FOCUS_CLS } from '../ui/pseudo'
import {
  buildBookingStyles,
  palette,
  sheetBackdropStyle,
  systemRed,
} from '../booking/bookingStyles'
import { parseEmail } from '../booking/validation'
import { Turnstile, turnstileConfigured } from '../booking/Turnstile'
import type { Lang } from '../i18n/index'
import { myBookingsStrings } from '../i18n/index'
import { customerEmailLinkStrings } from '../i18n/customerEmailLinkStrings'
import type { CustomerProfile, MyBooking, MyBookings } from './domain'
import { defaultMyBookingsPort } from './adapters/index'
import type { MyBookingsPort } from './port'
import { CustomerEmailLink } from './CustomerEmailLink'
import { onlineCancellationOpen } from './format'

type Mode = 'light' | 'dark'
type Step = 'loading' | 'lookup' | 'sent' | 'list'

/** Where keyboard focus goes once the control that had it has left the dialog. */
type FocusTarget = 'sent' | 'notice' | 'cancelButton' | 'cancelQuestion' | 'cancelClosed'

/** Why the list is read. `opened`: with a link token, or because the customer asked; a refusal says
 * the link is invalid. `restored`: looking for a saved session; a refusal is silent. `afterCancel`:
 * a cancel was just answered and the rows may be out of date; only they are read again, so the open
 * row, its question and any message stay as they are. */
type ListRead = 'opened' | 'restored' | 'afterCancel'

/** What the list's note says: the cancel went through, or a cancel the server did not carry out
 * left the list without the booking. Kept as the reason: the text is written at render. */
type ListNotice = 'cancelled' | 'gone'

/** The salon settings this dialog acts on: the online cancellation deadline (hours before the
 * visit) and how to reach the salon once it has passed. */
export type CancellationTerms = Pick<
  BusinessSettings,
  'cancellationPolicyHours' | 'phoneTel' | 'phoneDisplay' | 'email'
>

const BACKDROP_STYLE = sheetBackdropStyle(60)

// The salon's contact links in the deadline note: the look of the terms link in the booking popup.
const CONTACT_LINK_STYLE = 'color:inherit;text-underline-offset:3px;'

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
  /** Current owner-managed business settings: the online cancellation deadline (hours before the
   * visit) and how to reach the salon once it has passed. `'unknown'` from a mount that has not
   * loaded them: the shipped defaults are not the owner's settings, so a dialog that does not know
   * the deadline always offers the cancel button (the server decides), never shows the deadline
   * note, and states no number of hours. */
  readonly business: CancellationTerms | 'unknown'
  /** Injected clock — "now" for the cancellation deadline (default: env-selected). */
  readonly clock?: Clock
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
  const example = useContext(CmsSceneContext)?.customer
  const previewPorts = useContext(PreviewPorts)
  const lang = props.lang
  const t = myBookingsStrings(lang)
  const dark = props.mode === 'dark'
  const c = palette(dark)
  const s = buildBookingStyles(c, dark, false)
  const red = systemRed(dark)
  const port: MyBookingsPort = props.port ?? defaultMyBookingsPort
  const terms = props.business
  const clock: Clock = props.clock ?? defaultClock
  /** The salon's terms once the online cancellation deadline for `b` has passed at `at`;
   * `undefined` while it is open, and always when this mount does not know the deadline. */
  const passedDeadline = (b: MyBooking, at: Date): CancellationTerms | undefined =>
    terms !== 'unknown' && !onlineCancellationOpen(b.start, at, terms.cancellationPolicyHours)
      ? terms
      : undefined

  const [step, setStep] = useState<Step>(props.accessError !== undefined ? 'lookup' : 'loading')
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
  const [expandedId, setExpandedId] = useState<string | null>(example?.expandedId ?? null)
  const [cancelFor, setCancelFor] = useState<string | null>(null)
  const [cancelBusy, setCancelBusy] = useState<boolean>(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [notice, setNotice] = useState<ListNotice | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)
  const challengeRequired = turnstileConfigured && previewPorts === undefined
  // Cloudflare runs the challenge on render and stalls the compositor ~1.5 s, so the widget mounts
  // on the first email keystroke instead of on open; the latch never resets within this session.
  const [challengeStarted, setChallengeStarted] = useState(false)

  const emailInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (step === 'lookup') emailInputRef.current?.focus()
  }, [step])

  // An action can remove the control that has focus (the lookup button, the cancel button, the
  // confirm buttons, a whole row). Focus would then fall to <body>, outside the dialog's Tab trap.
  // The action names what should take focus instead; it is focused once that render has happened.
  // A text takes it quietly (no outline, focusable only while it holds the focus); the cancel
  // button is a control and takes it as one.
  const focusNext = useRef<FocusTarget | null>(null)
  const sentRef = useRef<HTMLParagraphElement>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const cancelQuestionRef = useRef<HTMLParagraphElement>(null)
  const cancelClosedRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const target = focusNext.current
    if (target === null) return
    focusNext.current = null
    if (target === 'cancelButton') {
      cancelButtonRef.current?.focus()
      return
    }
    const texts = {
      sent: sentRef,
      notice: noticeRef,
      cancelQuestion: cancelQuestionRef,
      cancelClosed: cancelClosedRef,
    }
    focusQuietly(texts[target].current)
  })

  /** Reads the list. Resolves to the rows it showed, or `null` when it showed none (the read
   * failed, or another read or session replaced it meanwhile). */
  async function loadBookings(
    token: string,
    purpose: ListRead = 'opened',
  ): Promise<MyBookings | null> {
    const owner = lifetime.current
    if (!owner.active) return null
    const read = ++owner.read
    owner.reading = true
    const current = (): boolean => owner.active && read === owner.read
    setBusy(true)
    setSystemError(null)
    try {
      const result = await port.list({ accessToken: token, lang })
      if (!current()) return null
      if (!result.ok) {
        if (result.error === 'system' && bookings !== null) {
          setSystemError(t.errSystem)
          return null
        }
        props.onProfile?.(undefined)
        setProfile(null)
        setBookings(null)
        setAccessToken(null)
        setStep('lookup')
        const errors = {
          cookies_disabled: t.errCookies,
          access_denied: purpose === 'restored' ? null : t.errAccess,
          system: t.errSystem,
        }
        setSystemError(errors[result.error])
        return null
      }
      setBookings(result.bookings)
      setDeviceOnly(result.authority === 'device')
      setProfile(result.authority === 'verified' ? result.profile : null)
      props.onProfile?.(result.profile)
      // Initial link token is used only for this request. Subsequent operations use HttpOnly cookie.
      setAccessToken('')
      if (purpose !== 'afterCancel') {
        setExpandedId(example?.expandedId ?? null)
        setCancelFor(null)
        setPastOpen(false)
        setNotice(null)
      }
      setStep('list')
      return result.bookings
    } catch {
      if (!current()) return null
      if (bookings !== null) {
        setSystemError(t.errSystem)
        return null
      }
      props.onProfile?.(undefined)
      setProfile(null)
      setAccessToken(null)
      setStep('lookup')
      setSystemError(t.errSystem)
      return null
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
      void loadBookings('', 'restored')
    }
  }, [props.accessToken])

  async function requestAccess(): Promise<void> {
    const owner = lifetime.current
    if (!owner.active || owner.request) return
    const parsedEmail = parseEmail(email)
    if (!parsedEmail.ok) {
      setEmailError(true)
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
        focusNext.current = 'sent'
      } else {
        const errors = {
          failed_challenge: t.errChallenge,
          rate_limited: t.errRateLimited,
          system: t.errSystem,
        }
        setSystemError(errors[result.error])
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
    if (!challengeStarted && e.currentTarget.value !== '') setChallengeStarted(true)
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

  /** Reads the rows again after a cancel the server did not carry out. If the booking is no longer
   * among them, its row is gone, and with it the question, the message and the button that held
   * the focus: the list's note says what the customer now sees, and takes the focus. Which
   * question is open, and its message, are left as they are: nothing draws them without their
   * row, and the customer may have opened another booking's question while these rows were read. */
  const rereadAfterRefusal = async (b: MyBooking): Promise<void> => {
    const rows = await loadBookings('', 'afterCancel')
    if (rows !== null && !rows.upcoming.some((x) => x.id === b.id)) {
      setNotice('gone')
      focusNext.current = 'notice'
    }
  }

  const onConfirmCancel = async (b: MyBooking): Promise<void> => {
    const owner = lifetime.current
    if (!owner.active || owner.cancel) return
    owner.cancel = true
    // The list read whose rows this cancel is asked from.
    const rowsRead = owner.read
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
        if (result.error === 'not_found') {
          // The customer has left those rows while the answer was on its way (to ask for a link
          // for another e-mail address), or a newer read has replaced them: nothing is said about
          // this cancel, and nothing is read that would put a list back in front of them.
          if (owner.read !== rowsRead) return
          // The server gives this one answer for every cancel that changed nothing: the deadline has
          // passed by its clock and setting, or the booking is already cancelled (an earlier try
          // whose answer was lost), or it is no longer this customer's. It does not say which.
          if (passedDeadline(b, clock()) !== undefined) {
            // The deadline has passed here too (it can pass while the row is open). The render that
            // follows reads the clock again and shows the deadline note in place of the question.
            setCancelFor(null)
            focusNext.current = 'cancelClosed'
            return
          }
          // Otherwise the rows are out of date in a way this dialog cannot tell (or it does not
          // know the deadline): say that the cancel failed and read them again. The cancel itself
          // is over: the read is not awaited, so the `finally` below releases the question's
          // buttons before the rows have come back.
          setCancelError(t.errCancel)
          void rereadAfterRefusal(b)
          return
        }
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
      setNotice('cancelled')
      focusNext.current = 'notice'
      // A merge-triggered list read may have captured this booking before cancellation committed.
      // It reads the rows only: the note above stays, and keeps the focus.
      if (reload) void loadBookings('', 'afterCancel')
    } catch {
      if (owner.active) setCancelError(t.errCancel)
    } finally {
      owner.cancel = false
      if (owner.active) setCancelBusy(false)
    }
  }

  // --- shared bits ---------------------------------------------------------------------------------

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

  // The online cancellation deadline, in the customer's words, followed by the salon's contact
  // links. Shown in place of the cancel button once the deadline has passed. It is keyed and placed
  // after the row's other details: the CMS identifies those by position, and they keep theirs.
  // A link is shown only for contact details the business has: a phone needs both its number and
  // its written form.
  const now = clock()
  const cancelClosedNote = (salon: CancellationTerms): JSX.Element => {
    const hasPhone = salon.phoneTel !== '' && salon.phoneDisplay !== ''
    const hasEmail = salon.email !== ''
    return (
      <p
        key="cancel-closed"
        ref={cancelClosedRef}
        style="font-size:13px;line-height:1.45;margin:4px 0 0;"
      >
        {t.cancelClosed.split('{hours}').join(String(salon.cancellationPolicyHours))}{' '}
        {hasPhone ? (
          <a href={`tel:${salon.phoneTel}`} class={FOCUS_CLS} style={CONTACT_LINK_STYLE}>
            {salon.phoneDisplay}
          </a>
        ) : null}
        {hasPhone && hasEmail ? ' · ' : null}
        {hasEmail ? (
          <a href={`mailto:${salon.email}`} class={FOCUS_CLS} style={CONTACT_LINK_STYLE}>
            {salon.email}
          </a>
        ) : null}
      </p>
    )
  }

  const bookingRow = (b: MyBooking, upcoming: boolean): JSX.Element => {
    const open = expandedId === b.id
    const confirming = cancelFor === b.id
    // The server refuses a cancellation closer to the start than the policy allows, by its own
    // clock and setting. This comparison is the dialog's own, read at each render, and only hides
    // the button ahead of that refusal; a mount that does not know the deadline never hides it.
    // An example booking in the Studio never takes this branch: its scene stores the cancel
    // button, whatever deadline the owner has set.
    const pastDeadline = upcoming && !example ? passedDeadline(b, now) : undefined
    const instanceOptions: NativeInstanceOptions = example
      ? {}
      : { instance: b.id, scopeFactory: createInstanceScope }
    return (
      <NativeRegion
        key={b.id}
        surface="my-booking-card"
        lang={lang}
        mode={props.mode}
        {...instanceOptions}
      >
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
              {upcoming && pastDeadline === undefined ? (
                confirming ? (
                  <div style={{ marginTop: '4px' }}>
                    <p
                      ref={cancelQuestionRef}
                      style="font-size:13px;line-height:1.45;margin:0 0 10px;"
                    >
                      {t.cancelConfirmQ}
                    </p>
                    {cancelError !== null ? (
                      <p role="alert" style={{ ...s.submitErrorStyle, margin: '0 0 10px' }}>
                        {cancelError}
                      </p>
                    ) : null}
                    <div style="display:flex;gap:10px;">
                      <button
                        type="button"
                        onClick={() => {
                          setCancelFor(null)
                          setCancelError(null)
                          focusNext.current = 'cancelButton'
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
                    ref={cancelButtonRef}
                    type="button"
                    onClick={() => {
                      setCancelFor(b.id)
                      setCancelError(null)
                      focusNext.current = 'cancelQuestion'
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
              {pastDeadline !== undefined ? cancelClosedNote(pastDeadline) : null}
            </div>
          ) : null}
        </div>
      </NativeRegion>
    )
  }

  const changeEmailLink = (
    <button
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
      titleId={step === 'list' ? 'knc-mybookings-list-title' : 'knc-mybookings-title'}
      cms={{
        surface: step === 'list' ? 'my-bookings-list' : 'my-bookings',
        lang,
        mode: props.mode,
      }}
      onClose={props.onClose}
      onBackdropClick={onBackdrop}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <div style={s.overlayHeaderStyle}>
        {/* A heading by role, not by tag: the published presentation stores this element as a
            `span`, and its look must not change. */}
        <span
          id={step === 'list' ? 'knc-mybookings-list-title' : 'knc-mybookings-title'}
          role="heading"
          aria-level={2}
          style="font-family:'Inter Variable';font-weight:600;font-size:17px;"
        >
          {t.title}
        </span>
        <button onClick={props.onClose} style={s.closeBtnStyle} aria-label={t.ariaClose}>
          ×
        </button>
      </div>

      <div style="padding:16px 18px 18px;">
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
          <p style={{ fontSize: '13px', lineHeight: 1.45, opacity: 0.7, margin: '0 0 14px' }}>
            {t.deviceBookingsNote}
          </p>
        ) : null}
        {step === 'loading' ? <p role="status">{t.loadingBookings}</p> : null}
        {step === 'lookup' ? (
          <div>
            <p style="font-size:13.5px;opacity:.6;line-height:1.45;margin:0;">{t.lookupLead}</p>
            <label style="display:flex;flex-direction:column;gap:5px;margin-top:12px;">
              <span style="font-size:12px;font-weight:600;opacity:.55;">{t.email}</span>
              <input
                ref={emailInputRef}
                value={email}
                onInput={onEmail}
                placeholder={t.emailPh}
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-required="true"
                aria-invalid={emailError ? 'true' : undefined}
                style={emailError ? s.inputErrorStyle : s.inputStyle}
                class={FOCUS_CLS}
              />
              {emailError ? (
                <span role="alert" style={s.fieldErrorNoteStyle}>
                  {t.errEmail}
                </span>
              ) : null}
            </label>
            {systemError !== null ? (
              <p role="alert" style={{ ...s.submitErrorStyle, marginTop: '14px' }}>
                {systemError}
              </p>
            ) : null}
            {challengeRequired && challengeStarted && (
              <Turnstile
                action="customer_access"
                lang={lang}
                onToken={setTurnstileToken}
                resetNonce={turnstileNonce}
              />
            )}
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

        {step === 'sent' ? (
          <div style="display:flex;flex-direction:column;gap:16px;">
            <p ref={sentRef} role="status" style="font-size:13.5px;line-height:1.5;margin:0;">
              {t.accessSent}
            </p>
            <div style="display:flex;justify-content:center;padding-top:2px;">
              {changeEmailLink}
            </div>
          </div>
        ) : null}

        {step === 'list' && bookings !== null ? (
          <div style="display:flex;flex-direction:column;gap:16px;">
            {systemError !== null ? (
              <div>
                <p role="alert" style={{ ...s.submitErrorStyle, margin: '0 0 8px' }}>
                  {systemError}
                </p>
                <button
                  type="button"
                  class={FOCUS_CLS}
                  style={s.bookBtnStyle}
                  disabled={busy}
                  onClick={() => void loadBookings('')}
                >
                  {customerEmailLinkStrings(lang).refresh}
                </button>
              </div>
            ) : null}
            {/* The checkmark says that something went through. The note about a booking that is no
                longer in the list is not that: there the icon stays in its place in the tree (the
                published presentation identifies it by position) and is not shown. */}
            {notice !== null ? (
              <div
                ref={noticeRef}
                role="status"
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
                  aria-hidden={notice === 'gone' ? 'true' : undefined}
                  style={{
                    width: '14px',
                    height: '14px',
                    filter: c.iconF,
                    opacity: 0.7,
                    ...(notice === 'gone' ? { display: 'none' } : {}),
                  }}
                />
                {notice === 'cancelled' ? t.cancelledNote : t.bookingGoneNote}
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

            {props.emailLinkCode === undefined && profile !== null ? (
              <CustomerEmailLink
                lang={lang}
                dark={dark}
                port={port}
                profile={profile}
                onLinked={() => void loadBookings('')}
              />
            ) : null}

            <div style="display:flex;justify-content:center;padding-top:2px;">
              {changeEmailLink}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
