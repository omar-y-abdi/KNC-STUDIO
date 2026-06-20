// Desktop (WEBB · Editorial) layout — nav + hero + collapsible booking fold + footer.
// Ported verbatim from index.html lines 712-757. All styles/literals unchanged.

import type { JSX } from 'preact'
import { BookingFlow } from '../booking/BookingFlow'
import { BUSINESS } from '../config'
import type { AppStrings } from '../i18n/index'
import type { ShellProps } from './shared'
import { EASE } from './shared'

export interface DesktopSiteProps extends ShellProps {
  readonly tx: AppStrings
  readonly deskBooking: boolean
  readonly toggleDeskBooking: () => void
  readonly findUsStyle: JSX.CSSProperties
}

export function DesktopSite(props: DesktopSiteProps): JSX.Element {
  const { c, tx, mapsHref, deskBooking } = props
  const lineColor = c.line

  const navStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '15px 30px',
    background: c.navBg,
    borderBottom: '.5px solid ' + c.line,
  }
  const heroBtnStyle: JSX.CSSProperties = deskBooking
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
  const deskFoldStyle: JSX.CSSProperties = {
    display: 'grid',
    gridTemplateRows: deskBooking ? '1fr' : '0fr',
    opacity: deskBooking ? 1 : 0,
    transition: 'grid-template-rows .58s ' + EASE + ', opacity .42s ease',
  }
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
        <h1 style="font-family: 'SF Pro Display'; font-weight: 700; letter-spacing: 2px; font-size: 20px; margin: 0">
          KNC STUDIO
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
          <div style="font-size: 13px; font-weight: 600; letter-spacing: 1.5px; opacity: .45; margin-bottom: 16px; color: inherit">
            {tx.kicker}
          </div>
          <h2 style="font-family: 'SF Pro Display'; font-weight: 600; font-size: 54px; letter-spacing: -1.5px; line-height: 1.05; margin: 0 auto 16px; max-width: 640px; color: inherit">
            hmu
          </h2>
          <p style="font-size: 18px; line-height: 1.5; opacity: .5; max-width: 500px; margin: 0 auto 32px; color: inherit">
            for a fresh fade
          </p>
          <button onClick={props.toggleDeskBooking} style={heroBtnStyle} type="button">
            {tx.book}
          </button>
        </div>
        <div style={deskFoldStyle}>
          <div style={deskFoldInnerStyle}>
            <div
              style={
                'border-top:.5px solid ' +
                lineColor +
                ';max-width:1180px;margin:0 auto;width:100%;box-sizing:border-box;'
              }
            >
              <BookingFlow mode={props.mode} defaultLang={props.lang} showHeader={false} />
            </div>
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
