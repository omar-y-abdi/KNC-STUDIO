// Root component.
// Owns state {mode, lang, view, myBookingsOpen}, the isMobile matchMedia switch, and the
// theme-color / body-background edge effect, then renders MobileSite | DesktopSite. The layout
// bodies live in their own modules; the shared chrome (toggles, palette) is built here and
// passed down so both layouts render identical controls.

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { AppStrings, Lang } from '../i18n/index'
import { appStrings } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { preloadBookingCatalog, subscribeBookingCatalog } from '../booking/adapters/barbersIndex'
import { MyBookingsDialog } from '../mybookings/MyBookingsDialog'
import { ABOUT_SECTION_ID } from '../about/AboutSection'
import { consumeBookingAccessLink } from '../mybookings/accessLink'
import { defaultMyBookingsPort } from '../mybookings/adapters/index'
import { canReplaceDocumentMetadata, useSiteChrome } from '../site/useSiteChrome'
import { buildBusinessStructuredData } from '../site/business'
import { formatBusinessAddress, resolveSiteText, type SiteChrome } from '../site/siteChrome'
import { paintViewport } from '../ui/paintViewport'
import { PrivacyBanner } from '../site/PrivacyBanner'
import { DesktopSite } from './DesktopSite'
import { MobileSite } from './MobileSite'
import type { Mode, View } from './shared'
import { MOBILE_MQ, chromeIcon, mobBtnBg, mobMuted, shellPalette } from './shared'

function setMeta(selector: string, content: string): void {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content)
}

export function updateDocumentMetadata(chrome: SiteChrome, lang: Lang): void {
  const business = chrome.business
  const seo = business.seo[lang]
  document.documentElement.lang = lang
  document.title = seo.title
  setMeta('meta[name="description"]', seo.description)
  setMeta('meta[property="og:site_name"]', business.name)
  setMeta('meta[property="og:title"]', seo.title)
  setMeta('meta[property="og:description"]', seo.description)
  setMeta('meta[property="og:image:alt"]', business.name)
  setMeta('meta[name="twitter:title"]', seo.title)
  setMeta('meta[name="twitter:description"]', seo.description)

  const canonical = document
    .querySelector<HTMLLinkElement>('link[rel="canonical"]')
    ?.getAttribute('href')
  const siteUrl = canonical?.startsWith('http')
    ? canonical.replace(/\/$/, '')
    : window.location.origin
  const jsonLd = buildBusinessStructuredData(business, chrome.facts, siteUrl)
  const structuredData = document.querySelector<HTMLScriptElement>('#business-json-ld')
  if (structuredData !== null) {
    structuredData.textContent = JSON.stringify(jsonLd).replace(/</g, '\\u003c')
  }
}

interface AppState {
  readonly mode: Mode
  readonly lang: Lang
  /** The single active site state — home / booking (drives both layouts). */
  readonly view: View
  /** Whether the "Mina bokningar" (my-appointments) popup is open. */
  readonly myBookingsOpen: boolean
}

export function App(): JSX.Element {
  // Default to the device's light/dark preference (manual toggle still overrides afterwards).
  const [state, setRaw] = useState<AppState>(() => ({
    mode: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    lang: 'sv',
    view: 'home',
    myBookingsOpen: false,
  }))
  const setState = (u: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void =>
    setRaw((s) => ({ ...s, ...(typeof u === 'function' ? u(s) : u) }))
  const [isMobile, setIsMobile] = useState<boolean>(() => window.matchMedia(MOBILE_MQ).matches)
  const [bookingAccess, setBookingAccess] = useState<{
    readonly token?: string
    readonly failed?: boolean
  }>({})
  useEffect(() => {
    const m = window.matchMedia(MOBILE_MQ)
    const h = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    preloadBookingCatalog()
    // Keep mobile's preloaded catalog current even before Booking/About mounts a data consumer.
    // Realtime invalidation starts one coalesced refresh, so opening either surface stays hot.
    return subscribeBookingCatalog(preloadBookingCatalog)
  }, [])

  useEffect(() => {
    const { code: accessCode, cleanPath, direct } = consumeBookingAccessLink(window.location.href)
    if (accessCode === null) return
    window.history.replaceState(window.history.state, '', cleanPath)
    if (direct) {
      setBookingAccess({ token: accessCode })
      setState({ myBookingsOpen: true })
      return
    }
    void defaultMyBookingsPort.exchangeAccess(accessCode).then((result) => {
      setBookingAccess(result.ok ? { token: result.accessToken } : { failed: true })
      setState({ myBookingsOpen: true })
    })
  }, [])

  const dark = state.mode === 'dark'
  const lang = state.lang
  // Owner-editable public copy (homepage overlay + booking-popups) and size presets. Under the mock
  // this is the neutral default, so the i18n copy and 1.0× scales render unchanged.
  const { chrome, metadataReady } = useSiteChrome(lang)
  const [initialStructuredData] = useState<string | null>(
    () => document.querySelector<HTMLScriptElement>('#business-json-ld')?.textContent ?? null,
  )
  const business = chrome.business
  const txBase = appStrings(lang)
  const siteText = resolveSiteText(
    chrome.text,
    lang,
    business.cancellationPolicyHours,
    business.name,
  )
  const tx: AppStrings = {
    ...txBase,
    kicker: siteText.kicker,
    hours: siteText.hours,
    addr: formatBusinessAddress(business),
  }
  const bookingPopupText: BookingPopupText = siteText
  const view = state.view
  // Booking folds the public panel; the homepage itself remains a scrollable hero + About document.
  const inSection = view === 'booking'
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

  useEffect(() => {
    if (canReplaceDocumentMetadata(metadataReady, initialStructuredData)) {
      updateDocumentMetadata(chrome, lang)
    }
  }, [chrome, initialStructuredData, lang, metadataReady])

  const setSv = (): void => setState({ lang: 'sv' })
  const setEn = (): void => setState({ lang: 'en' })
  const toggleMode = (): void => setState((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' }))
  // Desktop: booking is the only fold. Closing it restores the scrollable homepage/About document.
  const toggleDeskBooking = (): void =>
    setState((s) => ({ view: s.view === 'booking' ? 'home' : 'booking' }))
  const scrollToAbout = (): void => {
    setState({ view: 'home' })
    window.requestAnimationFrame(() => {
      document
        .getElementById(ABOUT_SECTION_ID)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  // Mobile: the hero becomes the compact header as its own scroll container advances.
  const openMobBooking = (): void => {
    setState({ view: 'booking' })
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-testid="mobile-site-scroll"]')
        ?.scrollTo({ top: 0 })
    })
  }
  const scrollMobToHero = (): void => {
    setState({ view: 'home' })
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-testid="mobile-site-scroll"]')
        ?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
  const openMyBookings = (): void => {
    setBookingAccess({})
    setState({ myBookingsOpen: true })
  }
  const closeMyBookings = (): void => {
    setBookingAccess({})
    setState({ myBookingsOpen: false })
  }

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

  const myBookingsDialog = state.myBookingsOpen ? (
    <MyBookingsDialog
      mode={state.mode}
      lang={lang}
      onClose={closeMyBookings}
      {...(bookingAccess.token === undefined ? {} : { accessToken: bookingAccess.token })}
      {...(bookingAccess.failed === undefined ? {} : { accessError: bookingAccess.failed })}
    />
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
          business={business}
          chromeIconStyle={chromeIconStyle}
          themeToggle={themeToggle}
          langToggle={langToggle}
          openMobBooking={openMobBooking}
          scrollToAbout={scrollToAbout}
          scrollMobToHero={scrollMobToHero}
          openCancel={openMyBookings}
          openMyBookings={openMyBookings}
          homepageScale={chrome.homepageScale}
          homepageLogo={chrome.homepageLogo}
          aboutScale={chrome.aboutScale}
          bookingPopupText={bookingPopupText}
        />
        {myBookingsDialog}
        <PrivacyBanner lang={lang} dark={dark} />
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
        business={business}
        themeToggle={themeToggle}
        langToggle={langToggle}
        chromeIconStyle={chromeIconStyle}
        tx={tx}
        view={view}
        toggleDeskBooking={toggleDeskBooking}
        scrollToAbout={scrollToAbout}
        findUsStyle={findUsStyle}
        openCancel={openMyBookings}
        openMyBookings={openMyBookings}
        homepageScale={chrome.homepageScale}
        homepageLogo={chrome.homepageLogo}
        aboutScale={chrome.aboutScale}
        bookingPopupText={bookingPopupText}
      />
      {myBookingsDialog}
      <PrivacyBanner lang={lang} dark={dark} />
    </>
  )
}
