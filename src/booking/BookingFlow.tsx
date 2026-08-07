// The 4-step booking flow (barber → date → service → time), ported from the original mock; the
// details + confirmation modals live in their own components. Inline styles/literals match the
// mock's rendering. Submit flows through the injectable `BookingPort` (default: env-selected —
// Supabase when configured, the local calendar adapter otherwise).

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { BUSINESS, defaultClock } from '../config'
import type { Clock } from '../config'
import type { BookingStrings, Lang } from '../i18n/index'
import { appStrings, bookingStrings } from '../i18n/index'
import type { BookingPopupTextKey } from '../site/siteChrome'
import {
  cap,
  buildWeeks,
  iso,
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
import { buildBookingStyles, makeNavBtn, makeTab, palette } from './bookingStyles'
import { Turnstile, turnstileConfigured } from './Turnstile'
import { DetailsDialog } from './DetailsDialog'
import { ConfirmationDialog } from './ConfirmationDialog'
import { rememberPhone } from '../mybookings/deviceMemory'
import { pseudoClass } from '../ui/pseudo'

type Mode = 'light' | 'dark'

/** Pristine per-field error state — nothing flagged (the default popup). */
const NO_FIELD_ERRORS: FieldErrors = { name: false, phone: false }

export interface BookingFlowProps {
  readonly mode?: Mode
  readonly defaultLang?: Lang
  readonly showDirections?: boolean
  readonly showHeader?: boolean
  /** Injected clock — "today" comes from here, never `new Date()` (default: env-selected). */
  readonly clock?: Clock
  /** Injected submit seam (default: env-selected; local adapter when no backend is configured). */
  readonly port?: BookingPort
  /** Injected roster seam — the barbers shown in step 1 (default: env-selected; mock = constants). */
  readonly barbersPort?: BarbersPort
  /** Injected services seam — the chosen barber's menu in step 3 (default: env-selected; mock = seed). */
  readonly servicesPort?: ServicesPort
  /** Open the app-level "Mina bokningar" popup — surfaced on the confirmation screen. */
  readonly onMyBookings?: () => void
  /** Owner-edited customer copy for the policy notice and confirmation title. */
  readonly popupText?: BookingPopupText
}

export type BookingPopupText = Readonly<Pick<BookingStrings, BookingPopupTextKey>>

export function BookingFlow(props: BookingFlowProps): JSX.Element {
  const [state, setRaw] = useState<BookingDraft>(initialDraft)
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
  const reset = (): void => {
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
      form: { name: '', phone: '' },
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
  const t: BookingStrings = { ...bookingStrings(lang), ...props.popupText }
  const dark = (props.mode ?? 'light') === 'dark'
  const showDirections = props.showDirections !== false
  const showHeader = props.showHeader !== false
  const clock: Clock = props.clock ?? defaultClock
  const port: BookingPort = props.port ?? defaultBookingPort
  // The roster shown in step 1. Under the mock this is the constant `BARBERS` immediately (no flash);
  // a configured backend replaces it with the active DB rows once they load (race-guarded in-hook).
  const { roster } = useRoster(props.barbersPort)
  const today = clock()
  const S = state
  // The chosen barber's flat service menu (per-barber, editable in the admin panel). Under the mock
  // this is the immediate starter menu; under a backend it is that barber's active `services` rows.
  const { services: barberServices } = useServices(S.barberId, props.servicesPort)

  // Load real availability whenever barber + date + service are all chosen. The result is the list of
  // AVAILABLE start times; the grid renders exactly those as chips. A `cancelled` flag drops stale
  // responses so fast re-selection can't show the wrong day's slots. On any failure we fail closed to
  // an empty list (the empty-state message shows; create_booking still validates the slot on submit).
  const serviceDur = S.service?.dur
  useEffect(() => {
    if (S.barberId === null || S.dateIso === null || serviceDur === undefined) {
      setAvailableTimes([])
      setSlotsLoading(false)
      return
    }
    let cancelled = false
    setSlotsLoading(true)
    void port
      .availability({ barberId: S.barberId, dateIso: S.dateIso, durationMin: serviceDur })
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
  }, [port, S.barberId, S.dateIso, serviceDur])

  const c = palette(dark)
  const tab = makeTab(c)
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
        fontFamily: "'SF Pro Display'",
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
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const calendarWeeks = buildWeeks(cy, cm).map((w) =>
    w.map((cell) => {
      if (!cell) {
        return {
          day: '' as string | number,
          cellStyle: { background: 'transparent', border: 'none' } satisfies JSX.CSSProperties,
          onClick: undefined as undefined | (() => void),
        }
      }
      const cellIso = iso(cell)
      const past = cell < todayMid
      const closed = cell.getDay() === 0
      const selectable = !past && !closed
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
        op = past ? 0.32 : 0.5
        if (closed && !past) bg = c.subtle
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
  // SMS is the only channel now — a booking just needs a name + a phone.
  const bookDisabled = !(f.name.trim() && f.phone.trim())

  // Confirmation links come from the stored BookingPort result; fall back to '#' before submit
  // (and defensively if result is momentarily null) so the confirmation modal never crashes.
  const icsHref = result?.ok === true ? result.links.icsHref : '#'
  const gcalHref = result?.ok === true ? result.links.gcalHref : '#'
  const mapsHref = result?.ok === true ? result.links.mapsHref : BUSINESS.mapsHref

  // Confirmation sentence — owner-editable template with the customer's live phone inserted.
  let confirmSentLine = ''
  if (selDate !== null && S.time && S.service) {
    confirmSentLine = t.confirmSent.split('{phone}').join(f.phone)
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
    clearFieldError('name')
    setState((st) => ({ form: { ...st.form, name: e.currentTarget.value } }))
  }
  const onPhone = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    clearFieldError('phone')
    setState((st) => ({ form: { ...st.form, phone: e.currentTarget.value } }))
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
    const contact = parseContact({ name: f.name, phone: f.phone })
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
      lang,
      turnstileToken,
    }
    try {
      const submitResult = await port.submit(booking)
      // The Turnstile token is single-use — force a fresh challenge for any subsequent attempt
      // (e.g. a slot_taken/rate_limited retry, where the popup stays open).
      setTurnstileNonce((n) => n + 1)
      if (!submitResult.ok) {
        setFieldErrors(NO_FIELD_ERRORS)
        // The adapter localizes the reason (rate_limited / failed_challenge / generic) into the message.
        setSubmitError(submitResult.error.message)
        return
      }
      // Remember this device's phone so the customer can open "Mina bokningar" later without
      // re-typing it (best-effort; localStorage failures are swallowed inside rememberPhone).
      rememberPhone(contact.value.phone)
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
    <div style={s.rootStyle}>
      {showHeader ? (
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px 0 22px;">
          <div style="display:flex;align-items:baseline;gap:8px;">
            <span style="font-family:'SF Pro Display';font-weight:700;letter-spacing:1.5px;font-size:15px;">
              BLADE & BLEND STUDIO
            </span>
            <span style="font-size:11px;opacity:.5;letter-spacing:.3px;">Göteborg</span>
          </div>
          <div style={s.tabWrapStyle}>
            <button onClick={() => setState({ lang: 'sv' })} style={tab(lang === 'sv')}>
              SV
            </button>
            <button onClick={() => setState({ lang: 'en' })} style={tab(lang === 'en')}>
              EN
            </button>
          </div>
        </div>
      ) : null}

      <div style="padding: 18px 22px 26px 22px">
        <div>
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;">
            <span style={s.badgeStyle}>1</span>
            <span style="font-family:'SF Pro Display';font-weight:600;font-size:18px;">
              {t.chooseBarber}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:11px;">
            {barbers.map((b) => (
              <button key={b.id} onClick={b.onSelect} style={b.cardStyle}>
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
            ))}
          </div>
        </div>

        {showCalendar ? (
          <div style="display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start;margin-top:26px;animation:kncFade .32s cubic-bezier(.32,.72,0,1) both;">
            <div style="flex:1 1 300px;max-width:344px;min-width:0;">
              <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;">
                <span style={s.badgeStyle}>2</span>
                <span style="font-family:'SF Pro Display';font-weight:600;font-size:18px;">
                  {t.chooseDate}
                </span>
              </div>
              <div style={s.panelStyle}>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                  <button
                    onClick={
                      canPrev
                        ? () => setState((st) => ({ monthOffset: st.monthOffset - 1 }))
                        : undefined
                    }
                    style={navBtn(canPrev)}
                  >
                    <img src="/icons/chevron.left.svg" alt="prev" style={s.navIconStyle} />
                  </button>
                  <span style="font-family:'SF Pro Display';font-weight:600;font-size:15px;">
                    {monthLabelText}
                  </span>
                  <button
                    onClick={
                      canNext
                        ? () => setState((st) => ({ monthOffset: st.monthOffset + 1 }))
                        : undefined
                    }
                    style={navBtn(canNext)}
                  >
                    <img src="/icons/chevron.right.svg" alt="next" style={s.navIconStyle} />
                  </button>
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
                    {week.map((cell, ci) => (
                      <button key={ci} onClick={cell.onClick} style={cell.cellStyle}>
                        {cell.day}
                      </button>
                    ))}
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
              <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;">
                <span style={s.badgeStyle}>3</span>
                <span style="font-family:'SF Pro Display';font-weight:600;font-size:18px;">
                  {t.chooseService}
                </span>
              </div>
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
                                <img src="/icons/chevron.right.svg" alt="" style={s.chevronStyle} />
                              ) : null}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {notServicesReady ? (
                <div style={s.timePlaceholderStyle}>{t.pickDayForService}</div>
              ) : null}
            </div>

            <div style="flex:1 1 220px;min-width:0;">
              <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;">
                <span style={s.badgeStyle}>4</span>
                <span style="font-family:'SF Pro Display';font-weight:600;font-size:18px;">
                  {t.chooseTime}
                </span>
              </div>
              {timesReady && slotsLoading ? (
                <div style={s.timePlaceholderStyle}>{t.loadingTimes}</div>
              ) : null}
              {timesReady && !slotsLoading && availableTimes.length > 0 ? (
                <div>
                  <div style="font-size:13px;opacity:.5;margin:0 0 13px 0;">{timeSubLabel}</div>
                  <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    {timeSlots.map((slot, si) => (
                      <button key={si} onClick={slot.onClick} style={slot.chipStyle}>
                        {slot.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {timesReady && !slotsLoading && availableTimes.length === 0 ? (
                <div style={s.timePlaceholderStyle}>{t.noSlots}</div>
              ) : null}
              {notTimesReady ? (
                <div style={s.timePlaceholderStyle}>{t.pickServiceForTime}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {S.showPopup ? (
        <DetailsDialog
          t={t}
          s={s}
          sumBarber={sumBarber}
          sumWhen={sumWhen}
          sumService={sumService}
          sumPrice={sumPrice}
          nameValue={f.name}
          phoneValue={f.phone}
          bookDisabled={bookDisabled}
          fieldErrors={fieldErrors}
          submitError={submitError}
          onName={onName}
          onPhone={onPhone}
          onBook={onBookClick}
          onClose={closePopup}
          onBackdropClick={onPopupBackdrop}
          turnstile={
            turnstileConfigured ? (
              <Turnstile onToken={setTurnstileToken} resetNonce={turnstileNonce} />
            ) : null
          }
        />
      ) : null}

      {S.booked ? (
        <ConfirmationDialog
          t={t}
          s={s}
          confirmSentLine={confirmSentLine}
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
    </div>
  )
}
