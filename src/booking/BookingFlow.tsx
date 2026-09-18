import { cmsNodeId } from '../cms/nodeIdentity'
import { useCms, mergeCmsStrings, mergeCmsPalette, CmsImage } from '../cms/context'
// The 4-step booking flow (barber → date → service → time), ported from the original mock; the
// details + confirmation modals live in their own components. Inline styles/literals match the
// mock's rendering. Submit flows through the injectable `BookingPort` (default: env-selected —
// Supabase when configured, the local calendar adapter otherwise).

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
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
import type { Barber, Booking, BookingDraft, BookingResult } from './domain'
import { initialDraft } from './domain'
import { useServices } from './useServices'
import { defaultBookingPort } from './adapters/index'
import type { BookingPort } from './port'
import type { BarbersPort } from './barbersPort'
import type { ServicesPort } from './servicesPort'
import { useRoster } from './useRoster'
import { parseContact } from './validation'
import type { FieldErrors } from './validation'
import type { CustomerProfile } from '../mybookings/domain'
import { buildBookingStyles, makeNavBtn, palette } from './bookingStyles'
import { Turnstile, turnstileConfigured } from './Turnstile'
import { DetailsDialog } from './DetailsDialog'
import { ConfirmationDialog } from './ConfirmationDialog'
import { stockholmWallClockDate } from './stockholmTime'
import { pseudoClass } from '../ui/pseudo'

type Mode = 'light' | 'dark'

/** Pristine per-field error state — nothing flagged (the default popup). */
const NO_FIELD_ERRORS: FieldErrors = { name: false, phone: false, email: false }

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
  readonly initialContact?: CustomerProfile
  /** The initial roster has resolved, including a truthful empty/error state. */
  readonly onRosterReady?: () => void
}

export type BookingPopupText = Readonly<Pick<BookingStrings, BookingPopupTextKey>>

export function BookingFlow(props: BookingFlowProps): JSX.Element {
  const _cmsPresentation = useCms().presentation

  const [state, setRaw] = useState<BookingDraft>(initialDraft)
  const typedContact = useRef({ name: false, phone: false, email: false })
  // Port result, per-FIELD validation errors, and the generic SYSTEM/submit error all live
  // OUTSIDE the domain draft. Field errors and the system error are mutually exclusive.
  const [result, setResult] = useState<BookingResult | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Real availability: the AVAILABLE start times for the chosen barber+date+service, loaded through
  // the port (DB-backed when configured, the deterministic `packSlots` grid under the mock). The grid
  // renders exactly these as selectable chips. `slotsLoading` covers the in-flight fetch.
  const [availableTimes, setAvailableTimes] = useState<readonly string[]>([])
  const [slotsLoading, setSlotsLoading] = useState<boolean>(false)
  // Turnstile token (proves the submitter is human; verified by the submit-booking gateway) + a
  // nonce bumped after each submit attempt to force a FRESH token (Turnstile tokens are single-use
  // and expire ~5 min). Empty token = unconfigured/offline → the gateway fails open.
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  const [turnstileNonce, setTurnstileNonce] = useState<number>(0)

  const setState = (
    u: Partial<BookingDraft> | ((s: BookingDraft) => Partial<BookingDraft>),
  ): void => setRaw((s) => ({ ...s, ...(typeof u === 'function' ? u(s) : u) }))
  useEffect(() => {
    const contact = props.initialContact
    // Nonempty auto-fill still belongs to its verified profile. Only actual edits survive a
    // profile switch/clear, including an intentionally emptied field.
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
  const defaultText = mergeCmsStrings(_cmsPresentation, 'booking', lang, bookingStrings(lang))
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
  const port: BookingPort = props.port ?? defaultBookingPort
  const { roster, loading: rosterLoading } = useRoster(props.barbersPort)
  useEffect(() => {
    if (!rosterLoading) props.onRosterReady?.()
  }, [rosterLoading, props.onRosterReady])
  const today = stockholmWallClockDate(clock())
  const S = state
  const { services: barberServices, loading: servicesLoading } = useServices(
    S.barberId,
    S.dateIso,
    props.servicesPort,
  )

  // Load real availability whenever barber + date + service are all chosen. The result is the list of
  // AVAILABLE start times; the grid renders exactly those as chips. A `cancelled` flag drops stale
  // responses so fast re-selection can't show the wrong day's slots. On any failure we fail closed to
  // an empty list (the empty-state message shows; create_booking still validates the slot on submit).
  const serviceDur = S.service?.dur
  const serviceId = S.service?.id
  useEffect(() => {
    if (
      S.barberId === null ||
      S.dateIso === null ||
      serviceDur === undefined ||
      serviceId === undefined
    ) {
      setAvailableTimes([])
      setSlotsLoading(false)
      return
    }
    let cancelled = false
    setSlotsLoading(true)
    void port
      .availability({
        barberId: S.barberId,
        dateIso: S.dateIso,
        durationMin: serviceDur,
        serviceId,
      })
      .then((times) => {
        if (cancelled) return
        setAvailableTimes(times)
        setSlotsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setAvailableTimes([])
        setSlotsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [port, S.barberId, S.dateIso, serviceDur, serviceId])

  const c = mergeCmsPalette(_cmsPresentation, palette(dark), dark ? 'dark' : 'light')
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
      onSelect: () =>
        setState({
          barberId: b.id,
          dateIso: null,
          time: null,
          service: null,
          showPopup: false,
          booked: false,
        }),
    }
  })

  const base = new Date(today.getFullYear(), today.getMonth() + S.monthOffset, 1)
  const cy = base.getFullYear()
  const cm = base.getMonth()
  const monthLabelText = cap(monthLabel(lang, cm)) + ' ' + cy
  const calendarWeeks = buildWeeks(cy, cm).map((w) =>
    w.map((cell) => {
      if (!cell) {
        return {
          day: '' as string | number,
          cellStyle: { background: 'transparent', border: 'none' } satisfies JSX.CSSProperties,
          onClick: undefined as undefined | (() => void),
          ariaLabel: undefined as string | undefined,
          disabled: true,
          selected: false,
        }
      }
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
        day: cell.getDate() as string | number,
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
    chipStyle: JSX.CSSProperties
    onClick: () => void
  }
  // Every returned time is AVAILABLE (the adapter already packed + filtered) — render each as a
  // selectable chip; the chosen one gets the accent highlight. No greying/line-through here:
  // unavailable times simply aren't in the list.
  const timeSlots: TimeSlot[] =
    selDate !== null && S.service !== null
      ? availableTimes.map((time) => {
          const sel = S.time === time
          return {
            label: time,
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
            onClick: () => setState({ time, showPopup: true }),
          }
        })
      : []
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
    (turnstileConfigured && turnstileToken === '')

  // Confirmation links come from the stored BookingPort result; fall back to '#' before submit
  // (and defensively if result is momentarily null) so the confirmation modal never crashes.
  const icsHref = result?.ok === true ? result.links.icsHref : '#'
  const gcalHref = result?.ok === true ? result.links.gcalHref : '#'
  const mapsHref = result?.ok === true ? result.links.mapsHref : business.mapsHref

  // Confirmation sentence — owner-editable template with live contact values inserted.
  let confirmSentLine = ''
  if (selDate !== null && S.time && S.service) {
    confirmSentLine = t.confirmSent.split('{phone}').join(f.phone).split('{email}').join(f.email)
  }

  const s = buildBookingStyles(c, dark, bookDisabled)
  const calRowHover = 'background:' + c.subtle + ';'

  const onPopupBackdrop = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) closePopup()
  }
  const onConfirmBackdrop = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) reset()
  }
  const onName = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    typedContact.current.name = true
    clearFieldError('name')
    setState((st) => ({ form: { ...st.form, name: e.currentTarget.value } }))
  }
  const onPhone = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    typedContact.current.phone = true
    clearFieldError('phone')
    setState((st) => ({ form: { ...st.form, phone: e.currentTarget.value } }))
  }
  const onEmail = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    typedContact.current.email = true
    clearFieldError('email')
    setState((st) => ({ form: { ...st.form, email: e.currentTarget.value } }))
  }

  // Submit seam: validate, build a real Booking, send it through the BookingPort, store the
  // result, then advance. Two distinct failure modes:
  //  - VALIDATION failure → flag the offending field(s) red (per-field notes), no system error.
  //  - SYSTEM/submit failure (a throw, or result.ok === false) → a single generic error line,
  //    fields left untouched. (The local adapter never fails; a future networked one might.)
  const onBook = async (): Promise<void> => {
    if (bookDisabled) return
    // unreachable: bookDisabled + the step gating guarantee a selected date/time/service/barber.
    if (selDate === null || S.time === null || S.service === null) return
    if (barberObj === undefined) return
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
    try {
      const submitResult = await port.submit(booking, business)
      // The Turnstile token is single-use — force a fresh challenge for any subsequent attempt
      // (e.g. a slot_taken/rate_limited retry, where the popup stays open).
      setTurnstileNonce((n) => n + 1)
      if (!submitResult.ok) {
        setFieldErrors(NO_FIELD_ERRORS)
        // The adapter localizes the reason (rate_limited / failed_challenge / generic) into the message.
        setSubmitError(submitResult.error.message)
        return
      }
      setResult(submitResult)
      setFieldErrors(NO_FIELD_ERRORS)
      setSubmitError(null)
      setState({ showPopup: false, booked: true })
    } catch {
      // A thrown adapter error is a system failure, not a field error.
      setTurnstileNonce((n) => n + 1)
      setFieldErrors(NO_FIELD_ERRORS)
      setSubmitError(t.errSubmit)
    }
  }
  const onBookClick = (): void => {
    void onBook()
  }

  const showCalendar = Boolean(S.barberId)
  const servicesReady = Boolean(S.barberId && S.dateIso)
  const notServicesReady = !S.dateIso
  const timesReady = Boolean(S.barberId && S.dateIso && S.service)
  const notTimesReady = !S.service

  return (
    <div data-cms-node="bookingflow-div-1" style={s.rootStyle}>
      <div data-cms-node="bookingflow-div-2" style="padding: 18px 22px 26px 22px">
        <div
          data-cms-node="bookingflow-div-3"
          data-testid="booking-step-barber"
          data-booking-step="barber"
        >
          <div
            data-cms-node="bookingflow-div-4"
            style="display:flex;align-items:center;gap:9px;margin-bottom:13px;"
          >
            <span data-cms-node="bookingflow-span-5" style={s.badgeStyle}>
              1
            </span>
            <span
              data-cms-node="bookingflow-span-6"
              data-cms-copy="copy:booking:chooseBarber"
              style="font-family:'Inter Variable';font-weight:600;font-size:18px;"
            >
              {t.chooseBarber}
            </span>
          </div>
          <div
            data-cms-node="bookingflow-div-7"
            data-testid="booking-barber-list"
            style="display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:11px;"
          >
            {rosterLoading ? (
              <div
                data-cms-node="bookingflow-div-8"
                data-cms-copy="copy:booking:loadingBarbers"
                style={s.timePlaceholderStyle}
              >
                {t.loadingBarbers}
              </div>
            ) : null}
            {!rosterLoading && barbers.length === 0 ? (
              <div
                data-cms-node="bookingflow-div-9"
                data-cms-copy="copy:booking:noBarbers"
                data-testid="booking-barber-empty"
                style={s.timePlaceholderStyle}
              >
                {t.noBarbers}
              </div>
            ) : null}
            {!rosterLoading
              ? barbers.map((b) => (
                  <button
                    data-cms-node={cmsNodeId('bookingflow-button-10', b.id)}
                    key={b.id}
                    data-testid="booking-barber-option"
                    aria-pressed={b.selected}
                    onClick={b.onSelect}
                    style={b.cardStyle}
                  >
                    <span
                      data-cms-node={cmsNodeId('bookingflow-span-11', b.id)}
                      style={b.avatarStyle}
                    >
                      {b.initial}
                    </span>
                    <span
                      data-cms-node={cmsNodeId('bookingflow-span-12', b.id)}
                      style="display:flex;flex-direction:column;gap:1px;text-align:left;min-width:0;flex:1;"
                    >
                      <span
                        data-cms-node={cmsNodeId('bookingflow-span-13', b.id)}
                        data-cms-copy={`barber:${b.id}:name`}
                        style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                      >
                        {b.name}
                      </span>
                      <span
                        data-cms-node={cmsNodeId('bookingflow-span-14', b.id)}
                        data-cms-copy={`barber:${b.id}:ig`}
                        style="font-size:11.5px;opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                      >
                        @{b.ig}
                      </span>
                    </span>
                    {b.selected ? (
                      <CmsImage
                        data-cms-node={cmsNodeId('bookingflow-img-15', b.id)}
                        src="/icons/checkmark.circle.fill.svg"
                        alt=""
                        style={s.checkIconStyle}
                      />
                    ) : null}
                  </button>
                ))
              : null}
          </div>
        </div>

        {showCalendar ? (
          <div
            data-cms-node="bookingflow-div-16"
            style="display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start;margin-top:26px;animation:kncFade .32s cubic-bezier(.32,.72,0,1) both;"
          >
            <div
              data-cms-node="bookingflow-div-17"
              style="flex:1 1 300px;max-width:344px;min-width:0;"
            >
              <div
                data-cms-node="bookingflow-div-18"
                style="display:flex;align-items:center;gap:9px;margin-bottom:13px;"
              >
                <span data-cms-node="bookingflow-span-19" style={s.badgeStyle}>
                  2
                </span>
                <span
                  data-cms-node="bookingflow-span-20"
                  data-cms-copy="copy:booking:chooseDate"
                  style="font-family:'Inter Variable';font-weight:600;font-size:18px;"
                >
                  {t.chooseDate}
                </span>
              </div>
              <div data-cms-node="bookingflow-div-21" style={s.panelStyle}>
                <div
                  data-cms-node="bookingflow-div-22"
                  style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"
                >
                  <button
                    data-cms-node="bookingflow-button-23"
                    data-cms-copy="copy:booking:previousMonth"
                    type="button"
                    onClick={
                      canPrev
                        ? () => setState((st) => ({ monthOffset: st.monthOffset - 1 }))
                        : undefined
                    }
                    disabled={!canPrev}
                    aria-label={t.previousMonth}
                    style={navBtn(canPrev)}
                  >
                    <CmsImage
                      data-cms-node="bookingflow-img-24"
                      src="/icons/chevron.left.svg"
                      alt=""
                      style={s.navIconStyle}
                    />
                  </button>
                  <span
                    data-cms-node="bookingflow-span-25"
                    style="font-family:'Inter Variable';font-weight:600;font-size:15px;"
                  >
                    {monthLabelText}
                  </span>
                  <button
                    data-cms-node="bookingflow-button-26"
                    data-cms-copy="copy:booking:nextMonth"
                    type="button"
                    onClick={
                      canNext
                        ? () => setState((st) => ({ monthOffset: st.monthOffset + 1 }))
                        : undefined
                    }
                    disabled={!canNext}
                    aria-label={t.nextMonth}
                    style={navBtn(canNext)}
                  >
                    <CmsImage
                      data-cms-node="bookingflow-img-27"
                      src="/icons/chevron.right.svg"
                      alt=""
                      style={s.navIconStyle}
                    />
                  </button>
                </div>
                <div
                  data-cms-node="bookingflow-div-28"
                  style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;"
                >
                  {headerLabels(lang).map((hh, i) => (
                    <span
                      data-cms-node={cmsNodeId('bookingflow-span-29', i)}
                      key={i}
                      style="text-align:center;font-size:10.5px;font-weight:600;opacity:.45;letter-spacing:.2px;"
                    >
                      {hh}
                    </span>
                  ))}
                </div>
                {calendarWeeks.map((week, wi) => (
                  <div
                    data-cms-node={cmsNodeId('bookingflow-div-30', wi)}
                    key={wi}
                    style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;"
                  >
                    {week.map((cell, ci) =>
                      cell.day === '' ? (
                        <span
                          data-cms-node={cmsNodeId('bookingflow-span-31', wi, ci)}
                          key={ci}
                          aria-hidden="true"
                          style={cell.cellStyle}
                        ></span>
                      ) : (
                        <button
                          data-cms-node={cmsNodeId('bookingflow-button-32', wi, ci)}
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
                <div
                  data-cms-node="bookingflow-div-33"
                  style="display:flex;gap:14px;margin-top:11px;font-size:11px;opacity:.5;"
                >
                  <span
                    data-cms-node="bookingflow-span-34"
                    style="display:flex;align-items:center;gap:5px;"
                  >
                    <span data-cms-node="bookingflow-span-35" style={s.legendChosenDot}></span>
                    {t.legendChosen}
                  </span>
                  <span
                    data-cms-node="bookingflow-span-36"
                    style="display:flex;align-items:center;gap:5px;"
                  >
                    <span data-cms-node="bookingflow-span-37" style={s.legendClosedDot}></span>
                    {t.legendClosed}
                  </span>
                </div>
              </div>
            </div>

            <div data-cms-node="bookingflow-div-38" style="flex:1 1 250px;min-width:0;">
              <div
                data-cms-node="bookingflow-div-39"
                style="display:flex;align-items:center;gap:9px;margin-bottom:13px;"
              >
                <span data-cms-node="bookingflow-span-40" style={s.badgeStyle}>
                  3
                </span>
                <span
                  data-cms-node="bookingflow-span-41"
                  data-cms-copy="copy:booking:chooseService"
                  style="font-family:'Inter Variable';font-weight:600;font-size:18px;"
                >
                  {t.chooseService}
                </span>
              </div>
              {servicesReady ? (
                <div
                  data-cms-node="bookingflow-div-42"
                  style="display:flex;flex-direction:column;gap:16px;"
                >
                  {serviceGroups.map((g, gi) => (
                    <div data-cms-node={cmsNodeId('bookingflow-div-43', gi)} key={gi}>
                      {g.title !== '' ? (
                        <div
                          data-cms-node={cmsNodeId('bookingflow-div-44', gi)}
                          style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px;"
                        >
                          <span
                            data-cms-node={cmsNodeId('bookingflow-span-45', gi)}
                            style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;opacity:.5;"
                          >
                            {g.title}
                          </span>
                          <span
                            data-cms-node={cmsNodeId('bookingflow-span-46', gi)}
                            style="font-size:11px;opacity:.4;"
                          >
                            {g.note}
                          </span>
                        </div>
                      ) : null}
                      <div
                        data-cms-node={cmsNodeId('bookingflow-div-47', gi)}
                        style={s.panelStyleFlush}
                      >
                        {g.items.map((it, ii) => (
                          <button
                            data-cms-node={cmsNodeId('bookingflow-button-48', gi, ii)}
                            key={ii}
                            data-testid="booking-service-option"
                            onClick={it.onClick}
                            style={it.rowStyle}
                            class={pseudoClass('hover', it.rowHover)}
                          >
                            <span
                              data-cms-node={cmsNodeId('bookingflow-span-49', gi, ii)}
                              style="display:flex;flex-direction:column;gap:2px;text-align:left;"
                            >
                              <span
                                data-cms-node={cmsNodeId('bookingflow-span-50', gi, ii)}
                                style="font-weight:500;font-size:15px;"
                              >
                                {it.name}
                              </span>
                              <span
                                data-cms-node={cmsNodeId('bookingflow-span-51', gi, ii)}
                                style="font-size:12px;opacity:.5;"
                              >
                                {it.dur}
                              </span>
                            </span>
                            <span
                              data-cms-node={cmsNodeId('bookingflow-span-52', gi, ii)}
                              style="display:flex;align-items:center;gap:9px;"
                            >
                              <span
                                data-cms-node={cmsNodeId('bookingflow-span-53', gi, ii)}
                                style="font-weight:600;font-size:15px;"
                              >
                                {it.priceLabel}
                              </span>
                              {it.selected ? (
                                <CmsImage
                                  data-cms-node={cmsNodeId('bookingflow-img-54', gi, ii)}
                                  src="/icons/checkmark.circle.fill.svg"
                                  alt=""
                                  style={s.checkIconStyle}
                                />
                              ) : null}
                              {it.notSelected ? (
                                <CmsImage
                                  data-cms-node={cmsNodeId('bookingflow-img-55', gi, ii)}
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
              {servicesReady && servicesLoading ? (
                <div
                  data-cms-node="bookingflow-div-56"
                  data-cms-copy="copy:booking:loadingServices"
                  style={s.timePlaceholderStyle}
                >
                  {t.loadingServices}
                </div>
              ) : null}
              {servicesReady && !servicesLoading && barberServices.length === 0 ? (
                <div
                  data-cms-node="bookingflow-div-57"
                  data-cms-copy="copy:booking:noServices"
                  style={s.timePlaceholderStyle}
                >
                  {t.noServices}
                </div>
              ) : null}
              {notServicesReady ? (
                <div
                  data-cms-node="bookingflow-div-58"
                  data-cms-copy="copy:booking:pickDayForService"
                  style={s.timePlaceholderStyle}
                >
                  {t.pickDayForService}
                </div>
              ) : null}
            </div>

            <div data-cms-node="bookingflow-div-59" style="flex:1 1 220px;min-width:0;">
              <div
                data-cms-node="bookingflow-div-60"
                style="display:flex;align-items:center;gap:9px;margin-bottom:13px;"
              >
                <span data-cms-node="bookingflow-span-61" style={s.badgeStyle}>
                  4
                </span>
                <span
                  data-cms-node="bookingflow-span-62"
                  data-cms-copy="copy:booking:chooseTime"
                  style="font-family:'Inter Variable';font-weight:600;font-size:18px;"
                >
                  {t.chooseTime}
                </span>
              </div>
              {timesReady && slotsLoading ? (
                <div
                  data-cms-node="bookingflow-div-63"
                  data-cms-copy="copy:booking:loadingTimes"
                  style={s.timePlaceholderStyle}
                >
                  {t.loadingTimes}
                </div>
              ) : null}
              {timesReady && !slotsLoading && availableTimes.length > 0 ? (
                <div data-cms-node="bookingflow-div-64">
                  <div
                    data-cms-node="bookingflow-div-65"
                    style="font-size:13px;opacity:.5;margin:0 0 13px 0;"
                  >
                    {timeSubLabel}
                  </div>
                  <div
                    data-cms-node="bookingflow-div-66"
                    style="display:flex;flex-wrap:wrap;gap:8px;"
                  >
                    {timeSlots.map((slot, si) => (
                      <button
                        data-cms-node={cmsNodeId('bookingflow-button-67', si)}
                        key={si}
                        onClick={slot.onClick}
                        style={slot.chipStyle}
                      >
                        {slot.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {timesReady && !slotsLoading && availableTimes.length === 0 ? (
                <div
                  data-cms-node="bookingflow-div-68"
                  data-cms-copy="copy:booking:noSlots"
                  style={s.timePlaceholderStyle}
                >
                  {t.noSlots}
                </div>
              ) : null}
              {notTimesReady ? (
                <div
                  data-cms-node="bookingflow-div-69"
                  data-cms-copy="copy:booking:pickServiceForTime"
                  style={s.timePlaceholderStyle}
                >
                  {t.pickServiceForTime}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {S.showPopup ? (
        <DetailsDialog
          t={t}
          s={s}
          closeLabel={
            mergeCmsStrings(_cmsPresentation, 'myBookings', lang, myBookingsStrings(lang)).ariaClose
          }
          sumBarber={sumBarber}
          sumWhen={sumWhen}
          sumService={sumService}
          sumPrice={sumPrice}
          nameValue={f.name}
          phoneValue={f.phone}
          emailValue={f.email}
          bookDisabled={bookDisabled}
          fieldErrors={fieldErrors}
          submitError={submitError}
          onName={onName}
          onPhone={onPhone}
          onEmail={onEmail}
          onBook={onBookClick}
          onClose={closePopup}
          onBackdropClick={onPopupBackdrop}
          turnstile={
            turnstileConfigured ? (
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
          t={t}
          s={s}
          closeLabel={
            mergeCmsStrings(_cmsPresentation, 'myBookings', lang, myBookingsStrings(lang)).ariaClose
          }
          confirmSentLine={confirmSentLine}
          {...(result?.ok && result.customerAccess
            ? {
                customerAccessNote:
                  result.customerAccess === 'ready'
                    ? mergeCmsStrings(_cmsPresentation, 'myBookings', lang, myBookingsStrings(lang))
                        .deviceReady
                    : mergeCmsStrings(_cmsPresentation, 'myBookings', lang, myBookingsStrings(lang))
                        .deviceUnavailable,
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
          myBookingsLabel={
            mergeCmsStrings(_cmsPresentation, 'app', lang, appStrings(lang)).myBookings
          }
          onBackdropClick={onConfirmBackdrop}
        />
      ) : null}
    </div>
  )
}
