// Desktop (WEBB · Editorial) layout — nav + hero + collapsible booking fold + footer.

import type { JSX, RefObject } from 'preact'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { CornerMark } from '../ui/logos/CornerMark'
import { HomepageLogo } from '../site/HomepageLogo'
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
import {
  scalePx,
  type HomepageLogo as HomepageLogoConfig,
  type SizePreset,
} from '../site/siteChrome'
import type { ShellProps, View } from './shared'
import { useEffect, useRef } from 'preact/hooks'
import { EASE } from './shared'

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
}

export function DesktopSite(props: DesktopSiteProps): JSX.Element {
  const { c, tx, business, view } = props
  // Booking is the only fold. The homepage remains a normal scroll document with About below hero.
  const booking = view === 'booking'
  // At home the existing chrome travels from the lower edge of the hero to the compact top panel.
  // The document remains the scroll source so wheel, keyboard and browser navigation keep their
  // expected desktop behaviour; only the panel's position is tied to scroll progress.
  const panelRef = useRef<HTMLDivElement>(null)
  const bookingMounted = useRef(booking)
  if (booking) bookingMounted.current = true
  useEffect(() => {
    let frame = 0
    const sync = (): void => {
      frame = 0
      const panel = panelRef.current
      if (panel === null) return
      if (booking) {
        panel.style.setProperty(
          '--desktop-panel-top',
          (props.scrollRootRef?.current?.scrollTop ?? 0) + 'px',
        )
        panel.dataset['scrollProgress'] = '1.000'
        return
      }
      const scrollRoot = props.scrollRootRef?.current
      const scrollTop = scrollRoot?.scrollTop ?? window.scrollY
      const viewportHeight = scrollRoot?.clientHeight ?? window.innerHeight
      const travel = Math.max(1, viewportHeight - DESKTOP_PANEL_HEIGHT)
      const progress = Math.min(1, Math.max(0, scrollTop / travel))
      const visualTop = Math.round((1 - progress) * travel)
      panel.style.setProperty(
        '--desktop-panel-top',
        (scrollRoot === undefined ? visualTop : scrollTop + visualTop) + 'px',
      )
      panel.dataset['scrollProgress'] = progress.toFixed(3)
    }
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(sync)
    }
    const scrollTarget = props.scrollRootRef?.current ?? window
    scrollTarget.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    sync()
    return () => {
      scrollTarget.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [booking, props.scrollRootRef])
  const lineColor = c.line
  // Muted, theme-aware colour for the underlined hero links (matches the booking-form muted text).
  const heroLinkColor = props.dark ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.62)'

  const navStyle: JSX.CSSProperties = {
    position: props.scrollRootRef === undefined ? 'fixed' : 'absolute',
    top: 'var(--desktop-panel-top, calc(100dvh - 61px))',
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
    transition: 'grid-template-rows .58s ' + EASE + ', opacity .42s ease',
  })
  const deskFoldInnerStyle: JSX.CSSProperties = { overflow: 'hidden', minHeight: 0 }
  const footerStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 40px',
    borderTop: '.5px solid ' + c.line,
    background: c.footer,
    fontSize: scalePx(13, props.homepageScale) + 'px',
    opacity: 0.6,
    flex: 'none',
    flexWrap: 'wrap',
    gap: '8px',
  }

  return (
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
      }}
    >
      <div
        style={navStyle}
        data-testid="desktop-top-panel"
        data-scroll-progress={booking ? '1.000' : '0.000'}
        ref={panelRef}
      >
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
            minHeight: '100dvh',
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
              opacity: 0.45,
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
        </div>
        {/* Booking fold — unchanged render path. While open, About is absent rather than hidden. */}
        <div style={foldStyle(booking)} data-testid="fold-booking">
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
                    popupText={props.bookingPopupText}
                    business={business}
                    showDirections={business.mapsHref !== ''}
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
            fontScale={props.aboutScale}
            scrollMarginTop={DESKTOP_PANEL_HEIGHT + 'px'}
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

      <div style={footerStyle}>
        <span>{tx.hours}</span>
        <span>{tx.addr}</span>
      </div>
    </div>
  )
}
