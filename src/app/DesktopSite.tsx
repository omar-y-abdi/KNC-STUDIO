import { useNativeSurface } from '../cms/NativeSurface'
import { useContext } from 'preact/hooks'
import { PreviewPorts } from '../cms/PreviewPorts'
// Desktop (WEBB · Editorial) layout — nav + hero with business info + collapsible booking fold.

import type { JSX, RefObject } from 'preact'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { CornerMark } from '../ui/logos/CornerMark'
import { HomepageLogo } from '../site/HomepageLogo'
import { PrivacyManageButton } from '../site/PrivacyBanner'
import type { PrivacyControls } from '../site/usePrivacyPreferences'
import type { AppStrings } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { LazyBookingFlow, preloadBookingFlow } from '../booking/lazyBookingFlow'
import { preloadMyBookingsDialog } from '../mybookings/lazyMyBookingsDialog'
import { LazySurface } from '../ui/LazySurface'
import type { BookingPort } from '../booking/port'
import type { BarbersPort } from '../booking/barbersPort'
import type { ServicesPort } from '../booking/servicesPort'
import type { ReviewsPort } from '../about/reviews/port'
import type { AboutContentPort } from '../about/content/port'
import type { GalleryPort } from '../about/gallery/port'
import type { CustomerProfile } from '../mybookings/domain'
import {
  scalePx,
  type HomepageLogo as HomepageLogoConfig,
  type SizePreset,
} from '../site/siteChrome'
import type { ShellProps, View } from './shared'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { EASE, useReducedMotion } from './shared'

/** Explicit read-only seams for an embedded CMS replica; absent on the public site. */
export interface DesktopSitePreviewPorts {
  readonly booking: BookingPort
  readonly barbers: BarbersPort
  readonly services: ServicesPort
  readonly reviews: ReviewsPort
  readonly aboutContent: AboutContentPort
  readonly gallery: GalleryPort
}

const DESKTOP_PANEL_HEIGHT = 61

export interface DesktopSiteProps extends ShellProps {
  readonly tx: AppStrings
  readonly view: View
  readonly toggleDeskBooking: () => void
  readonly scrollToAbout: () => void
  readonly findUsStyle: JSX.CSSProperties
  /** Open the "Avbokning" (cancellation) popup. */
  readonly openCancel: () => void
  /** Open the "Mina bokningar" (my-appointments) popup. */
  readonly openMyBookings: () => void
  /** Owner-set font-size preset for the homepage editable text (kicker / hours / address). */
  readonly homepageScale: SizePreset
  /** Owner-managed logo replacement, bounded scale, and image treatment. */
  readonly homepageLogo: HomepageLogoConfig
  /** Owner-set font-size preset forwarded to the "Om oss" section. */
  readonly aboutScale: SizePreset
  /** Owner-edited policy + confirmation title shown in the booking popups. */
  readonly bookingPopupText: BookingPopupText
  readonly previewPorts?: DesktopSitePreviewPorts
  /** Embedded replicas scroll inside this host instead of the browser window. */
  readonly scrollRootRef?: RefObject<HTMLDivElement>
  readonly initialContact?: CustomerProfile
  readonly privacy?: PrivacyControls
  readonly onManagePrivacy?: () => void
}

export function DesktopSite(props: DesktopSiteProps): JSX.Element {
  const previewPorts = useContext(PreviewPorts)
  if (previewPorts) props = { ...props, previewPorts }

  const { c, tx, business, view } = props
  const reduceMotion = useReducedMotion()
  // Booking is the only fold. The homepage remains a normal scroll document with About below hero.
  const booking = view === 'booking'
  const bookingMounted = useRef(booking)
  const bookingFoldRef = useRef<HTMLDivElement>(null)
  const [rosterReady, setRosterReady] = useState(false)
  const onRosterReady = useCallback(() => setRosterReady(true), [])
  if (booking) bookingMounted.current = true
  useEffect(() => {
    if (!booking) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reducedMotion ? 'auto' : 'smooth'
    let lastTarget: number | null = null
    let settled = false
    let observer: ResizeObserver | null = null
    let settleRaf: number | null = null
    let settleFrames = 0
    let settleDeadline: number | null = null
    let lastLayout: { top: number; bottom: number; foldHeight: number } | null = null
    const scrollTo = (target: number, current: number, scroll: (next: number) => void): void => {
      const next = Math.max(0, target)
      if (lastTarget !== null && Math.abs(lastTarget - next) < 1 && Math.abs(current - next) < 1)
        return
      lastTarget = next
      scroll(next)
    }
    const settleWhenStable = (): void => {
      if (!rosterReady || settled || settleRaf !== null) return
      settleRaf = requestAnimationFrame(() => {
        settleRaf = null
        if (settled) return
        const fold = bookingFoldRef.current
        const step = fold?.querySelector<HTMLElement>('[data-booking-step="barber"]')
        if (fold === null || fold === undefined || step === null || step === undefined) return
        const box = step.getBoundingClientRect()
        const foldBox = fold.getBoundingClientRect()
        const stable =
          lastLayout !== null &&
          Math.abs(lastLayout.top - box.top) < 0.5 &&
          Math.abs(lastLayout.bottom - box.bottom) < 0.5 &&
          Math.abs(lastLayout.foldHeight - foldBox.height) < 0.5
        lastLayout = { top: box.top, bottom: box.bottom, foldHeight: foldBox.height }
        settleFrames = stable ? settleFrames + 1 : 0
        settleDeadline ??= window.performance.now() + 1200
        if (settleFrames >= 2 || window.performance.now() >= settleDeadline) {
          settled = true
          observer?.disconnect()
          return
        }
        settleWhenStable()
      })
    }
    const reveal = (): void => {
      const fold = bookingFoldRef.current
      if (fold === null) return
      const scrollRoot = props.scrollRootRef?.current
      const step = fold.querySelector<HTMLElement>('[data-booking-step="barber"]')
      if (scrollRoot !== undefined && scrollRoot !== null) {
        const rootBox = scrollRoot.getBoundingClientRect()
        const foldBox = fold.getBoundingClientRect()
        const stepBox = step?.getBoundingClientRect()
        const delta =
          stepBox === undefined
            ? foldBox.top - rootBox.top - DESKTOP_PANEL_HEIGHT
            : stepBox.bottom > rootBox.bottom
              ? stepBox.bottom - rootBox.bottom
              : stepBox.top < rootBox.top
                ? stepBox.top - rootBox.top
                : 0
        if (delta !== 0) {
          scrollTo(scrollRoot.scrollTop + delta, scrollRoot.scrollTop, (top) =>
            scrollRoot.scrollTo({ top, behavior }),
          )
        }
        if (step !== undefined) settleWhenStable()
        return
      }
      const foldBox = fold.getBoundingClientRect()
      const stepBox = step?.getBoundingClientRect()
      const privacySpace =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--privacy-overlay-space'),
        ) || 0
      const visibleBottom = Math.max(DESKTOP_PANEL_HEIGHT, window.innerHeight - privacySpace)
      const delta =
        stepBox === undefined
          ? foldBox.top - DESKTOP_PANEL_HEIGHT
          : stepBox.height > visibleBottom - DESKTOP_PANEL_HEIGHT ||
              stepBox.top < DESKTOP_PANEL_HEIGHT
            ? stepBox.top - DESKTOP_PANEL_HEIGHT
            : stepBox.bottom > visibleBottom
              ? stepBox.bottom - visibleBottom
              : 0
      if (delta !== 0) {
        scrollTo(window.scrollY + delta, window.scrollY, (top) =>
          window.scrollTo({ top, behavior }),
        )
      }
      if (step !== undefined) settleWhenStable()
    }
    const frame = requestAnimationFrame(reveal)
    observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!settled) reveal()
          })
    if (bookingFoldRef.current !== null) observer?.observe(bookingFoldRef.current)
    const delayed = observer === null ? window.setTimeout(reveal, 750) : null
    return () => {
      cancelAnimationFrame(frame)
      if (settleRaf !== null) cancelAnimationFrame(settleRaf)
      if (delayed !== null) window.clearTimeout(delayed)
      observer?.disconnect()
    }
  }, [booking, rosterReady, props.scrollRootRef])
  const lineColor = c.line
  // Muted, theme-aware colour for the underlined hero links (matches the booking-form muted text).
  const heroLinkColor = props.dark ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.62)'

  const navStyle: JSX.CSSProperties = {
    position: props.scrollRootRef === undefined ? 'fixed' : 'sticky',
    top: '0',
    left: 0,
    right: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    height: DESKTOP_PANEL_HEIGHT + 'px',
    padding: '15px 30px',
    background: c.navBg,
    borderBottom: '.5px solid ' + c.line,
  }
  // Nav corner brand (persistent, top-left) — the compact "BNB · BLADE & BLEND" mark.
  const navLogoStyle: JSX.CSSProperties = { margin: 0, display: 'flex', alignItems: 'center' }
  // Centered hero mark — the B&B lockup (monogram + ─ STUDIO ─ + tagline). Always visible on desktop
  // (stays put when a booking/about fold opens below).
  const heroMarkStyle: JSX.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '22px',
  }
  const heroBtnStyle: JSX.CSSProperties = booking
    ? {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: 'transparent',
        color: c.text,
        border: '1.5px solid ' + c.text,
        fontWeight: 600,
        fontSize: '15px',
        padding: '11.5px 26.5px',
        borderRadius: '11px',
      }
    : {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: c.accent,
        color: c.accentText,
        fontWeight: 600,
        fontSize: '15px',
        padding: '13px 28px',
        borderRadius: '11px',
      }
  // The two hero actions sit on one centered row (same scale). "Mina bokningar" is a softer,
  // lower-emphasis variant — a slightly different shade than the filled "Boka tid" — so it reads as
  // the secondary action without competing. Wraps (never overflows) if the viewport is unusually narrow.
  const heroActionsStyle: JSX.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  }
  const heroSecondaryBtnStyle: JSX.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: c.navBg,
    color: c.text,
    border: '.5px solid ' + c.line,
    fontWeight: 600,
    fontSize: '15px',
    padding: '13px 28px',
    borderRadius: '11px',
  }
  // One fold per state — both always mounted, each collapsed to 0fr unless active. Keeping both
  // mounted means open AND close animate smoothly (no content unmounting mid-collapse), and the
  // booking fold's render path is byte-identical to before.
  const foldStyle = (open: boolean): JSX.CSSProperties => ({
    display: 'grid',
    gridTemplateRows: open ? '1fr' : '0fr',
    opacity: open ? 1 : 0,
    transition: reduceMotion ? 'none' : 'grid-template-rows .58s ' + EASE + ', opacity .42s ease',
  })
  const deskFoldInnerStyle: JSX.CSSProperties = { overflow: 'hidden', minHeight: 0 }
  const heroInfoStyle: JSX.CSSProperties = {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 40px',
    borderTop: '.5px solid ' + c.line,
    background: c.footer,
    fontSize: scalePx(13, props.homepageScale) + 'px',
    opacity: 0.65,
    flex: 'none',
    flexWrap: 'wrap',
    gap: '8px',
  }

  return useNativeSurface(
    <div
      style={{
        position: props.scrollRootRef === undefined ? undefined : 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: c.bg,
        color: c.text,
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
        paddingBottom: 'var(--privacy-overlay-space, 0px)',
      }}
    >
      <div style={navStyle} data-testid="desktop-top-panel" data-scroll-progress="1.000">
        <h1 style={navLogoStyle}>
          <CornerMark height={30} />
        </h1>
        <div style="display:flex;align-items:center;gap:14px;font-size:13px;">
          {business.mapsHref === '' ? null : (
            <a
              href={business.mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              style={props.findUsStyle}
            >
              <img src="/icons/mappin.circle.fill.svg" alt="" style={props.chromeIconStyle} />
              {tx.findUs}
            </a>
          )}
          {business.phoneTel === '' || business.phoneDisplay === '' ? null : (
            <a
              href={`tel:${business.phoneTel}`}
              style="display:flex;align-items:center;gap:6px;opacity:.6;text-decoration:none;color:inherit;"
            >
              <img src="/icons/phone.svg" alt={tx.ariaCall} style={props.chromeIconStyle} />
              {business.phoneDisplay}
            </a>
          )}
          {props.langToggle}
          {props.themeToggle}
        </div>
      </div>

      <main>
        <div
          style={{
            position: 'relative',
            minHeight: booking ? 'auto' : '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: booking ? '100px 40px 60px' : '60px 40px 120px',
            boxSizing: 'border-box',
            color: 'inherit',
          }}
        >
          <div style={heroMarkStyle} aria-hidden="true">
            <HomepageLogo logo={props.homepageLogo} layout="desktop" height={300} />
          </div>
          <div
            style={{
              fontSize: scalePx(13, props.homepageScale) + 'px',
              fontWeight: 600,
              letterSpacing: '1.5px',
              opacity: 0.65,
              margin: '0 0 30px',
              color: 'inherit',
            }}
          >
            {tx.kicker}
          </div>
          <div style={heroActionsStyle}>
            <button
              onClick={props.toggleDeskBooking}
              onPointerDown={preloadBookingFlow}
              onFocus={preloadBookingFlow}
              style={heroBtnStyle}
              type="button"
            >
              {tx.book}
            </button>
            <button
              onClick={props.openMyBookings}
              onPointerDown={preloadMyBookingsDialog}
              onFocus={preloadMyBookingsDialog}
              style={heroSecondaryBtnStyle}
              type="button"
            >
              {tx.myBookings}
            </button>
          </div>
          <HeroLinks
            aboutLabel={tx.aboutLink}
            cancelLabel={tx.cancelLink}
            color={heroLinkColor}
            onOpenAbout={props.scrollToAbout}
            onOpenCancel={props.openCancel}
            marginTop="20px"
          />
          {!booking && props.privacy !== undefined ? (
            <PrivacyManageButton lang={props.lang} dark={props.dark} controls={props.privacy} />
          ) : null}
          <div style={heroInfoStyle}>
            <span>{tx.hours}</span>
            <span>{tx.addr}</span>
          </div>
        </div>
        {/* Booking fold — unchanged render path. While open, About is absent rather than hidden. */}
        <div
          ref={bookingFoldRef}
          style={{ ...foldStyle(booking), scrollMarginTop: DESKTOP_PANEL_HEIGHT + 'px' }}
          data-testid="fold-booking"
          inert={!booking}
          aria-hidden={booking ? undefined : 'true'}
        >
          <div style={deskFoldInnerStyle}>
            <div
              style={
                'border-top:.5px solid ' +
                lineColor +
                ';max-width:1180px;margin:0 auto;width:100%;box-sizing:border-box;'
              }
            >
              {bookingMounted.current ? (
                <LazySurface
                  loadingLabel={tx.lazyBookingLoading}
                  errorLabel={tx.lazyBookingError}
                  retryLabel={tx.lazyReload}
                  minHeight="280px"
                >
                  <LazyBookingFlow
                    mode={props.mode}
                    defaultLang={props.lang}
                    onMyBookings={props.openMyBookings}
                    onRosterReady={onRosterReady}
                    popupText={props.bookingPopupText}
                    business={business}
                    showDirections={business.mapsHref !== ''}
                    {...(props.initialContact === undefined
                      ? {}
                      : { initialContact: props.initialContact })}
                    {...(props.previewPorts === undefined
                      ? {}
                      : {
                          port: props.previewPorts.booking,
                          barbersPort: props.previewPorts.barbers,
                          servicesPort: props.previewPorts.services,
                        })}
                  />
                </LazySurface>
              ) : null}
            </div>
          </div>
        </div>
        {!booking ? (
          <AboutSection
            mode={props.mode}
            lang={props.lang}
            {...(props.initialContact === undefined
              ? {}
              : { customerPhone: props.initialContact.phone })}
            fontScale={props.aboutScale}
            scrollMarginTop={DESKTOP_PANEL_HEIGHT + 'px'}
            {...(props.onManagePrivacy === undefined
              ? {}
              : { onManagePrivacy: props.onManagePrivacy })}
            {...(props.previewPorts === undefined
              ? {}
              : {
                  port: props.previewPorts.reviews,
                  barbersPort: props.previewPorts.barbers,
                  aboutContentPort: props.previewPorts.aboutContent,
                  galleryPort: props.previewPorts.gallery,
                  challengeEnabled: false,
                })}
          />
        ) : null}
      </main>
    </div>,
    `desktop-${props.view}`,
    props.lang,
    props.mode,
  )
}
