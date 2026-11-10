import { NativeRegion, useNativeChild } from '../cms/NativeSurface'
import { CmsSceneContext } from '../cms/Scene'
// The 4-step booking flow (barber → date → service → time), ported from the original mock; the
// details + confirmation modals live in their own components. Inline styles/literals match the
// mock's rendering. Submit flows through the injectable `BookingPort` (default: env-selected —
// Supabase when configured, the local calendar adapter otherwise).

import type { JSX, RefObject } from 'preact'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { PreviewPorts } from '../cms/PreviewPorts'
import { DEFAULT_BUSINESS, defaultClock } from '../config'
import type { Clock } from '../config'
import type { BookingStrings, Lang } from '../i18n/index'
import { appStrings, bookingStrings, myBookingsStrings } from '../i18n/index'
import type { BookingPopupTextKey } from '../site/siteChrome'
import type { BusinessSettings } from '../site/siteChrome'
import {
  cap,
  buildWeeks,
  iso,
  isSelectableBookingDate,
  monthLabel,
  parseDateIso,
  weekdayLabel,
  headerLabels,
} from './calendar'
import type { Barber, Booking, BookingDraft, BookingError, BookingResult } from './domain'
import { initialDraft } from './domain'
import { useServices } from './useServices'
import { defaultBookingPort } from './adapters/index'
import type { BookingPort } from './port'
import type { BarbersPort } from './barbersPort'
import type { ServicesPort } from './servicesPort'
import { useRoster } from './useRoster'
import { parseContact } from './validation'
import type { FieldErrors } from './validation'
import type { BookingContact } from '../mybookings/domain'
import { buildBookingStyles, makeNavBtn, palette } from './bookingStyles'
import { Turnstile, turnstileConfigured } from './Turnstile'
import { DetailsDialog } from './DetailsDialog'
import { ConfirmationDialog } from './ConfirmationDialog'
import { stockholmWallClockDate } from './stockholmTime'
import { focusQuietly } from '../ui/pageFocus'
import { pseudoClass } from '../ui/pseudo'
import { prefersReducedMotion } from '../ui/reducedMotion'

type Mode = 'light' | 'dark'

/** Pristine per-field error state — nothing flagged (the default popup). */
const NO_FIELD_ERRORS: FieldErrors = { name: false, phone: false, email: false }

/** The availability read for one barber+date+service selection (`key`). A failed read is its own
 * state, so the "no times" message can only follow a real, empty answer; the key ties an answer
 * to the selection it was read for, so it is never shown for another one. */
type SlotsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly key: string; readonly times: readonly string[] }
  | { readonly status: 'error'; readonly key: string }

const SLOTS_LOADING: SlotsState = { status: 'loading' }

/** Why the flow shows an error line about a submit: in the details popup, or in the time step when
 * the line cannot stand in the popup it belongs to. A reason, never a text: the line is written at
 * each render, in the language on screen then. A refusal keeps the name the port gave it; the other
 * two are the flow's own. `possiblyBooked`: the time whose last submit ended without an answer was
 * refused as unavailable. `pending`: the book button was pressed while the submit for another time
 * was still on its way. */
type SubmitNotice = BookingError['kind'] | 'possiblyBooked' | 'pending'

const SUBMIT_NOTICE_TEXT: Readonly<Record<SubmitNotice, keyof BookingStrings>> = {
  validation: 'errSubmit',
  submit: 'errSubmit',
  read_only: 'errReadOnly',
  rate_limited: 'errRateLimited',
  failed_challenge: 'errChallenge',
  unavailable: 'errSlotTaken',
  unconfirmed: 'errUnconfirmed',
  possiblyBooked: 'errPossiblyBooked',
  pending: 'errSubmitPending',
}

/** A line about a submit shown in the time step (a refusal, or the warning that a submit ended
 * without an answer while no popup was open), tied to the selection whose times are on screen when
 * it is shown. For a refused start time that is the selection the refusal was given for. */
interface RefusedSlot {
  readonly key: string
  readonly notice: SubmitNotice
}

/** Identity of a complete barber+date+service selection (`null` while any part is missing). */
function slotSelectionKey(
  barberId: string | null,
  dateIso: string | null,
  serviceId: string | undefined,
): string | null {
  return barberId === null || dateIso === null || serviceId === undefined
    ? null
    : `${barberId}|${dateIso}|${serviceId}`
}

/** Identity of one start time within a selection: the slot a submit asks for (`null` while the
 * selection or the time is missing). */
function slotKeyAt(selection: string | null, time: string | null): string | null {
  return selection === null || time === null ? null : `${selection}|${time}`
}

/** What the visitor has in front of them at one moment: the selection whose times are shown, the
 * chosen slot, whether its details popup is open, and the Turnstile token the flow holds for that
 * popup. */
interface ChosenNow {
  readonly selection: string | null
  readonly slot: string | null
  readonly popupOpen: boolean
  readonly token: string
}

const NOTHING_CHOSEN: ChosenNow = { selection: null, slot: null, popupOpen: false, token: '' }

// The CMS identifies an unkeyed element by its position among its siblings, and the published
// presentation stores those positions. A message that moved into a step's status region therefore
// leaves this in its old place, so the siblings after it keep their position.
const KEPT_POSITION = null

// A failed read: one line and a retry button, in the look of the Turnstile failure line (the
// flow's existing "could not …, try again").
const READ_ERROR_STYLE: JSX.CSSProperties = { fontSize: '12px', lineHeight: 1.5, margin: '8px 0' }
const RETRY_BUTTON_STYLE: JSX.CSSProperties = {
  padding: '4px 0',
  color: 'inherit',
  background: 'transparent',
  border: 0,
  font: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
}

/** Move keyboard focus to the title of the step that holds `region`. Used when the focused control
 * is about to leave the page (a retry button, or the time chip a closed popup returns focus to).
 * The title is found from the region, not through a ref of its own: a ref would make the CMS
 * treat the title as a code-owned control. The title is text, not a control: it takes the focus
 * without a focus outline and without staying focusable (`focusQuietly`). */
function focusStepTitle(region: HTMLElement | null): void {
  focusQuietly(region?.parentElement?.querySelector<HTMLElement>('[role="heading"]') ?? null)
}

// The flow's root element, by the name it carries (`data-knc-fold`, set where the flow renders).
const FLOW_ROOT = '[data-knc-fold="booking-flow"]'

/** Whether the keyboard focus is the flow's to move: it is inside the flow that holds `region`, or
 * nowhere in particular (on the `body`, or on nothing). A focus held anywhere else is the
 * visitor's (they may be typing in another dialog): the flow leaves it where it is. */
function focusIsTheFlows(region: HTMLElement | null): boolean {
  const active = document.activeElement
  if (active === null || active === document.body) return true
  return region?.closest(FLOW_ROOT)?.contains(active) === true
}

/** Bring the refusal line of the step that holds `region` into view. The step's title takes the
 * focus without scrolling, and on a narrow screen the line stands below the times. `nearest` moves
 * nothing when the line is already in view, and the scroll is never animated, so it is the same
 * for a visitor who asked for reduced motion. */
function showStepRefusal(region: HTMLElement | null): void {
  region?.parentElement
    ?.querySelector<HTMLElement>('[role="alert"]')
    ?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

export interface BookingFlowProps {
  readonly mode?: Mode
  readonly defaultLang?: Lang
  readonly showDirections?: boolean
  /** Injected clock — "today" comes from here, never `new Date()` (default: env-selected). */
  readonly clock?: Clock
  /** Injected submit seam (default: env-selected; local adapter when no backend is configured). */
  readonly port?: BookingPort
  /** Injected roster seam — barbers shown in step 1 (default: env-selected; offline = empty). */
  readonly barbersPort?: BarbersPort
  /** Injected services seam — chosen barber's menu in step 3 (default: env-selected; offline = empty). */
  readonly servicesPort?: ServicesPort
  /** Open the app-level "Mina bokningar" popup — surfaced on the confirmation screen. */
  readonly onMyBookings?: () => void
  /** Owner-edited customer copy for the policy notice and confirmation title. */
  readonly popupText?: BookingPopupText
  /** Current owner-managed business identity used by confirmation calendar/map links. */
  readonly business?: BusinessSettings
  readonly initialContact?: BookingContact
  readonly onBookingComplete?: () => void
  /** The initial roster has resolved, including a truthful empty/error state. */
  readonly onRosterReady?: () => void
}

export type BookingPopupText = Readonly<Pick<BookingStrings, BookingPopupTextKey>>

export function BookingFlow(props: BookingFlowProps): JSX.Element {
  const present = useNativeChild()
  const previewPorts = useContext(PreviewPorts)
  const scene = useContext(CmsSceneContext)?.booking
  const [state, setRaw] = useState<BookingDraft>(initialDraft)
  const typedContact = useRef({ name: false, phone: false, email: false })
  // Port result, per-FIELD validation errors, and the details popup's own error line all live
  // OUTSIDE the domain draft. The line is kept as its reason, not as text (`SubmitNotice`). An
  // answer shown in the popup clears the field errors, and a failed validation clears the line.
  const [result, setResult] = useState<BookingResult | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS)
  const [submitError, setSubmitError] = useState<SubmitNotice | null>(null)
  // Real availability: the AVAILABLE start times for the chosen barber+date+service, loaded through
  // the port (DB-backed when configured, the deterministic `packSlots` grid under the mock). The grid
  // renders exactly these as selectable chips. `loading` covers the in-flight fetch and the time
  // before a full selection exists; `error` is a failed read. `loadedSlots` is the last answer and
  // names the selection it was read for; `slots` (below) is what this render may show of it.
  // `slotsAttempt` is bumped to read the same selection again (a retry, or after the server refused
  // the chosen time).
  const [loadedSlots, setLoadedSlots] = useState<SlotsState>(SLOTS_LOADING)
  const [slotsAttempt, setSlotsAttempt] = useState<number>(0)
  const [refusedSlot, setRefusedSlot] = useState<RefusedSlot | null>(null)
  // The three steps that read data each own one persistent status region (see `statusRegion`).
  const barbersRegion = useRef<HTMLDivElement>(null)
  const servicesRegion = useRef<HTMLDivElement>(null)
  const timesRegion = useRef<HTMLDivElement>(null)
  // Set when the time step must take focus after the next render (the chosen time was refused, and
  // the focus was the flow's to move).
  const focusTimesNext = useRef(false)
  // What `onBook` must know at the moment it is called or answered, which the state of the render
  // that created it cannot promise (a second activation, or an answer, can arrive before the next
  // render): the slot whose submit is on its way; a booking exists; the slot chosen now and whether
  // its popup is open; and the slot whose last submit ended without an answer, so the server may
  // have booked it all the same. That doubt stays while the visitor looks at other times: only a
  // submit that succeeds, or starting over, ends it (a later unanswered submit for another slot
  // replaces it).
  const pendingSubmit = useRef<string | null>(null)
  const booked = useRef(false)
  const chosenNow = useRef<ChosenNow>(NOTHING_CHOSEN)
  const unconfirmedSlot = useRef<string | null>(null)
  // Two of these are also drawn, so each has a state that is set together with it: the slot whose
  // submit is on its way marks its popup's book button as busy, and the doubt puts its warning in
  // every details popup.
  const [busySlot, setBusySlot] = useState<string | null>(null)
  const [doubt, setDoubt] = useState<boolean>(false)
  const markPending = (slot: string | null): void => {
    pendingSubmit.current = slot
    setBusySlot(slot)
  }
  const markUnconfirmed = (slot: string | null): void => {
    unconfirmedSlot.current = slot
    setDoubt(slot !== null)
  }
  // Turnstile token (proves the submitter is human; verified by the submit-booking gateway) + a
  // nonce bumped after a submit attempt, when the flow still holds the token that attempt sent, to
  // force a FRESH token (Turnstile tokens are single-use and expire ~5 min). Empty token =
  // unconfigured/offline → the gateway fails open.
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  const [turnstileNonce, setTurnstileNonce] = useState<number>(0)

  const setState = (
    u: Partial<BookingDraft> | ((s: BookingDraft) => Partial<BookingDraft>),
  ): void => setRaw((s) => ({ ...s, ...(typeof u === 'function' ? u(s) : u) }))
  useLayoutEffect(() => {
    const contact = props.initialContact
    // Synchronize before paint: deferred effects can expose the previous customer's auto-fill.
    // Only actual edits survive a profile switch/clear, including an intentionally emptied field.
    setState((current) => ({
      form: {
        name: typedContact.current.name ? current.form.name : (contact?.name ?? ''),
        phone: typedContact.current.phone ? current.form.phone : (contact?.phone ?? ''),
        email: typedContact.current.email ? current.form.email : (contact?.email ?? ''),
      },
    }))
  }, [props.initialContact])
  const reset = (): void => {
    typedContact.current = { name: false, phone: false, email: false }
    booked.current = false
    markUnconfirmed(null)
    setResult(null)
    setFieldErrors(NO_FIELD_ERRORS)
    setSubmitError(null)
    setTurnstileToken('')
    setState({
      barberId: null,
      dateIso: null,
      time: null,
      service: null,
      showPopup: false,
      booked: false,
      monthOffset: 0,
      form:
        props.initialContact === undefined
          ? { name: '', phone: '', email: '' }
          : { ...props.initialContact },
    })
  }
  const closePopup = (): void => {
    setFieldErrors(NO_FIELD_ERRORS)
    setSubmitError(null)
    setTurnstileToken('')
    setState({ showPopup: false })
  }
  /** Clear one field's error (and any stale system error) when the user edits that field. */
  const clearFieldError = (field: keyof FieldErrors): void => {
    setSubmitError(null)
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: false } : prev))
  }

  const lang: Lang = state.lang ?? props.defaultLang ?? 'sv'
  const business = props.business ?? DEFAULT_BUSINESS
  const defaultText = bookingStrings(lang)
  const t: BookingStrings = {
    ...defaultText,
    policy: defaultText.policy
      .split('{hours}')
      .join(String(business.cancellationPolicyHours))
      .split('{businessName}')
      .join(business.name),
    ...props.popupText,
  }
  const dark = (props.mode ?? 'light') === 'dark'
  const showDirections = props.showDirections !== false
  const clock: Clock = props.clock ?? defaultClock
  const port: BookingPort = previewPorts?.booking ?? props.port ?? defaultBookingPort
  const {
    roster,
    status: rosterStatus,
    retry: retryRoster,
  } = useRoster(previewPorts?.barbers ?? props.barbersPort)
  const rosterLoading = rosterStatus === 'loading'
  useEffect(() => {
    if (!rosterLoading) {
      props.onRosterReady?.()
      if (previewPorts) document.documentElement.dataset['kncBookingReady'] = '1'
    }
  }, [rosterLoading, props.onRosterReady, props.mode, props.defaultLang, previewPorts])
  const today = stockholmWallClockDate(clock())
  const S = state
  const {
    services: barberServices,
    status: servicesStatus,
    retry: retryServices,
  } = useServices(S.barberId, S.dateIso, previewPorts?.services ?? props.servicesPort)
  useEffect(() => {
    if (!scene || !roster[0]) return
    const date = new Date(today)
    date.setDate(date.getDate() + 3)
    setState({ barberId: roster[0].barber.id, dateIso: iso(date) })
  }, [scene, roster])
  useEffect(() => {
    if (!scene || !barberServices[0]) return
    setState({
      service: barberServices[0],
      time: '10:30',
      showPopup: scene === 'details',
      booked: scene === 'confirmation',
      form: { name: 'Exempelkund', phone: '0700000000', email: 'kund@example.test' },
    })
  }, [scene, barberServices])

  // Load real availability whenever barber + date + service are all chosen. The result is the list of
  // AVAILABLE start times; the grid renders exactly those as chips. A `cancelled` flag drops stale
  // responses so fast re-selection can't show the wrong day's slots. On any failure we fail closed:
  // no chip is offered and the step says the read failed, with a retry (never the empty-state
  // message; create_booking still validates the slot on submit).
  const serviceDur = S.service?.dur
  const serviceId = S.service?.id
  const slotKey = slotSelectionKey(S.barberId, S.dateIso, serviceId)
  // An answer read for another selection says nothing about this one: until this selection's own
  // answer is in, the step is loading, from the first render after the selection changed.
  const slots: SlotsState =
    loadedSlots.status !== 'loading' && loadedSlots.key === slotKey ? loadedSlots : SLOTS_LOADING
  chosenNow.current = {
    selection: slotKey,
    slot: slotKeyAt(slotKey, S.time),
    popupOpen: S.showPopup,
    token: turnstileToken,
  }
  useEffect(() => {
    if (!scene) return
    const ready =
      S.barberId &&
      S.service &&
      servicesStatus === 'ready' &&
      slots.status === 'ready' &&
      slots.times.length > 0 &&
      (scene !== 'details' || S.showPopup) &&
      (scene !== 'confirmation' || S.booked)
    document.documentElement.dataset['kncExampleReady'] = ready ? `booking-${scene}` : ''
  }, [scene, S.barberId, S.service, S.showPopup, S.booked, servicesStatus, slots])
  useEffect(() => {
    // A refusal belongs to the selection it was given for; any other selection drops it.
    const key = slotSelectionKey(S.barberId, S.dateIso, serviceId)
    setRefusedSlot((refused) => (refused !== null && refused.key !== key ? null : refused))
    if (
      key === null ||
      S.barberId === null ||
      S.dateIso === null ||
      serviceDur === undefined ||
      serviceId === undefined
    ) {
      setLoadedSlots(SLOTS_LOADING)
      return
    }
    let cancelled = false
    setLoadedSlots(SLOTS_LOADING)
    void port
      .availability({
        barberId: S.barberId,
        dateIso: S.dateIso,
        durationMin: serviceDur,
        serviceId,
      })
      .then((result) => {
        if (cancelled) return
        setLoadedSlots(
          result.ok ? { status: 'ready', key, times: result.times } : { status: 'error', key },
        )
      })
      .catch(() => {
        if (cancelled) return
        setLoadedSlots({ status: 'error', key })
      })
    return () => {
      cancelled = true
    }
  }, [port, S.barberId, S.dateIso, serviceDur, serviceId, slotsAttempt])
  // After a refused time the details popup closes and returns focus to the chip that opened it,
  // which the reload then removes. Move focus to the step's title once that render has happened,
  // and bring the line that says why into view.
  useEffect(() => {
    if (!focusTimesNext.current) return
    focusTimesNext.current = false
    focusStepTitle(timesRegion.current)
    showStepRefusal(timesRegion.current)
  })

  const c = palette(dark)
  const navBtn = makeNavBtn(c)

  const barbers = roster.map((entry) => {
    const b = entry.barber
    const sel = S.barberId === b.id
    return {
      ...b,
      initial: b.name[0] ?? '',
      selected: sel,
      cardStyle: {
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        padding: '13px 14px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        borderRadius: '14px',
        background: c.card,
        border: sel ? '1.5px solid ' + c.accent : '0.5px solid ' + c.line,
        boxShadow: sel
          ? dark
            ? '0 0 0 1px ' + c.accent
            : '0 2px 10px rgba(0,0,0,.1)'
          : '0 1px 2px rgba(0,0,0,.05)',
        transition: 'border-color .15s, box-shadow .15s',
      } satisfies JSX.CSSProperties,
      avatarStyle: {
        flex: 'none',
        width: '42px',
        height: '42px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter Variable'",
        fontWeight: 600,
        fontSize: '17px',
        background: sel ? c.accent : c.subtle,
        color: sel ? c.accentText : c.text,
      } satisfies JSX.CSSProperties,
      onSelect: () => {
        // With `booked` goes the confirmation: from here a new booking may be submitted.
        booked.current = false
        setState({
          barberId: b.id,
          dateIso: null,
          time: null,
          service: null,
          showPopup: false,
          booked: false,
        })
      },
    }
  })

  const base = new Date(today.getFullYear(), today.getMonth() + S.monthOffset, 1)
  const cy = base.getFullYear()
  const cm = base.getMonth()
  const monthLabelText = cap(monthLabel(lang, cm)) + ' ' + cy
  const calendarWeeks = buildWeeks(cy, cm).map((w) =>
    w.map((cell) => {
      if (!cell) return null
      const cellIso = iso(cell)
      const selectable = isSelectableBookingDate(cell, today)
      const selected = S.dateIso === cellIso
      let bg = 'transparent'
      let color = 'inherit'
      let cursor = 'pointer'
      let op = 1
      if (selected) {
        bg = c.accent
        color = c.accentText
      } else if (!selectable) {
        cursor = 'default'
        op = 0.32
      }
      return {
        day: cell.getDate(),
        cellStyle: {
          aspectRatio: '1 / 1',
          minHeight: '34px',
          border: '0.5px solid transparent',
          background: bg,
          color,
          opacity: op,
          borderRadius: '50%',
          fontFamily: 'inherit',
          fontSize: '13.5px',
          fontWeight: selected ? 600 : 500,
          cursor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          transition: 'background .12s',
        } satisfies JSX.CSSProperties,
        onClick: selectable
          ? () => setState({ dateIso: cellIso, time: null, service: null })
          : undefined,
        ariaLabel: `${weekdayLabel(lang, cell.getDay())} ${cell.getDate()} ${monthLabel(lang, cell.getMonth())} ${cell.getFullYear()}${selectable ? '' : ` — ${t.dateUnavailable}`}`,
        disabled: !selectable,
        selected,
      }
    }),
  )
  const canPrev = S.monthOffset > 0
  const canNext = S.monthOffset < 2

  let dateLabelLong = ''
  let selDate: Date | null = null
  if (S.dateIso) {
    const parts = parseDateIso(S.dateIso)
    const yy = parts?.year ?? 0
    const mm = parts?.month ?? 1
    const dd = parts?.day ?? 1
    selDate = new Date(yy, mm - 1, dd)
    dateLabelLong =
      cap(weekdayLabel(lang, selDate.getDay())) + ' ' + dd + ' ' + monthLabel(lang, mm - 1)
  }

  interface ServiceRow {
    name: string
    dur: string
    priceLabel: string
    selected: boolean
    notSelected: boolean
    rowStyle: JSX.CSSProperties
    rowHover: string
    onClick: () => void
  }
  interface ServiceGroupView {
    title: string
    note: string
    items: ServiceRow[]
  }
  // A single, flat group: the chosen barber's menu (no weekday branching). An empty menu (a barber
  // with no active services) renders the "no services" placeholder instead.
  let serviceGroups: ServiceGroupView[] = []
  if (selDate && barberServices.length > 0) {
    serviceGroups = [
      {
        title: '',
        note: '',
        items: barberServices.map((it, idx) => {
          const ssel = S.service !== null && S.service.id === it.id
          return {
            name: it.name,
            dur: it.dur + ' ' + t.min,
            priceLabel: it.price + ' kr',
            selected: ssel,
            notSelected: !ssel,
            rowStyle: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '13px 15px',
              border: 'none',
              borderTop: idx === 0 ? 'none' : '0.5px solid ' + c.line,
              background: ssel ? c.subtle : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontFamily: 'inherit',
            } satisfies JSX.CSSProperties,
            rowHover: 'background:' + c.subtle + ';',
            onClick: () =>
              setState({
                service: { id: it.id, name: it.name, price: it.price, dur: it.dur },
                time: null,
              }),
          }
        }),
      },
    ]
  }

  interface TimeSlot {
    label: string
    selected: boolean
    chipStyle: JSX.CSSProperties
    onClick: () => void
  }
  // Every returned time is AVAILABLE (the adapter already packed + filtered) — render each as a
  // selectable chip; the chosen one gets the accent highlight. No greying/line-through here:
  // unavailable times simply aren't in the list.
  const timeSlots: TimeSlot[] =
    selDate !== null && S.service !== null && slots.status === 'ready'
      ? slots.times.map((time) => {
          const sel = S.time === time
          return {
            label: time,
            selected: sel,
            chipStyle: {
              border: sel ? '1px solid ' + c.accent : '0.5px solid ' + c.inputLine,
              background: sel ? c.accent : c.card,
              color: sel ? c.accentText : 'inherit',
              borderRadius: '9px',
              padding: '9px 4px',
              width: '64px',
              textAlign: 'center',
              fontFamily: 'inherit',
              fontSize: '14px',
              fontWeight: sel ? 600 : 500,
              cursor: 'pointer',
              transition: 'background .12s',
            } satisfies JSX.CSSProperties,
            onClick: () => {
              // Choosing a time answers a refusal of the previous one. Its popup opens without the
              // line of any other popup: an answer that arrived while no popup was open is not
              // shown in this one.
              setRefusedSlot(null)
              setSubmitError(null)
              setState({ time, showPopup: true })
            },
          }
        })
      : []
  const slotNotice =
    refusedSlot !== null && refusedSlot.key === slotKey
      ? t[SUBMIT_NOTICE_TEXT[refusedSlot.notice]]
      : null
  // The popup's own line. Without one, and for whichever time the popup is open: the warning that a
  // submit ended without an answer, for as long as that doubt lasts.
  const popupNotice: SubmitNotice | null = submitError ?? (doubt ? 'unconfirmed' : null)
  const timeSubLabel =
    dateLabelLong !== '' && S.service !== null ? cap(dateLabelLong) + ' · ' + S.service.name : ''

  // Resolve the chosen barber from the LOADED roster (so a DB-only barber resolves too, not just the
  // constants). The selected id always comes from a roster card, so this finds it.
  const barberObj: Barber | undefined = roster.find((e) => e.barber.id === S.barberId)?.barber
  const sumBarber = barberObj ? barberObj.name : ''
  const sumWhen = dateLabelLong !== '' && S.time ? cap(dateLabelLong) + ', ' + S.time : ''
  const sumService = S.service ? S.service.name : ''
  const sumPrice = S.service ? S.service.price + ' kr' : ''

  const f = S.form
  const bookDisabled =
    !(f.name.trim() && f.phone.trim() && f.email.trim()) ||
    (turnstileConfigured && previewPorts === undefined && turnstileToken === '')

  // Confirmation links come from the stored BookingPort result; fall back to '#' before submit
  // (and defensively if result is momentarily null) so the confirmation modal never crashes.
  const icsHref = result?.ok === true ? result.links.icsHref : '#'
  const gcalHref = result?.ok === true ? result.links.gcalHref : '#'
  const mapsHref = result?.ok === true ? result.links.mapsHref : business.mapsHref

  // Confirmation describes the submitted booking, even while next-booking hints refresh.
  // CMS confirmation scenes have no submit result and retain their example draft contact.
  const confirmedContact = result?.ok === true ? result.booking : f
  let confirmSentLine = ''
  if (selDate !== null && S.time && S.service) {
    confirmSentLine = t.confirmSent
      .split('{phone}')
      .join(confirmedContact.phone)
      .split('{email}')
      .join(confirmedContact.email)
  }

  const s = buildBookingStyles(c, dark, bookDisabled)
  const calRowHover = 'background:' + c.subtle + ';'

  const onPopupBackdrop = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) closePopup()
  }
  const onConfirmBackdrop = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) reset()
  }
  const onContact =
    (field: keyof FieldErrors) =>
    (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
      typedContact.current[field] = true
      clearFieldError(field)
      setState((st) => ({ form: { ...st.form, [field]: e.currentTarget.value } }))
    }

  // Submit seam: validate, build a real Booking, send it through the BookingPort, store the
  // result, then advance. One submit at a time, and none once a booking exists. While one is on
  // its way, a second press in the popup of the same time changes nothing (its button is marked
  // busy for assistive technology and looks as it did), and a press in the popup of another time
  // puts a line there that says a booking is already being sent, until that one is answered.
  // Four distinct failure modes:
  //  - VALIDATION failure → flag the offending field(s) red (per-field notes), no system error.
  //  - UNAVAILABLE time (the server refused the chosen start time) → the popup closes with the
  //    entered details kept, the time is deselected, the day's times are read again and the time
  //    step says why. Two exceptions. If the visitor has chosen another time meanwhile, only the
  //    times are read again: their new time and its popup stay. If the previous submit for this
  //    same slot ended without an answer, the refusal may be about the visitor's own booking: the
  //    popup stays open and says so, instead of sending them on to book a second time.
  //  - NO ANSWER (a throw, or an answer that does not say what happened) → the booking may exist.
  //    The slot is remembered as in doubt, and every details popup, open or opened later, for
  //    whichever time, warns about it until a submit succeeds or the visitor starts over. It
  //    warns; it does not block. If no popup is open when the submit ends, the time step says it,
  //    with nothing deselected and nothing read again, until a time is chosen.
  //  - Any OTHER refusal (any other result.ok === false) → its own line, fields left untouched: in
  //    the popup while the popup of the refused time is the one open; otherwise in the time step,
  //    with nothing deselected and nothing read again. It is never shown in the popup of another
  //    time. (The local adapter never fails; a future networked one might.)
  const onBook = async (): Promise<void> => {
    if (booked.current) return
    if (bookDisabled) return
    // unreachable: bookDisabled + the step gating guarantee a selected date/time/service/barber.
    if (selDate === null || S.time === null || S.service === null || slotKey === null) return
    if (barberObj === undefined) return
    const submittedSlot = `${slotKey}|${S.time}`
    if (pendingSubmit.current !== null) {
      if (pendingSubmit.current !== submittedSlot) setSubmitError('pending')
      return
    }
    const contact = parseContact({ name: f.name, phone: f.phone, email: f.email })
    if (!contact.ok) {
      setSubmitError(null)
      setFieldErrors(contact.fields)
      return
    }
    const [hh, mmRaw] = S.time.split(':').map(Number)
    const hours = hh ?? 0
    const minutes = mmRaw ?? 0
    const start = new Date(
      selDate.getFullYear(),
      selDate.getMonth(),
      selDate.getDate(),
      hours,
      minutes,
    )
    const end = new Date(start.getTime() + S.service.dur * 60000)
    const booking: Booking = {
      barber: barberObj,
      service: S.service,
      start,
      end,
      customerName: contact.value.name,
      phone: contact.value.phone,
      email: contact.value.email,
      lang,
      turnstileToken,
    }
    markPending(submittedSlot)
    let answer: BookingResult
    try {
      answer = await port.submit(booking, business)
    } catch {
      // A thrown adapter error is a system failure, not a field error. No answer came back, so the
      // booking may exist all the same: it is handled as an answer that does not say what happened.
      answer = { ok: false, error: { kind: 'unconfirmed', message: t.errUnconfirmed } }
    }
    // Nothing below is inside a `try`: a failure in handling the answer is never taken for a
    // failed submit. The submit is over first, whatever follows.
    markPending(null)
    // The popup of another time may be saying that this submit was on its way.
    setSubmitError((shown) => (shown === 'pending' ? null : shown))
    const now = chosenNow.current
    // The Turnstile token is single-use. If the flow still holds the one this submit sent, the
    // widget that gave it is still on screen and must give a fresh one (e.g. for a rate_limited
    // retry, where the popup stays open). A popup opened since has a widget and a token of its
    // own, which this answer leaves alone.
    if (now.token === booking.turnstileToken) setTurnstileNonce((n) => n + 1)
    const ownPopupOpen = now.slot === submittedSlot && now.popupOpen
    if (!answer.ok) {
      const refusal = answer.error.kind
      if (refusal === 'unavailable') {
        if (now.slot !== submittedSlot) {
          // The visitor has left this time. Its refusal is not about what they have now. (If it is
          // the time in doubt, the doubt stays, and with it the warning in their popup.)
          setSlotsAttempt((n) => n + 1)
          return
        }
        const possiblyBooked = unconfirmedSlot.current === submittedSlot
        if (possiblyBooked && now.popupOpen) {
          setFieldErrors(NO_FIELD_ERRORS)
          setSubmitError('possiblyBooked')
          return
        }
        // `closePopup` keeps `form`, so the entered details are there when another time is chosen.
        closePopup()
        setState({ time: null })
        setRefusedSlot({ key: slotKey, notice: possiblyBooked ? 'possiblyBooked' : 'unavailable' })
        setSlotsAttempt((n) => n + 1)
        // The focus goes to the time step only when it is the flow's to move: a visitor who is
        // typing somewhere else keeps their place, and the line is announced all the same.
        focusTimesNext.current = focusIsTheFlows(timesRegion.current)
        return
      }
      if (refusal === 'unconfirmed') {
        markUnconfirmed(submittedSlot)
        // The warning is drawn from the doubt itself. An older line in the popup on screen gives
        // way to it.
        setSubmitError(null)
        if (ownPopupOpen) setFieldErrors(NO_FIELD_ERRORS)
        // With no popup open there is nothing to draw it in: the time step says it, until a time
        // is chosen (the popup that opens then carries the warning).
        if (!now.popupOpen && now.selection !== null) {
          setRefusedSlot({ key: now.selection, notice: refusal })
        }
        return
      }
      // A refusal that said what it was belongs to the popup of the time it refused.
      if (ownPopupOpen) {
        setFieldErrors(NO_FIELD_ERRORS)
        setSubmitError(refusal)
      } else if (now.selection !== null) {
        setRefusedSlot({ key: now.selection, notice: refusal })
      }
      return
    }
    booked.current = true
    markUnconfirmed(null)
    setResult(answer)
    setFieldErrors(NO_FIELD_ERRORS)
    setSubmitError(null)
    // A refusal of an earlier submit may still stand in the time step; the booking answers it.
    setRefusedSlot(null)
    // The visitor may have chosen something else while this submit was on its way. The
    // confirmation is built from the selection, so the selection this booking was made from goes
    // back in the same update that shows it: it names the booking that exists, never another.
    setState({
      barberId: S.barberId,
      dateIso: S.dateIso,
      service: S.service,
      time: S.time,
      showPopup: false,
      booked: true,
    })
    // Last: the booking exists and is shown, whatever this callback does.
    props.onBookingComplete?.()
  }
  const onBookClick = (): void => {
    void onBook()
  }

  // The title is a heading by role, not by tag: the published presentation stores this element as a
  // `span`, and its look must not change. `focusStepTitle` finds it by that role.
  const stepHeader = (step: string, label: string): JSX.Element => (
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;">
      <span style={s.badgeStyle}>{step}</span>
      <span
        role="heading"
        aria-level={2}
        style="font-family:'Inter Variable';font-weight:600;font-size:18px;"
      >
        {label}
      </span>
    </div>
  )
  // One persistent polite live region per step that reads data. Its content changes between a
  // loading message, an empty-state message and nothing, so assistive technology hears each change;
  // with nothing in it, it takes no space.
  const statusRegion = (
    key: string,
    region: RefObject<HTMLDivElement>,
    message: JSX.Element | null,
  ): JSX.Element => (
    <div key={key} ref={region} role="status">
      {message}
    </div>
  )
  // A failed read. The retry button leaves the page when the read starts again, so focus moves to
  // the step's title first.
  const readError = (
    key: string,
    region: RefObject<HTMLDivElement>,
    message: string,
    retry: () => void,
  ): JSX.Element => (
    <div key={key} role="alert" style={READ_ERROR_STYLE}>
      <span>{message}</span>{' '}
      <button
        type="button"
        onClick={() => {
          focusStepTitle(region.current)
          retry()
        }}
        style={RETRY_BUTTON_STYLE}
      >
        {t.retry}
      </button>
    </div>
  )
  const monthNav = (on: boolean, delta: 1 | -1, label: string, icon: string): JSX.Element => (
    <button
      type="button"
      onClick={on ? () => setState((st) => ({ monthOffset: st.monthOffset + delta })) : undefined}
      disabled={!on}
      aria-label={label}
      style={navBtn(on)}
    >
      <img src={icon} alt="" style={s.navIconStyle} />
    </button>
  )

  const showCalendar = Boolean(S.barberId)
  const servicesReady = Boolean(S.barberId && S.dateIso)
  const notServicesReady = !S.dateIso
  const timesReady = Boolean(S.barberId && S.dateIso && S.service)
  const notTimesReady = !S.service

  return present(
    <div style={s.rootStyle} data-knc-fold="booking-flow">
      <div style="padding: 18px 22px 26px 22px">
        <div data-testid="booking-step-barber" data-booking-step="barber">
          {stepHeader('1', t.chooseBarber)}
          <div
            data-testid="booking-barber-list"
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:11px;"
          >
            {rosterStatus === 'ready'
              ? barbers.map((b) => (
                  <button
                    key={b.id}
                    data-testid="booking-barber-option"
                    aria-pressed={b.selected}
                    onClick={b.onSelect}
                    style={b.cardStyle}
                  >
                    <span style={b.avatarStyle}>{b.initial}</span>
                    <span style="display:flex;flex-direction:column;gap:1px;text-align:left;min-width:0;flex:1;">
                      <span style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        {b.name}
                      </span>
                      <span style="font-size:11.5px;opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        @{b.ig}
                      </span>
                    </span>
                    {b.selected ? (
                      <img src="/icons/checkmark.circle.fill.svg" alt="" style={s.checkIconStyle} />
                    ) : null}
                  </button>
                ))
              : null}
          </div>
          {statusRegion(
            'barbers-status',
            barbersRegion,
            rosterStatus === 'loading' ? (
              <div style={s.timePlaceholderStyle}>{t.loadingBarbers}</div>
            ) : rosterStatus === 'ready' && barbers.length === 0 ? (
              <div data-testid="booking-barber-empty" style={s.timePlaceholderStyle}>
                {t.noBarbers}
              </div>
            ) : null,
          )}
          {rosterStatus === 'error'
            ? readError('barbers-error', barbersRegion, t.errLoadBarbers, retryRoster)
            : null}
        </div>

        {showCalendar ? (
          <NativeRegion surface="booking-options" lang={lang} mode={props.mode ?? 'light'}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '26px',
                alignItems: 'flex-start',
                marginTop: '26px',
                // Reduced motion: drop only the entry animation; the settled steps look identical.
                animation: prefersReducedMotion()
                  ? 'none'
                  : 'kncFade .32s cubic-bezier(.32,.72,0,1) both',
                fontFamily: s.rootStyle.fontFamily,
                color: c.text,
                background: c.bg,
              }}
            >
              <div style="flex:1 1 300px;max-width:344px;min-width:0;">
                {stepHeader('2', t.chooseDate)}
                <div style={s.panelStyle}>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    {monthNav(canPrev, -1, t.previousMonth, '/icons/chevron.left.svg')}
                    <span style="font-family:'Inter Variable';font-weight:600;font-size:15px;">
                      {monthLabelText}
                    </span>
                    {monthNav(canNext, 1, t.nextMonth, '/icons/chevron.right.svg')}
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;">
                    {headerLabels(lang).map((hh, i) => (
                      <span
                        key={i}
                        style="text-align:center;font-size:10.5px;font-weight:600;opacity:.45;letter-spacing:.2px;"
                      >
                        {hh}
                      </span>
                    ))}
                  </div>
                  {calendarWeeks.map((week, wi) => (
                    <div key={wi} style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
                      {week.map((cell, ci) =>
                        cell === null ? (
                          <span
                            key={ci}
                            aria-hidden="true"
                            style={{ background: 'transparent', border: 'none' }}
                          ></span>
                        ) : (
                          <button
                            key={ci}
                            type="button"
                            onClick={cell.onClick}
                            disabled={cell.disabled}
                            aria-label={cell.ariaLabel}
                            aria-pressed={cell.selected}
                            style={cell.cellStyle}
                          >
                            {cell.day}
                          </button>
                        ),
                      )}
                    </div>
                  ))}
                  <div style="display:flex;gap:14px;margin-top:11px;font-size:11px;opacity:.5;">
                    <span style="display:flex;align-items:center;gap:5px;">
                      <span style={s.legendChosenDot}></span>
                      {t.legendChosen}
                    </span>
                    <span style="display:flex;align-items:center;gap:5px;">
                      <span style={s.legendClosedDot}></span>
                      {t.legendClosed}
                    </span>
                  </div>
                </div>
              </div>

              <div style="flex:1 1 250px;min-width:0;">
                {stepHeader('3', t.chooseService)}
                {servicesReady ? (
                  <div style="display:flex;flex-direction:column;gap:16px;">
                    {serviceGroups.map((g, gi) => (
                      <div key={gi}>
                        {g.title !== '' ? (
                          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px;">
                            <span style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;opacity:.5;">
                              {g.title}
                            </span>
                            <span style="font-size:11px;opacity:.4;">{g.note}</span>
                          </div>
                        ) : null}
                        <div style={s.panelStyleFlush}>
                          {g.items.map((it, ii) => (
                            <button
                              key={ii}
                              data-testid="booking-service-option"
                              aria-pressed={it.selected}
                              onClick={it.onClick}
                              style={it.rowStyle}
                              class={pseudoClass('hover', it.rowHover)}
                            >
                              <span style="display:flex;flex-direction:column;gap:2px;text-align:left;">
                                <span style="font-weight:500;font-size:15px;">{it.name}</span>
                                <span style="font-size:12px;opacity:.5;">{it.dur}</span>
                              </span>
                              <span style="display:flex;align-items:center;gap:9px;">
                                <span style="font-weight:600;font-size:15px;">{it.priceLabel}</span>
                                {it.selected ? (
                                  <img
                                    src="/icons/checkmark.circle.fill.svg"
                                    alt=""
                                    style={s.checkIconStyle}
                                  />
                                ) : null}
                                {it.notSelected ? (
                                  <img
                                    src="/icons/chevron.right.svg"
                                    alt=""
                                    style={s.chevronStyle}
                                  />
                                ) : null}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {KEPT_POSITION /* was: the loading message, now in the status region */}
                {KEPT_POSITION /* was: the empty-menu message, now in the status region */}
                {notServicesReady ? (
                  <div style={s.timePlaceholderStyle}>{t.pickDayForService}</div>
                ) : null}
                {statusRegion(
                  'services-status',
                  servicesRegion,
                  !servicesReady ? null : servicesStatus === 'loading' ? (
                    <div style={s.timePlaceholderStyle}>{t.loadingServices}</div>
                  ) : servicesStatus === 'ready' && barberServices.length === 0 ? (
                    <div style={s.timePlaceholderStyle}>{t.noServices}</div>
                  ) : null,
                )}
                {servicesReady && servicesStatus === 'error'
                  ? readError('services-error', servicesRegion, t.errLoadServices, retryServices)
                  : null}
              </div>

              <div style="flex:1 1 220px;min-width:0;">
                {stepHeader('4', t.chooseTime)}
                {KEPT_POSITION /* was: the loading message, now in the status region */}
                {timesReady && slots.status === 'ready' && slots.times.length > 0 ? (
                  <div>
                    <div style="font-size:13px;opacity:.5;margin:0 0 13px 0;">{timeSubLabel}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                      {timeSlots.map((slot, si) => (
                        <button
                          key={si}
                          aria-pressed={slot.selected}
                          onClick={slot.onClick}
                          style={slot.chipStyle}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {KEPT_POSITION /* was: the no-times message, now in the status region */}
                {notTimesReady ? (
                  <div style={s.timePlaceholderStyle}>{t.pickServiceForTime}</div>
                ) : null}
                {timesReady && slotNotice !== null ? (
                  <div key="times-refused" role="alert" style={READ_ERROR_STYLE}>
                    {slotNotice}
                  </div>
                ) : null}
                {statusRegion(
                  'times-status',
                  timesRegion,
                  !timesReady ? null : slots.status === 'loading' ? (
                    <div style={s.timePlaceholderStyle}>{t.loadingTimes}</div>
                  ) : slots.status === 'ready' && slots.times.length === 0 ? (
                    <div style={s.timePlaceholderStyle}>{t.noSlots}</div>
                  ) : null,
                )}
                {timesReady && slots.status === 'error'
                  ? readError('times-error', timesRegion, t.errLoadTimes, () =>
                      setSlotsAttempt((n) => n + 1),
                    )
                  : null}
              </div>
            </div>
          </NativeRegion>
        ) : null}
      </div>

      {S.showPopup ? (
        <DetailsDialog
          cms={{ surface: 'booking-details', lang, mode: props.mode ?? 'light' }}
          t={t}
          lang={lang}
          s={s}
          closeLabel={myBookingsStrings(lang).ariaClose}
          sumBarber={sumBarber}
          sumWhen={sumWhen}
          sumService={sumService}
          sumPrice={sumPrice}
          nameValue={f.name}
          phoneValue={f.phone}
          emailValue={f.email}
          bookDisabled={bookDisabled}
          bookBusy={busySlot !== null && busySlot === slotKeyAt(slotKey, S.time)}
          fieldErrors={fieldErrors}
          submitError={popupNotice === null ? null : t[SUBMIT_NOTICE_TEXT[popupNotice]]}
          onName={onContact('name')}
          onPhone={onContact('phone')}
          onEmail={onContact('email')}
          onBook={onBookClick}
          onClose={closePopup}
          onBackdropClick={onPopupBackdrop}
          turnstile={
            turnstileConfigured && previewPorts === undefined ? (
              <Turnstile
                action="booking"
                lang={lang}
                onToken={setTurnstileToken}
                resetNonce={turnstileNonce}
              />
            ) : null
          }
        />
      ) : null}

      {S.booked ? (
        <ConfirmationDialog
          cms={{ surface: 'booking-confirmation', lang, mode: props.mode ?? 'light' }}
          t={t}
          s={s}
          closeLabel={myBookingsStrings(lang).ariaClose}
          confirmSentLine={confirmSentLine}
          {...(scene === 'confirmation'
            ? { customerAccessNote: myBookingsStrings(lang).deviceReady }
            : result?.ok && result.customerAccess
              ? {
                  customerAccessNote:
                    result.customerAccess === 'ready'
                      ? myBookingsStrings(lang).deviceReady
                      : myBookingsStrings(lang).deviceUnavailable,
                }
              : {})}
          sumBarber={sumBarber}
          sumWhen={sumWhen}
          sumService={sumService}
          sumPrice={sumPrice}
          icsHref={icsHref}
          gcalHref={gcalHref}
          mapsHref={mapsHref}
          showDirections={showDirections}
          calRowHover={calRowHover}
          onReset={reset}
          onMyBookings={
            props.onMyBookings
              ? () => {
                  reset()
                  props.onMyBookings?.()
                }
              : undefined
          }
          myBookingsLabel={appStrings(lang).myBookings}
          onBackdropClick={onConfirmBackdrop}
        />
      ) : null}
    </div>,
  )
}
