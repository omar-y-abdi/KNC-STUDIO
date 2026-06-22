// Mobile (M3) layout — folding panel (hero <-> compact header) + booking below.
// Ported verbatim from index.html lines 642-709. All styles/literals unchanged.
//
// Invariants preserved exactly:
//  - folding panel: borderRadius `0 0 28px 28px` when booking, flush `0` on homepage;
//    height PANEL_COMPACT (booking) vs PANEL_FULL (homepage).
//  - "KNC STUDIO" cross-fades between heroKnc (centered hero flow) and headerKnc (absolute
//    top-left, fades in when booking) — two elements, not one sliding element.
//  - faded hero (heroExtras) has pointer-events:none while booking so it never steals taps.

import type { JSX } from 'preact'
import { BookingFlow } from '../booking/BookingFlow'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { BUSINESS } from '../config'
import { PoleLogo } from '../ui/PoleLogo'
import type { AppStrings, Lang } from '../i18n/index'
import type { Mode, ShellPalette } from './shared'
import { EASE, PANEL_COMPACT, PANEL_FULL } from './shared'

/** Style object that also defines CSS custom properties (`--mob-*`). Subtype of CSSProperties. */
type StyleWithVars = JSX.CSSProperties & Record<`--${string}`, string | number>

export interface MobileSiteProps {
  readonly mode: Mode
  readonly lang: Lang
  readonly tx: AppStrings
  readonly dark: boolean
  readonly c: ShellPalette
  readonly mob: boolean
  readonly mobMutedColor: string
  readonly mobBtnBgColor: string
  readonly mapsHref: string
  readonly chromeIconStyle: JSX.CSSProperties
  readonly themeToggle: JSX.Element
  readonly langToggle: JSX.Element
  readonly openMobBooking: () => void
  readonly closeMobBooking: () => void
  /** Open the "Avbokning" (cancellation) popup. */
  readonly openCancel: () => void
}

export function MobileSite(props: MobileSiteProps): JSX.Element {
  const { c, tx, dark, mob, mobMutedColor, mobBtnBgColor, mapsHref } = props
  const chromeIcon = props.chromeIconStyle
  const phoneShift = mob ? '24px' : '0px'
  // Muted, theme-aware colour for the underlined hero links (sits on the panel surface).
  const heroLinkColor = dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.6)'

  const foldingPanelStyle: StyleWithVars = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: dark ? '#242427' : '#f4f3f0',
    color: c.text,
    borderRadius: mob ? '0 0 28px 28px' : '0',
    height: mob ? PANEL_COMPACT : PANEL_FULL,
    transition: 'height .66s ' + EASE,
    '--mob-text': c.text,
    '--mob-muted': mobMutedColor,
    '--mob-icon': c.iconF,
    '--mob-btn-bg': mobBtnBgColor,
    '--mob-border': c.line,
  }
  const heroKncStyle: JSX.CSSProperties = {
    margin: '0 0 16px',
    fontFamily: "'SF Pro Display'",
    fontWeight: 700,
    fontSize: '22px',
    letterSpacing: '2.5px',
    color: 'var(--mob-text)',
    textAlign: 'center',
  }
  const headerKncStyle: JSX.CSSProperties = {
    position: 'absolute',
    zIndex: 6,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    whiteSpace: 'nowrap',
    fontFamily: "'SF Pro Display'",
    fontWeight: 700,
    fontSize: '16px',
    letterSpacing: '2px',
    color: 'var(--mob-text)',
    top: 'calc(env(safe-area-inset-top, 0px) + 22px)',
    left: '22px',
    opacity: mob ? 1 : 0,
    pointerEvents: 'none',
    transition: 'opacity .4s ease',
  }
  // Barber-pole logo (inline SVG, crisp on Retina — an <img>+filter is rasterized blurry by iOS
  // Safari): above the wordmark on the homepage hero; left of it in the compact booking header.
  // Colour follows the theme through currentColor.
  const heroLogoStyle: JSX.CSSProperties = {
    alignSelf: 'center',
    width: '66px',
    height: '66px',
    margin: '0 0 16px',
    color: 'var(--mob-text)',
  }
  const headerLogoStyle: JSX.CSSProperties = {
    width: '28px',
    height: '28px',
    flex: 'none',
    color: 'var(--mob-text)',
  }
  const panelTopStyle: JSX.CSSProperties = { flex: 'none', padding: '0 22px 16px' }
  const expandChevStyle: JSX.CSSProperties = {
    display: mob ? 'flex' : 'none',
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
    opacity: mob ? 0 : 1,
    pointerEvents: mob ? 'none' : 'auto',
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
        // Min-height (not fixed height) + always-scrollable so the homepage can scroll past the
        // full-height hero panel down to the booking flow and the About section below it. (Was
        // `height:100dvh; overflowY: mob ? 'auto' : 'hidden'`, which locked the homepage.)
        minHeight: '100dvh',
        overflowX: 'hidden',
        background: c.bg,
        color: c.text,
        fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
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
              <button onClick={props.closeMobBooking} style={expandChevStyle} title={tx.ariaBackHome}>
                <img
                  src="/icons/chevron.down.svg"
                  alt={tx.ariaBackHome}
                  style={{ width: '13px', height: '13px', filter: 'var(--mob-icon)' }}
                />
              </button>
            </div>
          </div>
        </div>

        <div style={headerKncStyle} aria-hidden="true">
          <PoleLogo uid="hdr" style={headerLogoStyle} />
          KNC STUDIO
        </div>

        <div style={heroExtrasStyle}>
          <PoleLogo uid="hero" style={heroLogoStyle} />
          <h1 style={heroKncStyle}>KNC STUDIO</h1>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '2.5px',
              color: 'var(--mob-muted)',
              marginBottom: '10px',
              textAlign: 'center',
            }}
          >
            {tx.kicker}
          </div>
          <h2
            style={{
              fontFamily: "'SF Pro Display'",
              fontWeight: 600,
              fontSize: '34px',
              letterSpacing: '2.5px',
              lineHeight: 1.08,
              margin: '0 0 10px',
              textAlign: 'center',
            }}
          >
            hmu
          </h2>
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.55,
              color: 'var(--mob-muted)',
              margin: '0 0 24px',
              textAlign: 'center',
            }}
          >
            for a fresh fade
          </p>
          <button onClick={props.openMobBooking} style={heroBtnDarkStyle}>
            {tx.book}
          </button>
          <HeroLinks
            aboutLabel={tx.aboutLink}
            cancelLabel={tx.cancelLink}
            color={heroLinkColor}
            onOpenCancel={props.openCancel}
            marginTop="16px"
          />
          <div style={infoBlockStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
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
                  fontSize: '12px',
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

      <div style={m3BodyStyle}>
        <BookingFlow mode={props.mode} defaultLang={props.lang} showHeader={false} />
        {/* Scroll target — the "Om oss" hero link smooth-scrolls here (hero → booking → about). */}
        <AboutSection mode={props.mode} lang={props.lang} />
      </div>
    </div>
  )
}
