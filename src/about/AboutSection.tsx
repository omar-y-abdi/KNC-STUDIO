// "Om oss" / About section — a shared scroll-target placed after the hero/booking content on both
// the desktop and mobile layouts. Minimal/editorial on desktop, M3 cards on mobile (it simply uses
// the booking palette + 14px radii, so it reads native in both shells). All photos are tasteful
// placeholders (PlaceholderPhoto); bio copy comes from i18n/DB overlays while displayed reviews
// come only from published review records.
//
// The review form goes through the injectable `ReviewsPort` (default: env-selected — Supabase when
// configured, an empty offline port otherwise). A valid server submission is prepended locally; the
// fallback neither persists nor invents a review.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { buildBookingStyles, palette, systemRed } from '../booking/bookingStyles'
import { Turnstile, turnstileConfigured } from '../booking/Turnstile'
import { FOCUS_CLS } from '../ui/pseudo'
import type { AboutStrings, Lang } from '../i18n/index'
import { aboutStrings } from '../i18n/index'
import { scalePx, type SizePreset } from '../site/siteChrome'
import { useRoster } from '../booking/useRoster'
import type { BarbersPort } from '../booking/barbersPort'
import { PlaceholderPhoto } from './PlaceholderPhoto'
import { GalleryMarquee } from './GalleryMarquee'
import { StarDisplay, StarRating } from './StarRating'
import type { Rating, Review, ReviewDraft, ReviewError } from './reviews/domain'
import { emptyReviewDraft } from './reviews/domain'
import { defaultReviewsPort } from './reviews/adapters/index'
import type { ReviewsPort } from './reviews/port'
import { NO_REVIEW_ERRORS, parseReview } from './reviewValidation'
import type { ReviewFieldErrors } from './reviewValidation'
import { aboutContentIsMock, defaultAboutContentPort } from './content/index'
import type { AboutContentPort, AboutOverlay } from './content/port'
import { mergeAbout, stylistCopyFor } from './content/merge'
import { useGallery } from './gallery/useGallery'
import type { GalleryPort } from './gallery/port'

type Mode = 'light' | 'dark'

/** The id the "Om oss" hero link scroll-targets. */
export const ABOUT_SECTION_ID = 'om-oss'

// Placeholder photo ids — the placeholder tiles + their keys when there are no DB photos. Module-
// scope constants (stable identities) so they aren't reallocated on every render.
const SALON_IDS: readonly string[] = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']
const CUT_IDS: readonly string[] = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']

export interface AboutSectionProps {
  readonly mode: Mode
  readonly lang: Lang
  /** Injected reviews seam (default: env-selected; mock adapter when no backend is configured). */
  readonly port?: ReviewsPort
  /** Injected roster seam — the barbers shown in the stylist cards (default: env-selected). */
  readonly barbersPort?: BarbersPort
  /** Injected About-copy seam — the editable section copy overlay (default: env-selected). */
  readonly aboutContentPort?: AboutContentPort
  /** Injected gallery seam — the Storage-backed photos (default: env-selected; mock = placeholders). */
  readonly galleryPort?: GalleryPort
  /** Owner-set font-size preset for the section's editorial header (default 'md' = 1.0×). */
  readonly fontScale?: SizePreset
  /** CMS replicas disable external challenge I/O; public pages keep it enabled by default. */
  readonly challengeEnabled?: boolean
  /** Layout-specific compact panel height to keep the target visible after a hero-link scroll. */
  readonly scrollMarginTop?: string
}

export function AboutSection(props: AboutSectionProps): JSX.Element {
  const lang = props.lang
  const base: AboutStrings = aboutStrings(lang)
  const dark = props.mode === 'dark'
  const c = palette(dark)
  const s = buildBookingStyles(c, dark, false)
  const red = systemRed(dark)
  const port: ReviewsPort = props.port ?? defaultReviewsPort
  const sectionRef = useRef<HTMLElement>(null)
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

  // Gallery photos per kind: empty under the mock (placeholder tiles), Storage URLs under a backend.
  const salonPhotos = useGallery('salon', props.galleryPort, dataActive)
  const cutPhotos = useGallery('cuts', props.galleryPort, dataActive)

  // Reviews list: server-published entries only. The offline fallback is intentionally empty.
  const [reviews, setReviews] = useState<readonly Review[]>([])
  const [reviewsState, setReviewsState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    if (!dataActive) return
    let live = true
    setReviewsState('loading')
    void port
      .list()
      .then((published) => {
        if (!live) return
        setReviews(published)
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
  // error (the phone gate `no_booking`, or a generic invalid/transport failure).
  const [draft, setDraft] = useState<ReviewDraft>(emptyReviewDraft)
  const [errors, setErrors] = useState<ReviewFieldErrors>(NO_REVIEW_ERRORS)
  const [thanks, setThanks] = useState<boolean>(false)
  const [submitError, setSubmitError] = useState<ReviewError | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileNonce, setTurnstileNonce] = useState(0)
  const challengeRequired = props.challengeEnabled !== false && turnstileConfigured

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

  const setPhone = (e: JSX.TargetedInputEvent<HTMLInputElement>): void => {
    setThanks(false)
    setSubmitError(null)
    setErrors((p) => (p.phone ? { ...p, phone: false } : p))
    const v = e.currentTarget.value
    setDraft((d) => ({ ...d, phone: v }))
  }
  const setText = (e: JSX.TargetedInputEvent<HTMLTextAreaElement>): void => {
    setThanks(false)
    setSubmitError(null)
    setErrors((p) => (p.text ? { ...p, text: false } : p))
    const v = e.currentTarget.value
    setDraft((d) => ({ ...d, text: v }))
  }
  const setRating = (r: Rating): void => {
    setThanks(false)
    setSubmitError(null)
    setErrors((p) => (p.rating ? { ...p, rating: false } : p))
    setDraft((d) => ({ ...d, rating: r }))
  }

  const submit = async (): Promise<void> => {
    const parsed = parseReview({ phone: draft.phone, rating: draft.rating, text: draft.text })
    if (!parsed.ok) {
      setErrors(parsed.fields)
      return
    }
    setSubmitting(true)
    try {
      const result = await port.submit(parsed.value, turnstileToken)
      if (result.ok) {
        setReviews((prev) => [result.review, ...prev])
        setDraft(emptyReviewDraft)
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
  const stylistCardStyle: JSX.CSSProperties = {
    background: c.card,
    border: '0.5px solid ' + c.line,
    borderRadius: '14px',
    padding: '14px',
    boxShadow: '0 1px 2px rgba(0,0,0,.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  }
  const reviewCardStyle: JSX.CSSProperties = {
    background: c.card,
    border: '0.5px solid ' + c.line,
    borderRadius: '14px',
    padding: '15px 16px',
    boxShadow: '0 1px 2px rgba(0,0,0,.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  }
  const reviewsWrapStyle: JSX.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '12px',
    marginBottom: '24px',
  }
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

  return (
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
        <div style={fullBleedStyle}>
          <GalleryMarquee
            ids={SALON_IDS}
            photos={salonPhotos}
            glyph="camera"
            alt={tx.galleryAlt}
            c={c}
            dark={dark}
          />
        </div>

        {/* Stylists — driven by the database roster (N barbers, not a frontend constant). */}
        <h3 style={blockTitleStyle}>{tx.stylistsTitle}</h3>
        <div style={stylistGridStyle}>
          {roster.map((entry) => {
            const b = entry.barber
            const copy = stylistCopyFor(entry, lang)
            return (
              <div key={b.id} style={stylistCardStyle}>
                {entry.photoUrl !== null ? (
                  <img
                    src={entry.photoUrl}
                    alt={b.name}
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
                  <PlaceholderPhoto
                    c={c}
                    dark={dark}
                    glyph="person"
                    alt={tx.stylistAvatarAlt}
                    ratio="1 / 1"
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontWeight: 600, fontSize: '16px' }}>{b.name}</span>
                  <span style={{ fontSize: '12.5px', opacity: 0.5 }}>@{b.ig}</span>
                  {copy ? (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '.4px',
                        opacity: 0.5,
                        marginTop: '2px',
                      }}
                    >
                      {copy.role}
                    </span>
                  ) : null}
                </div>
                {copy ? (
                  <p style={{ fontSize: '13.5px', lineHeight: 1.5, opacity: 0.62, margin: 0 }}>
                    {copy.bio}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Customer-cuts gallery — same interactive marquee, scissors glyph. Full-bleed too. */}
        <h3 style={blockTitleStyle}>{tx.cutsTitle}</h3>
        <div style={fullBleedStyle}>
          <GalleryMarquee
            ids={CUT_IDS}
            photos={cutPhotos}
            glyph="scissors"
            alt={tx.cutsAlt}
            c={c}
            dark={dark}
          />
        </div>

        {/* Reviews */}
        <h3 style={blockTitleStyle}>{tx.reviewsTitle}</h3>
        <div style={reviewsWrapStyle}>
          {reviewsState === 'loading' ? (
            <p
              aria-live="polite"
              style={{ fontSize: '13.5px', lineHeight: 1.5, opacity: 0.62, margin: 0 }}
            >
              {tx.reviewsLoading}
            </p>
          ) : null}
          {reviewsState === 'error' ? (
            <p
              role="status"
              style={{ fontSize: '13.5px', lineHeight: 1.5, opacity: 0.62, margin: 0 }}
            >
              {tx.reviewsUnavailable}
            </p>
          ) : null}
          {reviewsState === 'ready' && reviews.length === 0 ? (
            <p style={{ fontSize: '13.5px', lineHeight: 1.5, opacity: 0.62, margin: 0 }}>
              {tx.reviewsEmpty}
            </p>
          ) : null}
          {reviewsState === 'ready'
            ? reviews.map((r) => (
                <div key={r.id} style={reviewCardStyle}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.name}</span>
                    <StarDisplay
                      rating={r.rating}
                      c={c}
                      label={tx.ratingValueLabel.replace('{n}', String(r.rating))}
                    />
                  </div>
                  <p style={{ fontSize: '13.5px', lineHeight: 1.5, opacity: 0.7, margin: 0 }}>
                    {r.text}
                  </p>
                </div>
              ))
            : null}
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
            <Turnstile onToken={setTurnstileToken} resetNonce={turnstileNonce} />
          )}

          <button
            type="button"
            onClick={
              submitting || (challengeRequired && turnstileToken === '') ? undefined : onSubmitClick
            }
            disabled={submitting || (challengeRequired && turnstileToken === '')}
            style={{
              ...s.bookBtnStyle,
              opacity: submitting || (challengeRequired && turnstileToken === '') ? 0.5 : 1,
              cursor:
                submitting || (challengeRequired && turnstileToken === '') ? 'default' : 'pointer',
            }}
          >
            {tx.reviewSubmit}
          </button>
        </div>
      </div>
    </section>
  )
}
