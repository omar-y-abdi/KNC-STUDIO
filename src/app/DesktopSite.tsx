// Desktop (WEBB · Editorial) layout — nav + hero + collapsible booking fold + footer.

import type { JSX } from 'preact'
import { BookingFlow } from '../booking/BookingFlow'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { CornerMark } from '../ui/logos/CornerMark'
import { DeskLockup } from '../ui/logos/DeskLockup'
import type { AppStrings } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { scalePx, type SizePreset } from '../site/siteChrome'
import type { ShellProps, View } from './shared'
import { EASE } from './shared'

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
  /** Owner-set font-size preset forwarded to the "Om oss" section. */
  readonly aboutScale: SizePreset
  /** Owner-edited policy + confirmation title shown in the booking popups. */
  readonly bookingPopupText: BookingPopupText
}

export function DesktopSite(props: DesktopSiteProps): JSX.Element {
  const { c, tx, business, view } = props
  // Booking is the only fold. The homepage remains a normal scroll document with About below hero.
  const booking = view === 'booking'
  const lineColor = c.line
  // Muted, theme-aware colour for the underlined hero links (matches the booking-form muted text).
  const heroLinkColor = props.dark ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.62)'

  const navStyle: JSX.CSSProperties = {
    position: 'sticky',
    top: 0,
    zIndex: 10,
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
    fontSize: scalePx(13, props.homepageScale) + 'px',
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
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={navStyle}>
        <h1 style={navLogoStyle}>
          <CornerMark height={30} />
        </h1>
        <div style="display:flex;align-items:center;gap:14px;font-size:13px;">
          <a
            href={business.mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            style={props.findUsStyle}
          >
            <img src="/icons/mappin.circle.fill.svg" alt="" style={props.chromeIconStyle} />
            {tx.findUs}
          </a>
          <a
            href={`tel:${business.phoneTel}`}
            style="display:flex;align-items:center;gap:6px;opacity:.6;text-decoration:none;color:inherit;"
          >
            <img src="/icons/phone.svg" alt={tx.ariaCall} style={props.chromeIconStyle} />
            {business.phoneDisplay}
          </a>
          {props.langToggle}
          {props.themeToggle}
        </div>
      </div>

      <main>
        <div
          style={{
            minHeight: 'calc(100dvh - 61px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '74px 40px 60px',
            boxSizing: 'border-box',
            color: 'inherit',
          }}
        >
          <div style={heroMarkStyle} aria-hidden="true">
            <DeskLockup height={300} />
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
              <BookingFlow
                mode={props.mode}
                defaultLang={props.lang}
                showHeader={false}
                onMyBookings={props.openMyBookings}
                popupText={props.bookingPopupText}
                business={business}
              />
            </div>
          </div>
        </div>
        {!booking ? (
          <AboutSection mode={props.mode} lang={props.lang} fontScale={props.aboutScale} />
        ) : null}
      </main>

      <div style={footerStyle}>
        <span>{tx.hours}</span>
        <span>{tx.addr}</span>
      </div>
    </div>
  )
}
