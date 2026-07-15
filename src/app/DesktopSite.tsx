// Desktop (WEBB · Editorial) layout — nav + hero + collapsible booking fold + footer.

import type { JSX } from 'preact'
import { BookingFlow } from '../booking/BookingFlow'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { BUSINESS } from '../config'
import { CornerMark } from '../ui/logos/CornerMark'
import { DeskLockup } from '../ui/logos/DeskLockup'
import type { AppStrings } from '../i18n/index'
import type { ShellProps, View } from './shared'
import { EASE } from './shared'

export interface DesktopSiteProps extends ShellProps {
  readonly tx: AppStrings
  readonly view: View
  readonly toggleDeskBooking: () => void
  readonly toggleDeskAbout: () => void
  readonly findUsStyle: JSX.CSSProperties
  /** Open the "Avbokning" (cancellation) popup. */
  readonly openCancel: () => void
  /** Open the "Mina bokningar" (my-appointments) popup. */
  readonly openMyBookings: () => void
}

export function DesktopSite(props: DesktopSiteProps): JSX.Element {
  const { c, tx, mapsHref, view } = props
  // Hero stays put; each link toggles its own fold below it (same grid-rows animation for both).
  const booking = view === 'booking'
  const about = view === 'about'
  const lineColor = c.line
  // Muted, theme-aware colour for the underlined hero links (matches the booking-form muted text).
  const heroLinkColor = props.dark ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.62)'

  const navStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: '13px',
    opacity: 0.6,
    flex: 'none',
    flexWrap: 'wrap',
    gap: '8px',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: c.bg,
        color: c.text,
        fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={navStyle}>
        <h1 style={navLogoStyle}>
          <CornerMark height={30} />
        </h1>
        <div style="display:flex;align-items:center;gap:14px;font-size:13px;">
          <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={props.findUsStyle}>
            <img src="/icons/mappin.circle.fill.svg" alt="" style={props.chromeIconStyle} />
            {tx.findUs}
          </a>
          <a
            href={`tel:${BUSINESS.phoneTel}`}
            style="display:flex;align-items:center;gap:6px;opacity:.6;text-decoration:none;color:inherit;"
          >
            <img src="/icons/phone.svg" alt={tx.ariaCall} style={props.chromeIconStyle} />
            {BUSINESS.phoneDisplay}
          </a>
          {props.langToggle}
          {props.themeToggle}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style="text-align: center; padding: 74px 40px 60px; color: inherit">
          <div style={heroMarkStyle} aria-hidden="true">
            <DeskLockup height={300} />
          </div>
          <div style="font-size: 13px; font-weight: 600; letter-spacing: 1.5px; opacity: .45; margin: 0 0 30px; color: inherit">
            {tx.kicker}
          </div>
          <div style={heroActionsStyle}>
            <button onClick={props.toggleDeskBooking} style={heroBtnStyle} type="button">
              {tx.book}
            </button>
            <button onClick={props.openMyBookings} style={heroSecondaryBtnStyle} type="button">
              {tx.myBookings}
            </button>
          </div>
          <HeroLinks
            aboutLabel={tx.aboutLink}
            cancelLabel={tx.cancelLink}
            color={heroLinkColor}
            onOpenAbout={props.toggleDeskAbout}
            onOpenCancel={props.openCancel}
            marginTop="20px"
          />
        </div>
        {/* Booking fold — unchanged: same grid-rows animation, BookingFlow render path intact. */}
        <div style={foldStyle(booking)} data-testid="fold-booking">
          <div style={deskFoldInnerStyle}>
            <div
              style={
                'border-top:.5px solid ' +
                lineColor +
                ';max-width:1180px;margin:0 auto;width:100%;box-sizing:border-box;'
              }
            >
              <BookingFlow
                mode={props.mode}
                defaultLang={props.lang}
                showHeader={false}
                onMyBookings={props.openMyBookings}
              />
            </div>
          </div>
        </div>
        {/* About fold — identical animation; AboutSection brings its own border-top + max-width. */}
        <div style={foldStyle(about)} data-testid="fold-about">
          <div style={deskFoldInnerStyle}>
            <AboutSection mode={props.mode} lang={props.lang} />
          </div>
        </div>
      </div>

      <div style={footerStyle}>
        <span>{tx.hours}</span>
        <span>{tx.addr}</span>
      </div>
    </div>
  )
}
