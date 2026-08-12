// Mobile (M3) layout — folding panel (hero <-> compact header) + booking below.
//
// Invariants:
//  - folding panel: borderRadius `0 0 28px 28px` when booking, flush `0` on homepage;
//    height PANEL_COMPACT (booking) vs PANEL_FULL (homepage).
//  - the brand cross-fades between the centered hero lockup (home flow) and the compact CornerMark
//    (absolute top-left, fades in when a section opens) — two elements, not one sliding element.
//  - faded hero (heroExtras) has pointer-events:none while booking so it never steals taps.

import type { JSX } from 'preact'
import { BookingFlow } from '../booking/BookingFlow'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { BUSINESS } from '../config'
import { CornerMark } from '../ui/logos/CornerMark'
import { HeroLockup } from '../ui/logos/HeroLockup'
import type { AppStrings, Lang } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { scalePx, type SizePreset } from '../site/siteChrome'
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
  readonly mapsHref: string
  readonly chromeIconStyle: JSX.CSSProperties
  readonly themeToggle: JSX.Element
  readonly langToggle: JSX.Element
  readonly openMobBooking: () => void
  /** Animate to the About state. */
  readonly openMobAbout: () => void
  /** Back chevron — collapse the section and return to the static home hero. */
  readonly closeMobBooking: () => void
  /** Open the "Avbokning" (cancellation) popup. */
  readonly openCancel: () => void
  /** Open the "Mina bokningar" (my-appointments) popup. */
  readonly openMyBookings: () => void
  /** Owner-set font-size preset for the homepage editable text (opening hours / address). */
  readonly homepageScale: SizePreset
  /** Owner-set font-size preset forwarded to the "Om oss" section. */
  readonly aboutScale: SizePreset
  /** Owner-edited policy + confirmation title shown in the booking popups. */
  readonly bookingPopupText: BookingPopupText
}

export function MobileSite(props: MobileSiteProps): JSX.Element {
  const { c, tx, dark, mobMutedColor, mobBtnBgColor, mapsHref } = props
  const view = props.view
  // In a section (booking or about) the panel is collapsed, content shows below, page scrolls.
  // On home the panel fills the screen and the page does NOT scroll (static, minimal hero).
  const inSection = view !== 'home'
  const chromeIcon = props.chromeIconStyle
  const phoneShift = inSection ? '24px' : '0px'
  // Muted, theme-aware colour for the underlined hero links (sits on the panel surface).
  const heroLinkColor = dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.6)'

  const foldingPanelStyle: StyleWithVars = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: dark ? '#242427' : '#f4f3f0',
    color: c.text,
    borderRadius: inSection ? '0 0 28px 28px' : '0',
    height: inSection ? PANEL_COMPACT : PANEL_FULL,
    transition: 'height .66s ' + EASE,
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
    opacity: inSection ? 1 : 0,
    pointerEvents: 'none',
    transition: 'opacity .4s ease',
  }
  const panelTopStyle: JSX.CSSProperties = { flex: 'none', padding: '0 22px 16px' }
  const expandChevStyle: JSX.CSSProperties = {
    display: inSection ? 'flex' : 'none',
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
    opacity: inSection ? 0 : 1,
    pointerEvents: inSection ? 'none' : 'auto',
    transition: 'opacity .34s ease',
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
        // Fixed full-height shell driving the home/booking/about state machine. On home the hero
        // panel fills the screen and the page does NOT scroll (overflowY hidden) — booking/about are
        // unreachable by scrolling. In a section the panel collapses and the content below scrolls.
        height: '100dvh',
        overflowX: 'hidden',
        overflowY: inSection ? 'auto' : 'hidden',
        background: c.bg,
        color: c.text,
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={foldingPanelStyle}>
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
            <a
              href={`tel:${BUSINESS.phoneTel}`}
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
              {BUSINESS.phoneDisplay}
            </a>
            <div style="display:flex;align-items:center;gap:6px;flex:none;">
              {props.langToggle}
              {props.themeToggle}
              <button
                onClick={props.closeMobBooking}
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
            <HeroLockup height={190} style={heroLockupStyle} />
          </h1>
          <button onClick={props.openMobBooking} style={heroBtnDarkStyle}>
            {tx.book}
          </button>
          <button onClick={props.openMyBookings} style={heroSecondaryBtnStyle}>
            {tx.myBookings}
          </button>
          <HeroLinks
            aboutLabel={tx.aboutLink}
            cancelLabel={tx.cancelLink}
            color={heroLinkColor}
            onOpenAbout={props.openMobAbout}
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
            <a
              href={mapsHref}
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
          </div>
        </div>
      </div>

      {/* Section content below the collapsed panel — only one is mounted, and only when not on home
          (the panel covers the swap, so conditional rendering here is smooth). */}
      {inSection ? (
        <div style={m3BodyStyle}>
          {view === 'booking' ? (
            <BookingFlow
              mode={props.mode}
              defaultLang={props.lang}
              showHeader={false}
              onMyBookings={props.openMyBookings}
              popupText={props.bookingPopupText}
            />
          ) : (
            <AboutSection mode={props.mode} lang={props.lang} fontScale={props.aboutScale} />
          )}
        </div>
      ) : null}
    </div>
  )
}
