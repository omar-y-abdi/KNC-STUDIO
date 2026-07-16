// Root component.
// Owns state {mode, lang, view, cancelOpen}, the isMobile matchMedia switch, and the
// theme-color / body-background edge effect, then renders MobileSite | DesktopSite. The layout
// bodies live in their own modules; the shared chrome (toggles, palette) is built here and
// passed down so both layouts render identical controls.

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { BUSINESS } from '../config'
import type { AppStrings, Lang } from '../i18n/index'
import { appStrings } from '../i18n/index'
import { CancellationDialog } from '../cancellation/CancellationDialog'
import { MyBookingsDialog } from '../mybookings/MyBookingsDialog'
import { useSiteChrome } from '../site/useSiteChrome'
import { paintViewport } from '../ui/paintViewport'
import { DesktopSite } from './DesktopSite'
import { MobileSite } from './MobileSite'
import type { Mode, View } from './shared'
import { MOBILE_MQ, chromeIcon, mobBtnBg, mobMuted, shellPalette } from './shared'

interface AppState {
  readonly mode: Mode
  readonly lang: Lang
  /** The single active site state — home / booking / about (drives both layouts). */
  readonly view: View
  /** Whether the "Avbokning" (cancellation) popup is open. Lives here alongside the view folds. */
  readonly cancelOpen: boolean
  /** Whether the "Mina bokningar" (my-appointments) popup is open. */
  readonly myBookingsOpen: boolean
}

export function App(): JSX.Element {
  // Default to the device's light/dark preference (manual toggle still overrides afterwards).
  const [state, setRaw] = useState<AppState>(() => ({
    mode: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    lang: 'sv',
    view: 'home',
    cancelOpen: false,
    myBookingsOpen: false,
  }))
  const setState = (u: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void =>
    setRaw((s) => ({ ...s, ...(typeof u === 'function' ? u(s) : u) }))
  const [isMobile, setIsMobile] = useState<boolean>(() => window.matchMedia(MOBILE_MQ).matches)
  useEffect(() => {
    const m = window.matchMedia(MOBILE_MQ)
    const h = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])

  const dark = state.mode === 'dark'
  const lang = state.lang
  // Owner-editable homepage chrome (text overlay + font-size presets). Under the mock this is the
  // neutral default, so `tx` === the i18n copy and both scales are 1.0× — byte-identical to before.
  const chrome = useSiteChrome(lang)
  const txBase = appStrings(lang)
  const tx: AppStrings = {
    ...txBase,
    kicker: chrome.text.kicker ?? txBase.kicker,
    hours: chrome.text.hours ?? txBase.hours,
    addr: chrome.text.addr ?? txBase.addr,
  }
  const view = state.view
  // "In a section" = booking or about is open (panel collapsed, content below). Home = static hero.
  const inSection = view !== 'home'
  const c = shellPalette(dark)
  const mobMutedColor = mobMuted(dark)
  const mobBtnBgColor = mobBtnBg(dark)

  // Two different surfaces meet the screen edges:
  //  - topBar (theme-color): the top header/notch area. CONSTANT per mode.
  //  - pageBg (html/body, behind the bottom URL bar): follows the content BELOW the header.
  const topBar = isMobile ? (dark ? '#242427' : '#f4f3f0') : c.bg
  const pageBg = isMobile ? (inSection ? c.bg : dark ? '#242427' : '#f4f3f0') : c.bg
  useEffect(() => {
    paintViewport(pageBg, topBar)
  }, [pageBg, topBar])

  const langMini = (on: boolean): JSX.CSSProperties => ({
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '.3px',
    padding: '4px 9px',
    borderRadius: '999px',
    background: on ? (dark ? '#f5f5f7' : '#1c1c1e') : 'transparent',
    color: on ? (dark ? '#1c1c1e' : '#fff') : dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)',
  })

  const mapsHref = BUSINESS.mapsHref
  const setSv = (): void => setState({ lang: 'sv' })
  const setEn = (): void => setState({ lang: 'en' })
  const toggleMode = (): void => setState((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' }))
  // Desktop: the hero stays; "Boka tid"/"Om oss" each toggle their own fold open/closed.
  const toggleDeskBooking = (): void =>
    setState((s) => ({ view: s.view === 'booking' ? 'home' : 'booking' }))
  const toggleDeskAbout = (): void =>
    setState((s) => ({ view: s.view === 'about' ? 'home' : 'about' }))
  // Mobile: the hero collapses to a compact header; open booking/about, the back chevron returns home.
  const openMobBooking = (): void => setState({ view: 'booking' })
  const openMobAbout = (): void => setState({ view: 'about' })
  const closeMobBooking = (): void => setState({ view: 'home' })
  const openCancel = (): void => setState({ cancelOpen: true })
  const closeCancel = (): void => setState({ cancelOpen: false })
  const openMyBookings = (): void => setState({ myBookingsOpen: true })
  const closeMyBookings = (): void => setState({ myBookingsOpen: false })

  // --- shared chrome (nav controls) ---
  const chromeIconStyle = chromeIcon(dark)
  const findUsStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 14px',
    borderRadius: '999px',
    border: '.5px solid ' + (dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.16)'),
    color: c.text,
    textDecoration: 'none',
    fontWeight: 600,
    opacity: 0.92,
  }
  const themeTrackStyle: JSX.CSSProperties = {
    position: 'relative',
    width: '54px',
    height: '30px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flex: 'none',
    background: dark ? 'rgba(120,120,128,.42)' : 'rgba(120,120,128,.26)',
  }
  const themeKnobStyle: JSX.CSSProperties = {
    position: 'absolute',
    top: '3px',
    left: dark ? '27px' : '3px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(0,0,0,.3)',
    transition: 'left .32s ' + 'cubic-bezier(.32,.72,0,1)',
  }
  const themeKnobIconStyle: JSX.CSSProperties = { width: '14px', height: '14px', opacity: 0.92 }
  // Split into two full literals (rather than a computed `[dark?'left':'right']` key) so the
  // typing stays clean — the same single side property is set either way.
  const themeTrackIconStyle: JSX.CSSProperties = dark
    ? {
        position: 'absolute',
        top: '8px',
        left: '9px',
        width: '14px',
        height: '14px',
        opacity: 0.5,
        filter: 'invert(1)',
      }
    : {
        position: 'absolute',
        top: '8px',
        right: '9px',
        width: '14px',
        height: '14px',
        opacity: 0.5,
        filter: 'none',
      }
  const themeKnobIconSrc = dark ? '/icons/moon.svg' : '/icons/sun.max.svg'
  const themeTrackIconSrc = dark ? '/icons/sun.max.svg' : '/icons/moon.svg'
  const langWrapStyle: JSX.CSSProperties = {
    display: 'flex',
    background: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
    borderRadius: '999px',
    padding: '2px',
    flex: 'none',
  }
  const svMiniStyle = langMini(lang === 'sv')
  const enMiniStyle = langMini(lang === 'en')

  const themeToggle = (
    <button
      onClick={toggleMode}
      style={themeTrackStyle}
      title={tx.ariaTheme}
      aria-label={tx.ariaTheme}
    >
      <img src={themeTrackIconSrc} alt="" style={themeTrackIconStyle} />
      <span style={themeKnobStyle}>
        <img src={themeKnobIconSrc} alt="" style={themeKnobIconStyle} />
      </span>
    </button>
  )
  const langToggle = (
    <div style={langWrapStyle}>
      <button onClick={setSv} aria-pressed={lang === 'sv'} style={svMiniStyle}>
        SV
      </button>
      <button onClick={setEn} aria-pressed={lang === 'en'} style={enMiniStyle}>
        EN
      </button>
    </div>
  )

  const cancelDialog = state.cancelOpen ? (
    <CancellationDialog mode={state.mode} lang={lang} onClose={closeCancel} />
  ) : null
  const myBookingsDialog = state.myBookingsOpen ? (
    <MyBookingsDialog mode={state.mode} lang={lang} onClose={closeMyBookings} />
  ) : null

  if (isMobile) {
    return (
      <>
        <MobileSite
          mode={state.mode}
          lang={lang}
          tx={tx}
          dark={dark}
          c={c}
          view={view}
          mobMutedColor={mobMutedColor}
          mobBtnBgColor={mobBtnBgColor}
          mapsHref={mapsHref}
          chromeIconStyle={chromeIconStyle}
          themeToggle={themeToggle}
          langToggle={langToggle}
          openMobBooking={openMobBooking}
          openMobAbout={openMobAbout}
          closeMobBooking={closeMobBooking}
          openCancel={openCancel}
          openMyBookings={openMyBookings}
          homepageScale={chrome.homepageScale}
          aboutScale={chrome.aboutScale}
        />
        {cancelDialog}
        {myBookingsDialog}
      </>
    )
  }

  return (
    <>
      <DesktopSite
        mode={state.mode}
        lang={lang}
        dark={dark}
        c={c}
        mapsHref={mapsHref}
        themeToggle={themeToggle}
        langToggle={langToggle}
        chromeIconStyle={chromeIconStyle}
        tx={tx}
        view={view}
        toggleDeskBooking={toggleDeskBooking}
        toggleDeskAbout={toggleDeskAbout}
        findUsStyle={findUsStyle}
        openCancel={openCancel}
        openMyBookings={openMyBookings}
        homepageScale={chrome.homepageScale}
        aboutScale={chrome.aboutScale}
      />
      {cancelDialog}
      {myBookingsDialog}
    </>
  )
}
