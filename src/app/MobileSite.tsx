// Mobile (M3) layout — folding panel (hero <-> compact header) + booking below.
//
// Invariants:
//  - folding panel: borderRadius `0 0 28px 28px` when booking, flush `0` on homepage;
//    height PANEL_COMPACT (booking) vs PANEL_FULL (homepage).
//  - the brand cross-fades between the centered hero lockup (home flow) and the compact CornerMark
//    (absolute top-left, fades in when a section opens) — two elements, not one sliding element.
//  - faded hero (heroExtras) has pointer-events:none while booking so it never steals taps.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { CornerMark } from '../ui/logos/CornerMark'
import { HomepageLogo } from '../site/HomepageLogo'
import type { AppStrings, Lang } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { LazyBookingFlow, preloadBookingFlow } from '../booking/lazyBookingFlow'
import { preloadMyBookingsDialog } from '../mybookings/lazyMyBookingsDialog'
import { LazySurface } from '../ui/LazySurface'
import {
  scalePx,
  type BusinessSettings,
  type HomepageLogo as HomepageLogoConfig,
  type SizePreset,
} from '../site/siteChrome'
import type { Mode, ShellPalette, View } from './shared'
import { EASE, PANEL_COMPACT, PANEL_FULL } from './shared'

/** Style object that also defines CSS custom properties (`--mob-*`). Subtype of CSSProperties. */
type StyleWithVars = JSX.CSSProperties & Record<`--${string}`, string | number>

export interface MobileSiteProps {
  readonly mode: Mode
  readonly lang: Lang
  readonly tx: AppStrings
  readonly dark: boolean
  readonly c: ShellPalette
  readonly view: View
  readonly mobMutedColor: string
  readonly mobBtnBgColor: string
  readonly business: BusinessSettings
  readonly chromeIconStyle: JSX.CSSProperties
  readonly themeToggle: JSX.Element
  readonly langToggle: JSX.Element
  readonly openMobBooking: () => void
  /** Scroll the always-mounted About section into view. */
  readonly scrollToAbout: () => void
  /** Back chevron — expand the compact panel back into the home hero. */
  readonly scrollMobToHero: () => void
  /** Open the "Avbokning" (cancellation) popup. */
  readonly openCancel: () => void
  /** Open the "Mina bokningar" (my-appointments) popup. */
  readonly openMyBookings: () => void
  /** Owner-set font-size preset for the homepage editable text (opening hours / address). */
  readonly homepageScale: SizePreset
  /** Owner-managed logo replacement, bounded scale, and image treatment. */
  readonly homepageLogo: HomepageLogoConfig
  /** Owner-set font-size preset forwarded to the "Om oss" section. */
  readonly aboutScale: SizePreset
  /** Owner-edited policy + confirmation title shown in the booking popups. */
  readonly bookingPopupText: BookingPopupText
}

export function MobileSite(props: MobileSiteProps): JSX.Element {
  const { c, tx, dark, mobMutedColor, mobBtnBgColor, business } = props
  const view = props.view
  // Booking collapses immediately. On home the same panel collapses continuously as its scroll
  // container advances, exposing the always-mounted About section below.
  const inSection = view === 'booking'
  const scrollRoot = useRef<HTMLDivElement>(null)
  const [collapse, setCollapse] = useState(0)
  const scrollFrame = useRef<number | null>(null)
  const collapseLimit = (): number => Math.max(0, (scrollRoot.current?.clientHeight ?? 0) - 112)
  const compactPanel = inSection || collapse > 0
  const syncCollapse = (): void => {
    if (inSection) return
    const next = Math.min(collapseLimit(), Math.max(0, scrollRoot.current?.scrollTop ?? 0))
    setCollapse((current) => (current === next ? current : next))
  }
  const onScroll = (): void => {
    if (inSection || scrollFrame.current !== null) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null
      syncCollapse()
    })
  }
  useEffect(() => {
    const root = scrollRoot.current
    if (root === null || inSection) return
    const sync = (): void => syncCollapse()
    window.addEventListener('resize', sync)
    sync()
    return () => {
      window.removeEventListener('resize', sync)
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current)
        scrollFrame.current = null
      }
    }
  }, [inSection])
  const chromeIcon = props.chromeIconStyle
  const phoneShift = compactPanel ? '24px' : '0px'
  // Muted, theme-aware colour for the underlined hero links (sits on the panel surface).
  const heroLinkColor = dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.6)'

  const foldingPanelStyle: StyleWithVars = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: dark ? '#242427' : '#f4f3f0',
    color: c.text,
    borderRadius: compactPanel ? '0 0 28px 28px' : '0',
    height: inSection ? PANEL_COMPACT : `calc(${PANEL_FULL} - ${collapse}px)`,
    transition: inSection
      ? 'height .66s ' + EASE + ', border-radius .3s ease'
      : 'border-radius .3s ease',
    '--mob-text': c.text,
    '--mob-muted': mobMutedColor,
    '--mob-icon': c.iconF,
    '--mob-btn-bg': mobBtnBgColor,
    '--mob-border': c.line,
  }
  // Centered hero mark (home): the full B&B lockup. Fluid width so it never overflows small screens.
  // Colour follows the theme through currentColor.
  const heroLockupStyle: JSX.CSSProperties = {
    margin: '0 0 24px',
    color: 'var(--mob-text)',
    width: 'min(300px, 80vw)',
    height: 'auto',
    display: 'block',
  }
  // Compact corner mark (absolute top-left) — fades in once a section opens, mirroring the pole's
  // old placement. pointer-events:none so it never blocks the controls beneath it.
  const headerMarkStyle: JSX.CSSProperties = {
    position: 'absolute',
    zIndex: 6,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
    color: 'var(--mob-text)',
    top: 'calc(env(safe-area-inset-top, 0px) + 22px)',
    left: '22px',
    opacity: compactPanel ? 1 : 0,
    pointerEvents: 'none',
    transition: 'opacity .4s ease',
  }
  const panelTopStyle: JSX.CSSProperties = { flex: 'none', padding: '0 22px 16px' }
  const expandChevStyle: JSX.CSSProperties = {
    display: compactPanel ? 'flex' : 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    padding: 0,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    background: mobBtnBgColor,
  }
  const heroExtrasStyle: JSX.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    textAlign: 'center',
    // Bottom padding = the top row's height (safe-area + ~76px) so the centered hero block lands on
    // the screen's TRUE vertical centre instead of the centre of the area below the top row.
    padding: '0 26px calc(env(safe-area-inset-top, 0px) + 76px)',
    opacity: inSection ? 0 : Math.max(0, 1 - collapse / Math.max(1, collapseLimit() * 0.45)),
    pointerEvents: inSection || collapse > 24 ? 'none' : 'auto',
    transition: inSection ? 'opacity .34s ease' : undefined,
  }
  const heroBtnDarkStyle: JSX.CSSProperties = {
    alignSelf: 'stretch',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: c.accent,
    color: c.accentText,
    fontWeight: 600,
    fontSize: '16px',
    padding: '15px',
    borderRadius: '13px',
  }
  // Secondary hero action, stacked UNDER "Boka tid" at a smaller scale (shorter, smaller type) and a
  // softer shade so it reads as secondary. Full-width to align cleanly with the primary above it.
  const heroSecondaryBtnStyle: JSX.CSSProperties = {
    alignSelf: 'stretch',
    marginTop: '10px',
    border: '.5px solid ' + c.line,
    cursor: 'pointer',
    fontFamily: 'inherit',
    background: mobBtnBgColor,
    color: c.text,
    fontWeight: 600,
    fontSize: '14px',
    padding: '12px',
    borderRadius: '12px',
  }
  const infoBlockStyle: JSX.CSSProperties = {
    position: 'absolute',
    left: '26px',
    right: '26px',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '12px',
  }
  const m3BodyStyle: JSX.CSSProperties = {
    background: c.bg,
    color: c.text,
    minHeight: 'calc(100dvh - ' + PANEL_COMPACT + ')',
  }

  return (
    <div
      style={{
        position: 'relative',
        // Fixed viewport scroll container. Home keeps the full hero in normal flow while its sticky
        // panel compresses with scroll; booking starts with the compact panel and replaces About.
        height: '100dvh',
        overflowX: 'hidden',
        overflowY: 'auto',
        background: c.bg,
        color: c.text,
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
      ref={scrollRoot}
      onScroll={onScroll}
      data-testid="mobile-site-scroll"
    >
      <div style={{ ...foldingPanelStyle, position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={panelTopStyle}>
          <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 30px)' }}></div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              marginTop: phoneShift,
              transition: 'margin-top .6s ' + EASE,
            }}
          >
            {business.phoneTel === '' || business.phoneDisplay === '' ? (
              <span />
            ) : (
              <a
                href={`tel:${business.phoneTel}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textDecoration: 'none',
                  color: 'var(--mob-text)',
                  fontSize: '12px',
                }}
              >
                <img
                  src="/icons/phone.svg"
                  alt={tx.ariaCall}
                  style={{
                    background: 'var(--mob-btn-bg)',
                    width: '28px',
                    height: '28px',
                    padding: '7px',
                    boxSizing: 'border-box',
                    borderRadius: '50%',
                    filter: 'var(--mob-icon)',
                  }}
                />
                {business.phoneDisplay}
              </a>
            )}
            <div style="display:flex;align-items:center;gap:6px;flex:none;">
              {props.langToggle}
              {props.themeToggle}
              <button
                onClick={props.scrollMobToHero}
                style={expandChevStyle}
                title={tx.ariaBackHome}
              >
                <img
                  src="/icons/chevron.down.svg"
                  alt={tx.ariaBackHome}
                  style={{ width: '13px', height: '13px', filter: 'var(--mob-icon)' }}
                />
              </button>
            </div>
          </div>
        </div>

        <div style={headerMarkStyle} aria-hidden="true">
          <CornerMark height={26} />
        </div>

        <div style={heroExtrasStyle}>
          <h1 style={{ margin: 0, display: 'flex', justifyContent: 'center' }}>
            <HomepageLogo
              logo={props.homepageLogo}
              layout="mobile"
              height={190}
              style={heroLockupStyle}
            />
          </h1>
          <button
            onClick={props.openMobBooking}
            onPointerDown={preloadBookingFlow}
            onFocus={preloadBookingFlow}
            style={heroBtnDarkStyle}
          >
            {tx.book}
          </button>
          <button
            onClick={props.openMyBookings}
            onPointerDown={preloadMyBookingsDialog}
            onFocus={preloadMyBookingsDialog}
            style={heroSecondaryBtnStyle}
          >
            {tx.myBookings}
          </button>
          <HeroLinks
            aboutLabel={tx.aboutLink}
            cancelLabel={tx.cancelLink}
            color={heroLinkColor}
            onOpenAbout={props.scrollToAbout}
            onOpenCancel={props.openCancel}
            marginTop="16px"
          />
          <div style={infoBlockStyle}>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: scalePx(12, props.homepageScale) + 'px',
                  color: 'var(--mob-muted)',
                }}
              >
                <img
                  src="/icons/clock.svg"
                  alt=""
                  style={{ width: '13px', height: '13px', filter: 'var(--mob-icon)', opacity: 0.5 }}
                />
                {tx.hours}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: scalePx(12, props.homepageScale) + 'px',
                  color: 'var(--mob-muted)',
                }}
              >
                <img
                  src="/icons/mappin.circle.fill.svg"
                  alt=""
                  style={{ width: '13px', height: '13px', filter: 'var(--mob-icon)', opacity: 0.6 }}
                />
                {tx.addr}
              </span>
            </div>
            {business.mapsHref === '' ? null : (
              <a
                href={business.mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  textDecoration: 'none',
                  color: 'var(--mob-text)',
                  fontWeight: 600,
                  fontSize: '13px',
                  border: '1.8px solid var(--mob-border)',
                  borderRadius: '999px',
                  padding: '6px 12px',
                  opacity: 0.92,
                  whiteSpace: 'nowrap',
                  flex: 'none',
                }}
              >
                {tx.findUs}
                <img src="/icons/mappin.circle.fill.svg" alt="" style={chromeIcon} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Keep panel + spacer at one viewport tall. At max collapse About begins exactly below the
          compact top panel, while reverse scrolling recreates the hero without a mode switch. */}
      {!inSection ? <div aria-hidden="true" style={{ height: collapse + 'px' }} /> : null}
      <div style={m3BodyStyle}>
        {inSection ? (
          <LazySurface
            loadingLabel={tx.lazyBookingLoading}
            errorLabel={tx.lazyBookingError}
            retryLabel={tx.lazyReload}
            minHeight="280px"
          >
            <LazyBookingFlow
              mode={props.mode}
              defaultLang={props.lang}
              showHeader={false}
              onMyBookings={props.openMyBookings}
              popupText={props.bookingPopupText}
              business={business}
              showDirections={business.mapsHref !== ''}
            />
          </LazySurface>
        ) : (
          <AboutSection mode={props.mode} lang={props.lang} fontScale={props.aboutScale} />
        )}
      </div>
    </div>
  )
}
