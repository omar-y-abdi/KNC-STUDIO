import { SitePageLinks } from '../cms/SitePageLinks'
import { useNativeSource, useNativeSurface } from '../cms/NativeSurface'
import { useContext } from 'preact/hooks'
import { PreviewPorts } from '../cms/PreviewPorts'
// "Om oss" / About section — a shared scroll-target placed after the hero/booking content on both
// the desktop and mobile layouts. Minimal/editorial on desktop, M3 cards on mobile (it simply uses
// the booking palette + 14px radii, so it reads native in both shells). Photos and reviews come
// from published records; bio copy comes from i18n/DB overlays.
//
// The review form goes through the injectable `ReviewsPort` (default: env-selected — Supabase when
// configured, an empty offline port otherwise). A valid server submission is prepended locally; the
// fallback neither persists nor invents a review.

import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { buildBookingStyles, palette, systemRed } from '../booking/bookingStyles'
import { Turnstile, turnstileConfigured } from '../booking/Turnstile'
import { FOCUS_CLS } from '../ui/pseudo'
import { langHref } from '../ui/langHref'
import type { AboutStrings, Lang } from '../i18n/index'
import { aboutStrings, privacyStrings } from '../i18n/index'
import { scalePx, type SizePreset } from '../site/siteChrome'
import { useRoster } from '../booking/useRoster'
import type { BarbersPort } from '../booking/barbersPort'
import { PlaceholderPhoto } from './PlaceholderPhoto'
import { useBarberMarquee } from './useBarberMarquee'
import { barberSocialLinks } from './barberSocialLinks'
import { GalleryMarquee } from './GalleryMarquee'
import { cutsWithWork } from './galleryCredit'
import { StarDisplay, StarRating } from './StarRating'
import type { Rating, Review, ReviewDraft, ReviewError } from './reviews/domain'
import { emptyReviewDraft } from './reviews/domain'
import { defaultReviewsPort } from './reviews/adapters/index'
import type { ReviewsPort } from './reviews/port'
import { NO_REVIEW_ERRORS, parseReview } from './reviewValidation'
import { PAGE_BUTTONS, clampPage, pageCount, pageItems, pageRow } from './reviewPages'
import type { ReviewFieldErrors } from './reviewValidation'
import { aboutContentIsMock, defaultAboutContentPort } from './content/index'
import type { AboutContentPort, AboutOverlay } from './content/port'
import { mergeAbout, stylistCopyFor } from './content/merge'
import { useGallery } from './gallery/useGallery'
import type { GalleryPort } from './gallery/port'

type Mode = 'light' | 'dark'

/** The id the "Om oss" hero link scroll-targets. */
export const ABOUT_SECTION_ID = 'om-oss'

export interface AboutSectionProps {
  readonly onManagePrivacy?: () => void
  readonly mode: Mode
  readonly lang: Lang
  /** Injected reviews seam (default: env-selected; mock adapter when no backend is configured). */
  readonly port?: ReviewsPort
  /** Injected roster seam — the barbers shown in the stylist cards (default: env-selected). */
  readonly barbersPort?: BarbersPort
  /** Injected About-copy seam — the editable section copy overlay (default: env-selected). */
  readonly aboutContentPort?: AboutContentPort
  /** Injected gallery seam — the Storage-backed photos (default: env-selected; mock = empty). */
  readonly galleryPort?: GalleryPort
  /** Owner-set font-size preset for the section's editorial header (default 'md' = 1.0×). */
  readonly fontScale?: SizePreset
  /** CMS replicas disable external challenge I/O; public pages keep it enabled by default. */
  readonly challengeEnabled?: boolean
  /** Layout-specific compact panel height to keep the target visible after a hero-link scroll. */
  readonly scrollMarginTop?: string
  /** Enable the mobile-only interactive barber carousel. */
  readonly mobile?: boolean
  /** Contact scope from the server-verified customer session; never an authorization secret. */
  readonly customerPhone?: string
}

/** The element that scrolls `node`: the nearest scrolling ancestor, else the document. */
function scrollContainerOf(node: HTMLElement): Element {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent)
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent
  }
  return document.scrollingElement ?? document.documentElement
}

export function AboutSection(props: AboutSectionProps): JSX.Element {
  const previewPorts = useContext(PreviewPorts)
  if (previewPorts)
    props = {
      ...props,
      port: previewPorts.reviews,
      barbersPort: previewPorts.barbers,
      aboutContentPort: previewPorts.aboutContent,
      galleryPort: previewPorts.gallery,
      challengeEnabled: false,
    }

  const lang = props.lang
  const nativeSource = useNativeSource()
  const base: AboutStrings = aboutStrings(lang)
  const dark = props.mode === 'dark'
  const c = palette(dark)
  const s = buildBookingStyles(c, dark, false)
  const red = systemRed(dark)
  const port: ReviewsPort = props.port ?? defaultReviewsPort
  const sectionRef = useRef<HTMLElement>(null)
  const barberTrackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (previewPorts || window.location.pathname !== '/about') return
    const frame = window.requestAnimationFrame(() =>
      sectionRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' }),
    )
    return () => window.cancelAnimationFrame(frame)
  }, [])
  const deferPublicData =
    props.port === undefined &&
    props.barbersPort === undefined &&
    props.aboutContentPort === undefined &&
    props.galleryPort === undefined
  const [dataActive, setDataActive] = useState(!deferPublicData)

  useEffect(() => {
    if (!deferPublicData) {
      setDataActive(true)
      return
    }
    const section = sectionRef.current
    if (section === null || typeof IntersectionObserver === 'undefined') {
      setDataActive(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDataActive(true)
          observer.disconnect()
        }
      },
      { threshold: 0.01 },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [deferPublicData])

  // Editable About copy: i18n is the base; a configured backend overlays the 7 DB-editable keys.
  // Under the mock the overlay stays empty, so `tx` === the i18n copy, byte-identical to today (and
  // the ~13 non-DB strings — alts, the whole review form, rating labels — always come from i18n).
  const contentPort: AboutContentPort = props.aboutContentPort ?? defaultAboutContentPort
  const [overlay, setOverlay] = useState<AboutOverlay>({})
  useEffect(() => {
    if (!dataActive || aboutContentIsMock) return // defer public I/O until About enters the viewport
    let live = true
    void contentPort
      .overlay(lang)
      .then((o) => {
        if (live) setOverlay(o)
      })
      .catch(() => {
        /* keep the i18n base on error */
      })
    return () => {
      live = false
    }
  }, [contentPort, dataActive, lang])
  const tx: AboutStrings = mergeAbout(base, overlay)

  // The stylist cards' roster (constant under the mock, immediate; DB rows under a backend). The
  // per-barber role/bio ride along on each entry's `copy` (null under the mock → i18n fallback).
  const { roster } = useRoster(props.barbersPort, dataActive)
  const {
    selected: selectedBarber,
    toggle: toggleBarber,
    reducedMotion,
    animate,
  } = useBarberMarquee({
    enabled: Boolean(props.mobile),
    source: nativeSource,
    rosterIds: roster.map(({ barber }) => barber.id),
    rootRef: sectionRef,
    trackRef: barberTrackRef,
  })

  // Distinguish loading, unpublished galleries and read failures; only real photos are interactive.
  const salonPhotos = useGallery('salon', props.galleryPort, dataActive)
  const cutPhotos = useGallery('cuts', props.galleryPort, dataActive)
  const cuts = useMemo(
    () =>
      cutPhotos.status === 'ready'
        ? { ...cutPhotos, photos: cutsWithWork(cutPhotos.photos, roster) }
        : cutPhotos,
    [cutPhotos, roster],
  )

  // Reviews list: server-published entries only. The offline fallback is intentionally empty.
  const [reviews, setReviews] = useState<readonly Review[]>([])
  const [reviewsState, setReviewsState] = useState<'loading' | 'ready' | 'error'>('loading')
  // Five reviews per page, newest first. The page row moves only through its arrows and never
  // changes the page being read (reviewPages.ts); a fresh list or a new review returns to page 1.
  const [reviewPage, setReviewPage] = useState(1)
  const [pageRowStart, setPageRowStart] = useState(1)
  const reviewPagesRef = useRef<HTMLElement>(null)
  // Where the page row sat when a page button was pressed. A page of longer or shorter reviews
  // moves the row; before paint, scroll by that difference so the pressed button stays put.
  const pageRowTop = useRef<number | null>(null)
  useLayoutEffect(() => {
    const before = pageRowTop.current
    const row = reviewPagesRef.current
    pageRowTop.current = null
    if (before === null || row === null) return
    const shift = row.getBoundingClientRect().top - before
    if (shift !== 0) scrollContainerOf(row).scrollBy({ top: shift, behavior: 'instant' })
  }, [reviewPage])
  useEffect(() => {
    if (!dataActive) return
    let live = true
    setReviewsState('loading')
    void port
      .list()
      .then((published) => {
        if (!live) return
        setReviews(published)
        setReviewPage(1)
        setPageRowStart(1)
        setReviewsState('ready')
      })
      .catch(() => {
        if (live) setReviewsState('error')
      })
    return () => {
      live = false
    }
  }, [dataActive, port])

  // Review form state — raw draft + per-field errors + a transient thank-you flag + a submit-level
  // error (no device receipt or verified session, no eligible booking, or an invalid/transport
  // failure).
  const [draft, setDraft] = useState<ReviewDraft>(emptyReviewDraft)
  const typedPhone = useRef(false)
  useEffect(() => {
    if (!typedPhone.current) {
      setDraft((current) => ({ ...current, phone: props.customerPhone ?? '' }))
    }
  }, [props.customerPhone])
  const [errors, setErrors] = useState<ReviewFieldErrors>(NO_REVIEW_ERRORS)
  const [thanks, setThanks] = useState<boolean>(false)
  const [submitError, setSubmitError] = useState<ReviewError | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)
  const challengeRequired = props.challengeEnabled !== false && turnstileConfigured
  const submitBlocked = submitting || (challengeRequired && turnstileToken === '')

  const submitErrorText = (error: ReviewError): string => {
    switch (error.kind) {
      case 'no_booking':
        return tx.reviewErrNoBooking
      case 'invalid':
        return tx.reviewErrInvalid
      case 'challenge':
        return tx.reviewErrChallenge
      case 'rate_limited':
        return tx.reviewErrRateLimited
      case 'submit':
        return tx.reviewErrSubmit
      case 'unavailable':
        return tx.reviewErrUnavailable
    }
  }

  // Editing a field clears the thank-you, the submit error and that field's own error.
  const setField = <K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]): void => {
    setThanks(false)
    setSubmitError(null)
    setErrors((p) => (p[key] ? { ...p, [key]: false } : p))
    setDraft((d) => ({ ...d, [key]: value }))
  }
  const setPhone = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    typedPhone.current = true
    setField('phone', e.currentTarget.value)
  }
  const setText = (e: JSX.TargetedInputEvent<HTMLTextAreaElement>): void =>
    setField('text', e.currentTarget.value)
  const setRating = (r: Rating): void => setField('rating', r)

  const submit = async (): Promise<void> => {
    const parsed = parseReview(draft)
    if (!parsed.ok) {
      setErrors(parsed.fields)
      return
    }
    setSubmitting(true)
    try {
      const result = await port.submit(parsed.value, turnstileToken)
      if (result.ok) {
        setReviews((prev) => [result.review, ...prev])
        setReviewPage(1)
        setPageRowStart(1)
        typedPhone.current = false
        setDraft({ ...emptyReviewDraft, phone: props.customerPhone ?? '' })
        setErrors(NO_REVIEW_ERRORS)
        setSubmitError(null)
        setThanks(true)
      } else {
        setThanks(false)
        setSubmitError(result.error)
      }
    } finally {
      setSubmitting(false)
      setTurnstileToken('')
      setTurnstileNonce((nonce) => nonce + 1)
    }
  }
  const onSubmitClick = (): void => {
    void submit()
  }

  const reviewPages = pageCount(reviews.length)
  const currentReviewPage = clampPage(reviewPage, reviewPages)
  const visibleReviews = pageItems(reviews, currentReviewPage)
  const reviewRow = pageRow(pageRowStart, reviewPages)
  // With more pages than buttons both arrows keep their slot even when hidden, so no button
  // shifts sideways as the row moves.
  const arrowSlots = reviewPages > PAGE_BUTTONS
  const showReviewPage = (page: number): void => {
    if (page === currentReviewPage) return
    pageRowTop.current = reviewPagesRef.current?.getBoundingClientRect().top ?? null
    setReviewPage(page)
  }
  const moveReviewRow = (
    start: number,
    edge: 'first' | 'last',
    event: JSX.TargetedMouseEvent<HTMLButtonElement>,
  ): void => {
    const hadFocus = event.currentTarget === document.activeElement
    setPageRowStart(start)
    // The arrow just pressed is gone once the row reaches that end; keep keyboard focus in the row.
    window.requestAnimationFrame(() => {
      const row = reviewPagesRef.current
      if (!hadFocus || row === null || row.contains(document.activeElement)) return
      const buttons = row.querySelectorAll('button')
      buttons.item(edge === 'first' ? 0 : buttons.length - 1).focus({ preventScroll: true })
    })
  }

  // --- styles (composed from the booking palette so the section matches the site exactly) ---
  const sectionStyle: JSX.CSSProperties = {
    background: c.bg,
    color: c.text,
    fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
    WebkitFontSmoothing: 'antialiased',
    borderTop: '.5px solid ' + c.line,
    // Keeps the heading clear of the layout's compact panel after a hero-link scroll.
    scrollMarginTop: props.scrollMarginTop ?? '112px',
  }
  const innerStyle: JSX.CSSProperties = {
    maxWidth: '1080px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    padding: '64px 24px 72px',
  }
  // Full-bleed breakout for the marquee galleries: span the FULL viewport width so tiles scroll in
  // from the screen edge, not from inside the centered content column. The standard centered-container
  // breakout; ancestors clip overflow (desktop fold-inner / mobile shell are overflow:hidden), so it
  // adds no horizontal page scroll.
  const fullBleedStyle: JSX.CSSProperties = {
    width: '100vw',
    marginLeft: 'calc(50% - 50vw)',
  }
  // Owner-set section scale (Task 2 §2) — applied to the editorial header block (eyebrow / heading /
  // intro). Bounded preset, so even 'xl' stays within the section without overflow.
  const scale = props.fontScale ?? 'md'
  const eyebrowStyle: JSX.CSSProperties = {
    fontSize: scalePx(12, scale) + 'px',
    fontWeight: 700,
    letterSpacing: '1.5px',
    opacity: 0.45,
    marginBottom: '12px',
  }
  const headingStyle: JSX.CSSProperties = {
    fontFamily: "'Inter Variable'",
    fontWeight: 600,
    fontSize: scalePx(34, scale) + 'px',
    letterSpacing: '-0.8px',
    lineHeight: 1.1,
    margin: '0 0 16px',
  }
  const introStyle: JSX.CSSProperties = {
    fontSize: scalePx(16, scale) + 'px',
    lineHeight: 1.6,
    opacity: 0.62,
    maxWidth: '600px',
    margin: '0 0 8px',
  }
  const blockTitleStyle: JSX.CSSProperties = {
    fontFamily: "'Inter Variable'",
    fontWeight: 600,
    fontSize: '20px',
    letterSpacing: '-0.3px',
    margin: '48px 0 16px',
  }
  const stylistGridStyle: JSX.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '14px',
  }
  const cardStyle = (padding: string, gap: string): JSX.CSSProperties => ({
    background: c.card,
    border: '0.5px solid ' + c.line,
    borderRadius: '14px',
    padding,
    boxShadow: '0 1px 2px rgba(0,0,0,.05)',
    display: 'flex',
    flexDirection: 'column',
    gap,
  })
  const stylistCardStyle = cardStyle('14px', '12px')
  const reviewCardStyle = cardStyle('15px 16px', '8px')
  // Loading, empty and unavailable notes of the galleries and the review list.
  const noteStyle: JSX.CSSProperties = {
    fontSize: '13.5px',
    lineHeight: 1.5,
    opacity: 0.62,
    margin: 0,
  }
  const reviewsWrapStyle: JSX.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '12px',
    marginBottom: '24px',
  }
  // The page row is the grid's last row, so the review form keeps its place (and CMS slot id).
  const reviewPagesStyle: JSX.CSSProperties = {
    gridColumn: '1 / -1',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '4px',
  }
  // A fixed 40px slot per button (three digits fit), so the row never changes width.
  const pageSlotStyle: JSX.CSSProperties = { flex: 'none', width: '40px', height: '40px' }
  // Same chip as the booking time slots: the page being read takes the accent fill.
  const pageButtonStyle = (current: boolean): JSX.CSSProperties => ({
    ...pageSlotStyle,
    padding: 0,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: current ? '1px solid ' + c.accent : '0.5px solid ' + c.inputLine,
    borderRadius: '9px',
    background: current ? c.accent : c.card,
    color: current ? c.accentText : c.text,
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: current ? 600 : 500,
    fontVariantNumeric: 'tabular-nums',
    cursor: current ? 'default' : 'pointer',
    transition: 'background .12s',
  })
  const formCardStyle: JSX.CSSProperties = {
    background: c.card,
    border: '0.5px solid ' + c.line,
    borderRadius: '14px',
    padding: '18px',
    boxShadow: '0 1px 2px rgba(0,0,0,.05)',
    maxWidth: '520px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  }
  const labelStyle: JSX.CSSProperties = { fontSize: '12px', fontWeight: 600, opacity: 0.55 }
  const hintStyle: JSX.CSSProperties = { fontSize: '11.5px', opacity: 0.5, lineHeight: 1.45 }
  const fieldColStyle: JSX.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' }
  const textareaBase: JSX.CSSProperties = {
    border: '.5px solid ' + c.inputLine,
    borderRadius: '9px',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: '15px',
    outline: 'none',
    background: c.input,
    color: c.text,
    resize: 'vertical',
    minHeight: '88px',
  }
  const textareaErr: JSX.CSSProperties = {
    ...textareaBase,
    border: '.5px solid ' + red,
    boxShadow: '0 0 0 3px ' + (dark ? 'rgba(255,69,58,.28)' : 'rgba(255,59,48,.28)'),
  }
  const footerLinkStyle: JSX.CSSProperties = {
    color: c.text,
    opacity: 0.65,
    fontSize: '12px',
    textUnderlineOffset: '3px',
  }
  // `knc-hit-footer` (global.css) enlarges the pointer target without moving the link.
  const footerLinkClass = FOCUS_CLS + ' knc-hit-footer'

  // The interactive photo marquee of one gallery, or the note that stands in for it.
  const gallery = (state: ReturnType<typeof useGallery>, alt: string): JSX.Element =>
    state.status === 'ready' && state.photos.length > 0 ? (
      <div style={fullBleedStyle}>
        <GalleryMarquee photos={state.photos} alt={alt} c={c} />
      </div>
    ) : (
      <p role="status" style={noteStyle}>
        {state.status === 'loading'
          ? tx.galleryLoading
          : state.status === 'error'
            ? tx.galleryUnavailable
            : tx.galleryEmpty}
      </p>
    )
  // One arrow of the page row: the button that moves it, or the slot it leaves when hidden.
  const rowArrow = (
    start: number | null,
    edge: 'first' | 'last',
    label: string,
    icon: string,
  ): JSX.Element | null =>
    start === null ? (
      arrowSlots ? (
        <span aria-hidden="true" style={pageSlotStyle} />
      ) : null
    ) : (
      <button
        type="button"
        aria-label={label}
        onClick={(event) => moveReviewRow(start, edge, event)}
        style={pageButtonStyle(false)}
      >
        <img src={icon} alt="" style={s.navIconStyle} />
      </button>
    )

  const surface = useNativeSurface(
    <section
      ref={sectionRef}
      id={ABOUT_SECTION_ID}
      style={sectionStyle}
      aria-labelledby="om-oss-heading"
    >
      <div style={innerStyle}>
        <div style={eyebrowStyle}>{tx.eyebrow}</div>
        <h2 id="om-oss-heading" style={headingStyle}>
          {tx.heading}
        </h2>
        <p style={introStyle}>{tx.intro}</p>

        {/* Salon gallery — two counter-scrolling, draggable marquee rows (tap a tile to focus it).
            Full-bleed so the tiles enter/exit at the screen edge, not the content column. */}
        <h3 style={blockTitleStyle}>{tx.galleryTitle}</h3>
        {gallery(salonPhotos, tx.galleryAlt)}

        {/* Stylists — driven by the database roster (N barbers, not a frontend constant). */}
        <h3 style={blockTitleStyle}>{tx.stylistsTitle}</h3>
        <div
          ref={barberTrackRef}
          data-knc-fold="barber-marquee"
          role={props.mobile ? 'region' : undefined}
          aria-label={props.mobile ? tx.stylistsTitle : undefined}
          aria-roledescription={props.mobile ? 'carousel' : undefined}
          style={
            props.mobile
              ? {
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 0,
                  ...fullBleedStyle,
                  padding: '4px 0 10px',
                  boxSizing: 'border-box',
                  overflowX: animate ? 'visible' : 'auto',
                  overflowY: animate ? 'visible' : 'hidden',
                  touchAction: animate ? 'pan-y pinch-zoom' : 'pan-x pan-y pinch-zoom',
                  scrollbarWidth: 'none',
                  scrollSnapType: animate ? undefined : 'x proximity',
                }
              : stylistGridStyle
          }
        >
          {roster.map((entry) => {
            const b = entry.barber
            const copy = stylistCopyFor(entry, lang)
            const active = props.mobile && selectedBarber === b.id
            const tiktok = entry.tiktok ?? ''
            const tiktokTrack = tiktok === '' ? '' : ` ${active ? '1fr' : '0fr'}`
            const infoTransition = reducedMotion
              ? 'none'
              : 'grid-template-rows .36s ease, opacity .24s ease'
            return (
              <div
                key={b.id}
                role={props.mobile ? 'button' : undefined}
                tabIndex={props.mobile ? 0 : undefined}
                aria-expanded={props.mobile ? active : undefined}
                onClick={
                  props.mobile
                    ? (event) => {
                        if (event.defaultPrevented) return
                        if (event.detail > 0 && active) event.currentTarget.blur()
                        if (!active && !animate)
                          event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center' })
                        toggleBarber(b.id, event.currentTarget)
                      }
                    : undefined
                }
                onKeyDown={
                  props.mobile
                    ? (event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        if (!active && !animate)
                          event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center' })
                        toggleBarber(b.id, event.currentTarget)
                      }
                    : undefined
                }
                style={
                  props.mobile
                    ? {
                        ...stylistCardStyle,
                        display: 'grid',
                        gridTemplateRows: copy
                          ? `auto auto ${active ? '1fr' : '0fr'}`
                          : 'auto auto',
                        flex: '0 0 calc(100vw - 24px)',
                        width: 'calc(100vw - 24px)',
                        margin: roster.length > 1 ? '0 16px' : '0 12px',
                        boxSizing: 'border-box',
                        minWidth: 0,
                        scale: active ? '1.02' : '1',
                        borderColor: active ? c.text : c.line,
                        boxShadow: active
                          ? '0 5px 20px rgba(0,0,0,.12)'
                          : stylistCardStyle.boxShadow,
                        cursor: 'pointer',
                        scrollSnapAlign: 'center',
                        transition: reducedMotion
                          ? 'none'
                          : 'scale .3s ease, grid-template-rows .36s ease, border-color .3s ease, box-shadow .3s ease',
                      }
                    : stylistCardStyle
                }
              >
                {entry.photoUrl !== null ? (
                  <img
                    src={entry.photoUrl}
                    alt={props.mobile ? '' : b.name}
                    loading="lazy"
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      objectFit: 'cover',
                      borderRadius: '14px',
                      border: '0.5px solid ' + c.line,
                      display: 'block',
                    }}
                  />
                ) : (
                  <PlaceholderPhoto c={c} dark={dark} />
                )}
                <div
                  style={
                    props.mobile
                      ? {
                          display: 'grid',
                          gridTemplateRows: copy
                            ? `auto ${active ? '1fr' : '0fr'} ${active ? '1fr' : '0fr'}${tiktokTrack}`
                            : `auto ${active ? '1fr' : '0fr'}${tiktokTrack}`,
                          gap: active ? '3px' : 0,
                          transition: infoTransition,
                        }
                      : tiktok === ''
                        ? { display: 'flex', flexDirection: 'column', gap: '3px' }
                        : { display: 'grid', gap: '3px' }
                  }
                >
                  <span style={{ fontWeight: 600, fontSize: '16px' }}>{b.name}</span>
                  <span
                    data-barber-social="instagram"
                    aria-hidden={props.mobile ? !active : undefined}
                    style={{
                      fontSize: '12.5px',
                      opacity: props.mobile ? (active ? 0.5 : 0) : 0.5,
                      minHeight: 0,
                      overflow: props.mobile ? 'hidden' : undefined,
                      transition: reducedMotion ? 'none' : 'opacity .24s ease',
                    }}
                  >
                    {b.ig === '' ? null : `@${b.ig}`}
                  </span>
                  {copy ? (
                    <span
                      data-barber-social="bio"
                      aria-hidden={props.mobile ? !active : undefined}
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '.4px',
                        opacity: props.mobile ? (active ? 0.5 : 0) : 0.5,
                        marginTop: active || !props.mobile ? '2px' : 0,
                        minHeight: 0,
                        overflow: props.mobile ? 'hidden' : undefined,
                        transition: reducedMotion ? 'none' : 'opacity .24s ease',
                      }}
                    >
                      {copy.role}
                    </span>
                  ) : null}
                  {tiktok === '' ? null : (
                    <span
                      key="tiktok"
                      data-barber-social="tiktok"
                      aria-hidden={props.mobile ? !active : undefined}
                      style={{
                        fontSize: '12.5px',
                        opacity: props.mobile ? (active ? 0.5 : 0) : 0.5,
                        minHeight: 0,
                        overflow: props.mobile ? 'hidden' : undefined,
                        transition: reducedMotion ? 'none' : 'opacity .24s ease',
                        gridRow: 3,
                      }}
                    >
                      {`TikTok @${tiktok}`}
                    </span>
                  )}
                </div>
                {copy ? (
                  <p
                    data-barber-social="bio"
                    aria-hidden={props.mobile ? !active : undefined}
                    style={{
                      fontSize: '13.5px',
                      lineHeight: 1.5,
                      opacity: props.mobile ? (active ? 0.62 : 0) : 0.62,
                      margin: 0,
                      minHeight: 0,
                      overflow: props.mobile ? 'hidden' : undefined,
                      transition: reducedMotion ? 'none' : 'opacity .24s ease',
                    }}
                  >
                    {copy.bio}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Customer-cuts gallery — the same interactive photo marquee. Full-bleed too. */}
        <h3 style={blockTitleStyle}>{tx.cutsTitle}</h3>
        {gallery(cuts, tx.cutsAlt)}

        {/* Reviews */}
        <h3 style={blockTitleStyle}>{tx.reviewsTitle}</h3>
        <div style={reviewsWrapStyle}>
          {reviewsState === 'loading' ? (
            <p aria-live="polite" style={noteStyle}>
              {tx.reviewsLoading}
            </p>
          ) : null}
          {reviewsState === 'error' ? (
            <p role="status" style={noteStyle}>
              {tx.reviewsUnavailable}
            </p>
          ) : null}
          {reviewsState === 'ready' && reviews.length === 0 ? (
            <p style={noteStyle}>{tx.reviewsEmpty}</p>
          ) : null}
          {reviewsState === 'ready'
            ? visibleReviews.map((r) => (
                <div key={r.id} style={reviewCardStyle}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '14px',
                        minWidth: 0,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {r.name}
                    </span>
                    <StarDisplay
                      rating={r.rating}
                      c={c}
                      label={tx.ratingValueLabel.replace('{n}', String(r.rating))}
                    />
                  </div>
                  <p
                    style={{
                      fontSize: '13.5px',
                      lineHeight: 1.5,
                      opacity: 0.7,
                      margin: 0,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {r.text}
                  </p>
                </div>
              ))
            : null}
          {reviewsState === 'ready' && reviewPages > 1 ? (
            <nav
              key="review-pages"
              ref={reviewPagesRef}
              aria-label={tx.reviewPagesLabel}
              style={reviewPagesStyle}
            >
              {rowArrow(
                reviewRow.previousStart,
                'first',
                tx.reviewPagesPrevious,
                '/icons/chevron.left.svg',
              )}
              {reviewRow.pages.map((page) => (
                <button
                  key={page}
                  type="button"
                  aria-label={tx.reviewPageLabel.replace('{n}', String(page))}
                  aria-current={page === currentReviewPage ? 'page' : undefined}
                  onClick={() => showReviewPage(page)}
                  style={pageButtonStyle(page === currentReviewPage)}
                >
                  {page}
                </button>
              ))}
              {rowArrow(
                reviewRow.nextStart,
                'last',
                tx.reviewPagesNext,
                '/icons/chevron.right.svg',
              )}
            </nav>
          ) : null}
        </div>

        {/* Leave a review */}
        <div style={formCardStyle}>
          <span style={{ fontFamily: "'Inter Variable'", fontWeight: 600, fontSize: '16px' }}>
            {tx.reviewSubmit}
          </span>

          <label style={fieldColStyle}>
            <span style={labelStyle}>{tx.reviewPhone}</span>
            <input
              value={draft.phone}
              onInput={setPhone}
              placeholder={tx.reviewPhonePh}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              aria-invalid={errors.phone ? 'true' : undefined}
              style={errors.phone ? s.inputErrorStyle : s.inputStyle}
              class={FOCUS_CLS}
            />
            <span style={hintStyle}>{tx.reviewPhoneHint}</span>
            {errors.phone ? (
              <span role="alert" style={s.fieldErrorNoteStyle}>
                {tx.reviewErrPhone}
              </span>
            ) : null}
          </label>

          <div style={fieldColStyle}>
            <span style={labelStyle}>{tx.reviewRating}</span>
            <StarRating
              value={draft.rating}
              onChange={setRating}
              c={c}
              groupLabel={tx.ratingGroupLabel}
              starLabel={(n) => tx.ratingStarLabel.replace('{n}', String(n))}
              invalid={errors.rating}
              errorColor={red}
            />
            {errors.rating ? (
              <span role="alert" style={s.fieldErrorNoteStyle}>
                {tx.reviewErrRating}
              </span>
            ) : null}
          </div>

          <label style={fieldColStyle}>
            <span style={labelStyle}>{tx.reviewText}</span>
            <textarea
              value={draft.text}
              onInput={setText}
              placeholder={tx.reviewTextPh}
              aria-invalid={errors.text ? 'true' : undefined}
              style={errors.text ? textareaErr : textareaBase}
              class={FOCUS_CLS}
            />
            {errors.text ? (
              <span role="alert" style={s.fieldErrorNoteStyle}>
                {tx.reviewErrText}
              </span>
            ) : null}
          </label>

          {submitError !== null ? (
            <p role="alert" style={s.submitErrorStyle}>
              {submitErrorText(submitError)}
            </p>
          ) : null}

          {thanks ? (
            <p
              role="status"
              style={{ fontSize: '13px', fontWeight: 600, color: c.text, opacity: 0.8, margin: 0 }}
            >
              {tx.reviewThanks}
            </p>
          ) : null}

          {props.challengeEnabled === false || !dataActive ? null : (
            <Turnstile
              action="review"
              lang={props.lang}
              onToken={setTurnstileToken}
              resetNonce={turnstileNonce}
            />
          )}

          <button
            type="button"
            onClick={submitBlocked ? undefined : onSubmitClick}
            disabled={submitBlocked}
            style={{
              ...s.bookBtnStyle,
              opacity: submitBlocked ? 0.5 : 1,
              cursor: submitBlocked ? 'default' : 'pointer',
            }}
          >
            {tx.reviewSubmit}
          </button>
        </div>
      </div>
      <footer
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '8px 18px',
          padding: '24px 0 8px',
          textAlign: 'center',
        }}
      >
        <a href={langHref('/terms', props.lang)} class={footerLinkClass} style={footerLinkStyle}>
          {tx.termsLink}
        </a>
        <a href={langHref('/privacy', props.lang)} class={footerLinkClass} style={footerLinkStyle}>
          {tx.privacyLink}
        </a>
        {props.onManagePrivacy ? (
          <a
            href="#privacy-preferences"
            class={footerLinkClass}
            aria-label={privacyStrings(props.lang).manageLabel}
            onClick={(event) => {
              event.preventDefault()
              props.onManagePrivacy?.()
            }}
            style={footerLinkStyle}
          >
            {privacyStrings(props.lang).manage}
          </a>
        ) : null}
        <SitePageLinks lang={props.lang} mode={props.mode} />
      </footer>
    </section>,
    'about',
    props.lang,
    props.mode,
  )
  return nativeSource ? surface : barberSocialLinks(surface)
}
