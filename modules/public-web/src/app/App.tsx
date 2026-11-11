import { useCmsPresentation } from '../cms/NativeSurface'
import { CmsSceneContext } from '../cms/Scene'
// Root component.
// Owns state {mode, lang, view, myBookingsOpen}, the isMobile matchMedia switch, and the
// theme-color / body-background edge effect, then renders MobileSite | DesktopSite. The layout
// bodies live in their own modules; the shared chrome (toggles, palette) is built here and
// passed down so both layouts render identical controls.

import type { JSX, ComponentChildren } from 'preact'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { AppStrings, Lang } from '../i18n/index'
import { appStrings } from '../i18n/index'
import type { BookingPopupText } from '../booking/BookingFlow'
import { preloadBookingCatalog } from '../booking/adapters/barbersIndex'
import { preloadBookingFlow } from '../booking/lazyBookingFlow'
import { ABOUT_SECTION_ID } from '../about/AboutSection'
import { consumeBookingAccessLink, type BookingAccessLink } from '../mybookings/accessLink'
import { defaultMyBookingsPort } from '../mybookings/adapters/index'
import { LazyMyBookingsDialog, preloadMyBookingsDialog } from '../mybookings/lazyMyBookingsDialog'
import {
  LazyHomeScreenGuide,
  homeScreenGuideLoaded,
  loadHomeScreenGuide,
} from '../onboarding/lazyHomeScreenGuide'
import {
  forgetHomeScreenGuide,
  guideOffer,
  offersHomeScreenGuide,
  onIphone,
  type ListedBookings,
} from '../onboarding/trigger'
import { canReplaceDocumentMetadata, useSiteChrome } from '../site/useSiteChrome'
import { buildBusinessStructuredData } from '../site/business'
import { nativePublicPath } from '../site/routeMetadata'
import { formatBusinessAddress, resolveSiteText, type SiteChrome } from '../site/siteChrome'
import { paintViewport, showEdgeTints } from '../ui/paintViewport'
import { scheduleIdle } from '../ui/idle'
import { LazySurface } from '../ui/LazySurface'
import {
  SKIP_LINK_CLASS,
  focusIsWithin,
  focusQuietly,
  mainLandmark,
  viewChangeStrandsFocus,
} from '../ui/pageFocus'
import { usePrivacyPreferences } from '../site/usePrivacyPreferences'
import { PrivacyBanner } from '../site/PrivacyBanner'
import { readStoragePreferences, subscribeStoragePreferences } from '../site/storageConsent'
import { invokePublicBookingAction } from '../backend/publicBookingActions'
import { withCustomerDeviceLock } from '../mybookings/customerDeviceLock'
import type { BookingContact, CustomerProfile } from '../mybookings/domain'
import { previewCustomerPort } from '../cms/PreviewPorts'
import { defaultSiteChromePort } from '../site/adapters/index'
import type { SiteChromePort } from '../site/port'

const sourceChromePort: SiteChromePort = { load: (lang) => defaultSiteChromePort.load(lang) }
import { DesktopSite } from './DesktopSite'
import { MobileSite } from './MobileSite'
import { setMetaContent, writeLocales, writeRouteIdentity, writeRouteTexts } from './documentHead'
import {
  headDocument,
  headWrite,
  identityWrite,
  siteOriginOf,
  type HeadDocument,
  type RoutePage,
} from './routeHead'
import { viewStateForPath } from './siteHistory'
import { createSiteHistoryDriver } from './siteHistoryDriver'
import type { Mode, View } from './shared'
import {
  EASE,
  MOBILE_MQ,
  chromeIcon,
  mobBtnBg,
  mobMuted,
  ownerBusiness,
  shellPalette,
} from './shared'

/**
 * Brings the document head in step with the business settings. `headWrite` keeps the title and
 * descriptions the Worker rendered until the app changes the address itself.
 */
function updateDocumentMetadata(
  chrome: SiteChrome,
  lang: Lang,
  siteOrigin: string,
  pages: readonly RoutePage[],
  served: HeadDocument,
): void {
  const business = chrome.business
  setMetaContent(document, 'meta[property="og:site_name"]', business.name)
  setMetaContent(document, 'meta[property="og:image:alt"]', business.name)
  const path = nativePublicPath(window.location.pathname)
  const write = headWrite(path, lang, business, pages, served)
  if (write !== null) {
    writeRouteTexts(document, write.texts)
    if (write.locales !== null) writeLocales(document, write.locales)
  }

  const jsonLd = buildBusinessStructuredData(business, chrome.facts, siteOrigin)
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
  readonly chromePort?: SiteChromePort
  readonly interactive?: boolean
  readonly mode: Mode
  readonly lang: Lang
  readonly view: View
  readonly myBookings: boolean
  readonly onReady: (snapshot: SitePreviewSnapshot) => void
}

function showMobileHero(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-testid="mobile-site-scroll"]')?.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  })
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
  const privacy = usePrivacyPreferences(Boolean(preview))
  const example = useContext(CmsSceneContext)
  useEffect(() => {
    if (window.location.hash === '#privacy-preferences') privacy.openPreferences()
  }, [privacy.openPreferences])
  // Default to the device's light/dark preference (manual toggle still overrides afterwards).
  const [state, setRaw] = useState<AppState>(() => {
    const query = new URLSearchParams(window.location.search)
    const requestedMode = query.get('mode')
    const addressed = viewStateForPath(window.location.pathname, 'home')
    return {
      mode:
        preview?.mode ??
        (requestedMode === 'light' || requestedMode === 'dark'
          ? requestedMode
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'),
      lang: preview?.lang ?? (query.get('lang') === 'en' ? 'en' : 'sv'),
      view: preview?.view ?? addressed?.view ?? 'home',
      myBookingsOpen: preview?.myBookings ?? addressed?.myBookingsOpen ?? false,
    }
  })
  const stateRef = useRef(state)
  stateRef.current = state
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
  const contactSequence = useRef(0)
  const deviceContactEpoch = useRef(0)
  // The contact-hint read checks the dialog state at reply time: a customer link in the same
  // mount opens the dialog before the read starts, and its verified profile must stay.
  const myBookingsOpenRef = useRef(false)
  myBookingsOpenRef.current = state.myBookingsOpen
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | undefined>(undefined)
  const [deviceBookingContact, setDeviceBookingContact] = useState<BookingContact | undefined>(
    undefined,
  )
  const [bookingRefresh, setBookingRefresh] = useState(0)
  // Read when a confirmation closes, through a callback an earlier render may have handed out.
  const listedBookings = useRef<ListedBookings | null>(null)
  const completedBookings = useRef(bookingRefresh)
  completedBookings.current = bookingRefresh
  const [guideBookings, setGuideBookings] = useState<number | null>(null)
  // A Studio frame has no history driver: it never changes an address. `headAddress` stays null
  // until the app itself changes path or query, so a server-rendered head stays.
  const [headAddress, setHeadAddress] = useState<string | null>(null)
  const [siteHistory] = useState(() =>
    preview
      ? null
      : createSiteHistoryDriver(
          {
            location: window.location,
            history: window.history,
            document: window.performance.timeOrigin,
            setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
            clearTimeout: (id) => window.clearTimeout(id),
          },
          () => stateRef.current,
          setHeadAddress,
        ),
  )
  useEffect(() => {
    siteHistory?.follow({
      view: state.view,
      myBookingsOpen: state.myBookingsOpen,
      lang: state.lang,
    })
  }, [state.view, state.myBookingsOpen, state.lang])
  useEffect(() => {
    if (siteHistory === null) return
    const onPopState = (): void => {
      const current = stateRef.current
      const next = siteHistory.traversed(current)
      // A path that is not this shell's: the router replaces the app.
      if (next === null) return
      if (next.myBookingsOpen !== current.myBookingsOpen) {
        // The same reset as the dialog's own open and close buttons.
        accessSequence.current++
        setBookingAccess({})
        setEmailLinkCode(undefined)
        if (next.myBookingsOpen) void preloadMyBookingsDialog()
      }
      if (next.view !== current.view || next.myBookingsOpen !== current.myBookingsOpen)
        setState({ view: next.view, myBookingsOpen: next.myBookingsOpen })
      if (current.view === 'booking' && next.view === 'home') showMobileHero()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      siteHistory.dispose()
    }
  }, [])
  useEffect(() => {
    if (preview) return
    const clearOptionalAccess = (): void => {
      forgetHomeScreenGuide(() => window.localStorage, readStoragePreferences())
      if (readStoragePreferences()?.functional === false) {
        // Invalidate device hints even if consent is enabled again before their replies arrive.
        deviceContactEpoch.current++
        setDeviceBookingContact(undefined)
        // Queue behind any in-flight booking, so its late receipt cannot undo a withdrawn choice.
        void withCustomerDeviceLock(() => invokePublicBookingAction({ action: 'forget_device' }))
          .catch(() => undefined)
          .finally(() => {
            // A re-enabled tab can start another read while revocation is still queued.
            deviceContactEpoch.current++
            setDeviceBookingContact(undefined)
          })
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
        setDeviceBookingContact(undefined)
        setBookingAccess({})
        setEmailLinkCode(link.emailLinkCode)
        void preloadMyBookingsDialog()
        setState({ myBookingsOpen: true })
        return
      }
      if (link.code === null) {
        if (restoreProfile) {
          const contactRead = ++contactSequence.current
          const deviceRead = deviceContactEpoch.current
          const allowDeviceContact = readStoragePreferences()?.functional === true
          void defaultMyBookingsPort
            .list({ accessToken: '', lang: 'sv' })
            .then((result) => {
              if (current() && contactRead === contactSequence.current && result.ok) {
                setCustomerProfile(result.profile)
                setDeviceBookingContact(
                  allowDeviceContact &&
                    deviceRead === deviceContactEpoch.current &&
                    result.authority === 'device' &&
                    readStoragePreferences()?.functional === true
                    ? result.bookingContact
                    : undefined,
                )
              }
            })
            .catch(() => undefined)
        }
        return
      }
      setCustomerProfile(undefined)
      setDeviceBookingContact(undefined)
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

  useEffect(() => {
    // One device-contact read when booking is entered and one after a completed booking. A customer
    // dialog open at entry, or opened by a link before the reply, owns the session; closing it, or
    // a tab regaining focus, never re-lists.
    if (preview || state.view !== 'booking' || state.myBookingsOpen) return
    let active = true
    const accessRead = accessSequence.current
    const sequence = ++contactSequence.current
    const deviceRead = deviceContactEpoch.current
    const allowDeviceContact = readStoragePreferences()?.functional === true
    setDeviceBookingContact(undefined)
    void defaultMyBookingsPort
      .list({ accessToken: '', lang: 'sv' })
      .then((result) => {
        if (
          !active ||
          sequence !== contactSequence.current ||
          accessRead !== accessSequence.current ||
          myBookingsOpenRef.current
        )
          return
        setCustomerProfile(result.ok ? result.profile : undefined)
        setDeviceBookingContact(
          result.ok &&
            allowDeviceContact &&
            deviceRead === deviceContactEpoch.current &&
            result.authority === 'device' &&
            readStoragePreferences()?.functional === true
            ? result.bookingContact
            : undefined,
        )
        if (!result.ok) return
        const count = result.bookings.upcoming.length + result.bookings.past.length
        listedBookings.current = { after: bookingRefresh, count }
        // Fetched while the confirmation is read, so it is in when that closes.
        if (bookingRefresh > 0 && offersHomeScreenGuide(count) && onIphone(navigator.userAgent))
          void loadHomeScreenGuide()
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [state.view, bookingRefresh])

  const dark = state.mode === 'dark'
  const lang = state.lang
  // Owner-editable public copy (homepage overlay + booking-popups) and size presets. Under the mock
  // this is the neutral default, so the i18n copy and 1.0× scales render unchanged.
  const { chrome, metadataReady } = useSiteChrome(
    lang,
    preview ? (preview.chromePort ?? sourceChromePort) : undefined,
  )
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
  const [siteOrigin] = useState(() =>
    siteOriginOf(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      window.location.origin,
    ),
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
  const cmsPresentation = useCmsPresentation()
  const edgeTints = isMobile && preview === undefined
  useLayoutEffect(() => {
    const surface = document.querySelector(
      `[data-knc-surface="${isMobile ? 'mobile' : 'desktop'}-${inSection ? 'booking' : 'home'}"]`,
    )
    const header = isMobile
      ? surface?.querySelector('[data-knc-fold="panel"]')
      : surface?.firstElementChild
    const background = (element: Element | null | undefined, fallback: string): string => {
      if (!element) return fallback
      const value = getComputedStyle(element).backgroundColor
      return value === 'transparent' || value === 'rgba(0, 0, 0, 0)' ? fallback : value
    }
    const top = background(header, topBar)
    const page = isMobile && !inSection ? top : background(surface, pageBg)
    paintViewport(page, top, state.mode)
    return edgeTints
      ? showEdgeTints({
          top,
          bottom: { panel: top, section: background(surface, c.bg), document: page },
        })
      : undefined
  }, [pageBg, topBar, isMobile, inSection, state.mode, cmsPresentation, edgeTints])

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

  // Language and address identity are written at once; title and descriptions wait for the
  // business settings of that language.
  useEffect(() => {
    if (!preview) document.documentElement.lang = lang
  }, [lang])
  useEffect(() => {
    if (preview) return
    const identity = identityWrite(
      nativePublicPath(window.location.pathname),
      lang,
      siteOrigin,
      headDocument(headAddress, document.documentElement),
    )
    if (identity !== null) writeRouteIdentity(document, identity)
  }, [lang, headAddress])
  useEffect(() => {
    if (!preview && canReplaceDocumentMetadata(metadataReady, initialStructuredData)) {
      updateDocumentMetadata(
        chrome,
        lang,
        siteOrigin,
        cmsPresentation?.pages ?? [],
        headDocument(headAddress, document.documentElement),
      )
    }
  }, [chrome, initialStructuredData, lang, metadataReady, headAddress, cmsPresentation])
  // Focus moves only when the view change stranded it (its control gone or inert). Each selector
  // matches one layout; the other layout falls back to its main landmark.
  const focusedView = useRef(state.view)
  useEffect(() => {
    if (focusedView.current === state.view) return
    focusedView.current = state.view
    if (preview || !viewChangeStrandsFocus(document.activeElement, document.body, state.view))
      return
    const viewStart = document.querySelector<HTMLElement>(
      state.view === 'booking'
        ? '[data-testid="fold-booking"]'
        : '[data-testid="mobile-site-scroll"] [data-knc-fold="panel"]',
    )
    focusQuietly(viewStart ?? mainLandmark())
  }, [state.view])

  const toggleLanguage = (): void => setState((s) => ({ lang: s.lang === 'sv' ? 'en' : 'sv' }))
  const toggleMode = (): void => setState((s) => ({ mode: s.mode === 'dark' ? 'light' : 'dark' }))
  // Desktop: booking is the only fold. Closing it restores the scrollable homepage/About document.
  const toggleDeskBooking = (): void =>
    setState((s) => ({ view: s.view === 'booking' ? 'home' : 'booking' }))
  const scrollToAbout = (): void => {
    setState({ view: 'home' })
    window.requestAnimationFrame(() => {
      document.getElementById(ABOUT_SECTION_ID)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }
  // Mobile: the hero becomes the compact header as its own scroll container advances.
  const openMobBooking = (): void => {
    if (state.view !== 'booking') {
      // MobileSite folds its panel and positions the new section in its layout effect.
      setState({ view: 'booking' })
      return
    }
    // The hero was scrolled back into view above the mounted booking: return to the form.
    document
      .querySelector<HTMLElement>('[data-testid="mobile-site-scroll"] [data-knc-fold="body"]')
      ?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
  }
  const scrollMobToHero = (): void => {
    // MobileSite hides the return control once the hero is back: move its focus to the panel
    // first, so it does not fall to `body`.
    const site = document.querySelector<HTMLElement>('[data-testid="mobile-site-scroll"]')
    if (
      focusIsWithin(document.activeElement, site?.querySelector('[data-knc-fold="return"]') ?? null)
    )
      focusQuietly(site?.querySelector<HTMLElement>('[data-knc-fold="panel"]') ?? null)
    setState({ view: 'home' })
    showMobileHero()
  }
  const openMyBookings = (): void => {
    const sequence = ++accessSequence.current
    setBookingAccess({})
    setEmailLinkCode(undefined)
    // The chunk is normally resolved by the button's pointerdown/focus preload, so the dialog
    // opens without a loading surface; a rejected chunk still opens into the LazySurface error.
    void preloadMyBookingsDialog().then(() => {
      if (sequence !== accessSequence.current) return
      // A dialog opened from its button has an address of its own; one opened by a customer link
      // (acceptLink) keeps the address the link was cleaned to.
      siteHistory?.enterDialog(stateRef.current.lang)
      setState({ myBookingsOpen: true })
    })
  }
  const closeMyBookings = (): void => {
    accessSequence.current++
    setBookingAccess({})
    setEmailLinkCode(undefined)
    setState({ myBookingsOpen: false })
  }
  const onConfirmationClosed = (): void => {
    const count = guideOffer(listedBookings.current, completedBookings.current)
    // A guide arriving after the close could open over the next dialog.
    if (count !== null && homeScreenGuideLoaded()) setGuideBookings(count)
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
    transition: 'left .32s ' + EASE,
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
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={lang === 'sv' ? 'Byt språk till engelska' : 'Switch language to Swedish'}
      title={lang === 'sv' ? 'Byt språk till engelska' : 'Switch language to Swedish'}
      style={{
        ...langWrapStyle,
        border: 'none',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        data-current-lang={lang === 'sv' ? '' : undefined}
        style={svMiniStyle}
      >
        SV
      </span>
      <span
        aria-hidden="true"
        data-current-lang={lang === 'en' ? '' : undefined}
        style={enMiniStyle}
      >
        EN
      </span>
    </button>
  )
  // Outside every presentation surface, so no stored element id shifts. Its presence tells the
  // shared dialog that the main landmark may take focus (ui/pageFocus.ts).
  const skipLink = preview ? null : (
    <a
      href="#main"
      class={SKIP_LINK_CLASS}
      style={{ background: c.accent, color: c.accentText }}
      onClick={(event) => {
        event.preventDefault()
        focusQuietly(mainLandmark(), true)
      }}
    >
      {tx.skipToContent}
    </a>
  )

  const myBookingsDialog = state.myBookingsOpen ? (
    <LazySurface overlay errorLabel={tx.lazyMyBookingsError} retryLabel={tx.lazyReload}>
      <LazyMyBookingsDialog
        key={accessSequence.current}
        {...(preview ? { port: example?.customer?.port ?? previewCustomerPort } : {})}
        mode={state.mode}
        lang={lang}
        business={ownerBusiness({ chrome, metadataReady })}
        onClose={closeMyBookings}
        {...(bookingAccess.token === undefined ? {} : { accessToken: bookingAccess.token })}
        {...(bookingAccess.error === undefined ? {} : { accessError: bookingAccess.error })}
        {...(emailLinkCode === undefined ? {} : { emailLinkCode })}
        onProfile={(profile) => {
          setCustomerProfile(profile)
          setDeviceBookingContact(undefined)
        }}
      />
    </LazySurface>
  ) : null

  // The props both layouts receive.
  const shell = {
    privacy,
    onManagePrivacy: privacy.openPreferences,
    mode: state.mode,
    lang,
    tx,
    ...(customerProfile === undefined ? {} : { initialContact: customerProfile }),
    ...(deviceBookingContact === undefined ? {} : { initialBookingContact: deviceBookingContact }),
    onBookingComplete: () => setBookingRefresh((value) => value + 1),
    onConfirmationClosed,
    dark,
    c,
    view,
    business,
    chromeIconStyle,
    themeToggle,
    langToggle,
    scrollToAbout,
    openCancel: openMyBookings,
    openMyBookings,
    homepageScale: chrome.homepageScale,
    homepageLogo: chrome.homepageLogo,
    aboutScale: chrome.aboutScale,
    bookingPopupText,
  }

  return (
    <>
      {skipLink}
      {isMobile ? (
        <MobileSite
          {...shell}
          mobMutedColor={mobMutedColor}
          mobBtnBgColor={mobBtnBgColor}
          openMobBooking={openMobBooking}
          scrollMobToHero={scrollMobToHero}
        />
      ) : (
        <DesktopSite {...shell} toggleDeskBooking={toggleDeskBooking} findUsStyle={findUsStyle} />
      )}
      {myBookingsDialog}
      {(!preview || preview.interactive) && (
        <PrivacyBanner lang={lang} dark={dark} controls={privacy} />
      )}
      {guideBookings === null || state.myBookingsOpen ? null : (
        <LazyHomeScreenGuide
          key="home-screen-guide"
          mode={state.mode}
          lang={lang}
          businessName={business.name}
          bookings={guideBookings}
          onClose={() => setGuideBookings(null)}
        />
      )}
    </>
  )
}
