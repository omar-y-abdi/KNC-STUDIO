// Root component.
// Owns state {mode, lang, view, myBookingsOpen}, the isMobile matchMedia switch, and the
// theme-color / body-background edge effect, then renders MobileSite | DesktopSite. The layout
// bodies live in their own modules; the shared chrome (toggles, palette) is built here and
// passed down so both layouts render identical controls.

import type { JSX, ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { AppStrings, Lang } from '../i18n/index'
import { appStrings } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { preloadBookingCatalog } from '../booking/adapters/barbersIndex'
import { preloadBookingFlow } from '../booking/lazyBookingFlow'
import { ABOUT_SECTION_ID } from '../about/AboutSection'
import { consumeBookingAccessLink, type BookingAccessLink } from '../mybookings/accessLink'
import { defaultMyBookingsPort } from '../mybookings/adapters/index'
import { LazyMyBookingsDialog, preloadMyBookingsDialog } from '../mybookings/lazyMyBookingsDialog'
import { canReplaceDocumentMetadata, useSiteChrome } from '../site/useSiteChrome'
import { buildBusinessStructuredData } from '../site/business'
import { formatBusinessAddress, resolveSiteText, type SiteChrome } from '../site/siteChrome'
import { paintViewport } from '../ui/paintViewport'
import { scheduleIdle } from '../ui/idle'
import { LazySurface } from '../ui/LazySurface'
import { usePrivacyPreferences } from '../site/usePrivacyPreferences'
import { PrivacyBanner } from '../site/PrivacyBanner'
import { readStoragePreferences, subscribeStoragePreferences } from '../site/storageConsent'
import { invokePublicBookingAction } from '../backend/publicBookingActions'
import { withCustomerDeviceLock } from '../mybookings/customerDeviceLock'
import type { CustomerProfile } from '../mybookings/domain'
import { previewCustomerPort } from '../cms/PreviewPorts'
import { defaultSiteChromePort } from '../site/adapters'
import type { SiteChromePort } from '../site/port'

const sourceChromePort: SiteChromePort = { load: (lang) => defaultSiteChromePort.load(lang) }
import { DesktopSite } from './DesktopSite'
import { MobileSite } from './MobileSite'
import type { Mode, View } from './shared'
import { MOBILE_MQ, chromeIcon, mobBtnBg, mobMuted, shellPalette } from './shared'

function setMeta(selector: string, content: string): void {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content)
}

function updateDocumentMetadata(chrome: SiteChrome, lang: Lang): void {
  const business = chrome.business
  const seo = business.seo[lang]
  document.documentElement.lang = lang
  document.title = seo.title
  setMeta('meta[name="robots"]', 'index, follow, max-image-preview:large')
  setMeta('meta[name="description"]', seo.description)
  setMeta('meta[property="og:site_name"]', business.name)
  setMeta('meta[property="og:title"]', seo.title)
  setMeta('meta[property="og:description"]', seo.description)
  setMeta('meta[property="og:image:alt"]', business.name)
  setMeta('meta[name="twitter:title"]', seo.title)
  setMeta('meta[name="twitter:description"]', seo.description)

  let canonicalElement = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (canonicalElement === null) {
    canonicalElement = document.createElement('link')
    canonicalElement.rel = 'canonical'
    canonicalElement.href = `${import.meta.env.VITE_SITE_URL || window.location.origin}/`
    document.head.appendChild(canonicalElement)
  }

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

export interface SitePreviewSnapshot {
  readonly mode: Mode
  readonly lang: Lang
  readonly view: View
  readonly myBookings: boolean
  readonly mobile: boolean
  readonly chrome: SiteChrome
}

export interface SitePreview {
  readonly mode: Mode
  readonly lang: Lang
  readonly view: View
  readonly myBookings: boolean
  readonly onReady: (snapshot: SitePreviewSnapshot) => void
}

function takeCustomerAccessLink(): BookingAccessLink {
  const link = consumeBookingAccessLink(window.location.href)
  if (link.code !== null || link.emailLinkCode !== undefined) {
    window.history.replaceState(window.history.state, '', link.cleanPath)
  }
  return link
}

export function App({
  preview,
}: { preview?: SitePreview; children?: ComponentChildren } = {}): JSX.Element {
  const privacy = usePrivacyPreferences()
  useEffect(() => {
    if (window.location.hash === '#privacy-preferences') privacy.openPreferences()
  }, [privacy.openPreferences])
  // Default to the device's light/dark preference (manual toggle still overrides afterwards).
  const [state, setRaw] = useState<AppState>(() => ({
    mode:
      preview?.mode ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    lang: preview?.lang ?? 'sv',
    view: preview?.view ?? (window.location.pathname === '/booking' ? 'booking' : 'home'),
    myBookingsOpen: preview?.myBookings ?? window.location.pathname === '/my-bookings',
  }))
  const setState = (u: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void =>
    setRaw((s) => ({ ...s, ...(typeof u === 'function' ? u(s) : u) }))
  useEffect(() => {
    if (!preview) return
    setRaw((current) =>
      current.mode === preview.mode &&
      current.lang === preview.lang &&
      current.view === preview.view &&
      current.myBookingsOpen === preview.myBookings
        ? current
        : {
            mode: preview.mode,
            lang: preview.lang,
            view: preview.view,
            myBookingsOpen: preview.myBookings,
          },
    )
  }, [preview?.mode, preview?.lang, preview?.view, preview?.myBookings])
  const [isMobile, setIsMobile] = useState<boolean>(() => window.matchMedia(MOBILE_MQ).matches)
  const [bookingAccess, setBookingAccess] = useState<{
    readonly token?: string
    readonly error?: 'invalid' | 'cookies_disabled' | 'system'
  }>({})
  // Source inspection must not consume credentials or mutate the owner's customer session.
  const [initialAccess] = useState(() =>
    preview ? consumeBookingAccessLink(`${window.location.origin}/`) : takeCustomerAccessLink(),
  )
  const [emailLinkCode, setEmailLinkCode] = useState<string | null | undefined>(undefined)
  const accessSequence = useRef(0)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | undefined>(undefined)
  useEffect(() => {
    if (preview) return
    const clearOptionalAccess = (): void => {
      if (readStoragePreferences()?.functional === false) {
        // Queue behind any in-flight booking, so its late receipt cannot undo a withdrawn choice.
        void withCustomerDeviceLock(() =>
          invokePublicBookingAction({ action: 'forget_device' }),
        ).catch(() => undefined)
      }
    }
    clearOptionalAccess()
    return subscribeStoragePreferences(clearOptionalAccess)
  }, [])
  useEffect(() => {
    const m = window.matchMedia(MOBILE_MQ)
    const h = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])

  useEffect(
    () =>
      scheduleIdle(() => {
        // Warm the first booking interaction without competing with first paint or opening a socket.
        preloadBookingFlow()
        preloadBookingCatalog()
      }),
    [],
  )

  useEffect(() => {
    if (preview) return
    let active = true
    const acceptLink = (link: BookingAccessLink, restoreProfile = false): void => {
      const sequence = ++accessSequence.current
      const current = (): boolean => active && sequence === accessSequence.current
      if (link.emailLinkCode !== undefined) {
        setCustomerProfile(undefined)
        setBookingAccess({})
        setEmailLinkCode(link.emailLinkCode)
        preloadMyBookingsDialog()
        setState({ myBookingsOpen: true })
        return
      }
      if (link.code === null) {
        if (restoreProfile) {
          void defaultMyBookingsPort
            .list({ accessToken: '', lang: 'sv' })
            .then((result) => {
              if (current() && result.ok) setCustomerProfile(result.profile)
            })
            .catch(() => undefined)
        }
        return
      }
      setCustomerProfile(undefined)
      setEmailLinkCode(undefined)
      if (link.direct) {
        setBookingAccess({ token: link.code })
        setState({ myBookingsOpen: true })
        return
      }
      void defaultMyBookingsPort
        .exchangeAccess(link.code)
        .then((result) => {
          if (!current()) return
          setBookingAccess(result.ok ? { token: result.accessToken } : { error: result.error })
          setState({ myBookingsOpen: true })
        })
        .catch(() => {
          if (!current()) return
          setBookingAccess({ error: 'system' })
          setState({ myBookingsOpen: true })
        })
    }
    acceptLink(initialAccess, true)
    const onHashChange = (): void => {
      const link = takeCustomerAccessLink()
      if (link.code !== null || link.emailLinkCode !== undefined) acceptLink(link)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      active = false
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  const dark = state.mode === 'dark'
  const lang = state.lang
  // Owner-editable public copy (homepage overlay + booking-popups) and size presets. Under the mock
  // this is the neutral default, so the i18n copy and 1.0× scales render unchanged.
  const { chrome, metadataReady } = useSiteChrome(lang, preview ? sourceChromePort : undefined)
  useEffect(() => {
    if (metadataReady)
      preview?.onReady({
        mode: state.mode,
        lang,
        view: state.view,
        myBookings: state.myBookingsOpen,
        mobile: isMobile,
        chrome,
      })
  }, [metadataReady, chrome, state, isMobile, preview?.onReady])
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
    if (!preview && canReplaceDocumentMetadata(metadataReady, initialStructuredData)) {
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
      document.querySelector<HTMLElement>('[data-testid="mobile-site-scroll"]')?.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  }
  const openMyBookings = (): void => {
    accessSequence.current++
    preloadMyBookingsDialog()
    setBookingAccess({})
    setEmailLinkCode(undefined)
    setState({ myBookingsOpen: true })
  }
  const closeMyBookings = (): void => {
    accessSequence.current++
    setBookingAccess({})
    setEmailLinkCode(undefined)
    setState({ myBookingsOpen: false })
  }
  const openPrivacy = (): void => privacy.openPreferences()

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
    <LazySurface
      overlay
      loadingLabel={tx.lazyMyBookingsLoading}
      errorLabel={tx.lazyMyBookingsError}
      retryLabel={tx.lazyReload}
    >
      <LazyMyBookingsDialog
        key={accessSequence.current}
        {...(preview ? { port: previewCustomerPort } : {})}
        mode={state.mode}
        lang={lang}
        onClose={closeMyBookings}
        {...(bookingAccess.token === undefined ? {} : { accessToken: bookingAccess.token })}
        {...(bookingAccess.error === undefined ? {} : { accessError: bookingAccess.error })}
        {...(emailLinkCode === undefined ? {} : { emailLinkCode })}
        onProfile={setCustomerProfile}
      />
    </LazySurface>
  ) : null

  if (isMobile) {
    return (
      <>
        <MobileSite
          privacy={privacy}
          onManagePrivacy={openPrivacy}
          mode={state.mode}
          lang={lang}
          tx={tx}
          {...(customerProfile === undefined ? {} : { initialContact: customerProfile })}
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
        {!preview && <PrivacyBanner lang={lang} dark={dark} controls={privacy} />}
      </>
    )
  }

  return (
    <>
      <DesktopSite
        privacy={privacy}
        onManagePrivacy={openPrivacy}
        mode={state.mode}
        lang={lang}
        dark={dark}
        c={c}
        business={business}
        themeToggle={themeToggle}
        langToggle={langToggle}
        chromeIconStyle={chromeIconStyle}
        tx={tx}
        {...(customerProfile === undefined ? {} : { initialContact: customerProfile })}
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
      {!preview && <PrivacyBanner lang={lang} dark={dark} controls={privacy} />}
    </>
  )
}
