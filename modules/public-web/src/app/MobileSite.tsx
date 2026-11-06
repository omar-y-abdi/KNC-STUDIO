import { useNativeSurface } from '../cms/NativeSurface'
import {
  mobileBrandMotion,
  mobileFold,
  mobileLayoutViewportHeight,
  paintMobileBrand,
} from './mobileFold'
import { observeMobileBrandGeometry } from './mobileBrandGeometry'
// Mobile (M3) layout — folding panel (hero <-> compact header) + booking below.
//
// Invariants:
//  - folding panel: sticky at the top of its scroll container, PANEL_FULL minus the scrolled
//    distance down to PANEL_COMPACT, borderRadius `0 0 28px 28px` once folded and flush `0` at
//    rest; the hero stays centered inside it, so its content rises at half the scroll rate.
//  - "Boka tid" from the hero folds the panel with one height tween; the scroll-driven height takes
//    over afterwards, so scrolling back up restores the hero without discarding the active booking
//    selection.
//  - the monogram changes its outline while the wordmark follows one continuous path;
//    both scroll directions use the same progress.
//  - fully faded hero controls are inert so they never steal taps from the section below.

import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { AboutSection } from '../about/AboutSection'
import { HeroLinks } from '../about/HeroLinks'
import { CornerMark } from '../ui/logos/CornerMark'
import { HomepageLogo } from '../site/HomepageLogo'
import { PrivacyManageButton } from '../site/PrivacyBanner'
import type { PrivacyControls } from '../site/usePrivacyPreferences'
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
import { EASE, PANEL_COMPACT, PANEL_FULL, useReducedMotion } from './shared'
import type { BookingContact, CustomerProfile } from '../mybookings/domain'

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
  readonly initialContact?: CustomerProfile
  readonly initialBookingContact?: BookingContact
  readonly onBookingComplete?: () => void
  readonly privacy?: PrivacyControls
  readonly onManagePrivacy?: () => void
}

const panelSelector = '[data-knc-fold="panel"]'

export function MobileSite(props: MobileSiteProps): JSX.Element {
  const { c, tx, dark, mobMutedColor, mobBtnBgColor, business } = props
  const reduceMotion = useReducedMotion()
  const view = props.view
  // Both sections live below the full hero; scrolling alone never changes the active section.
  const inSection = view === 'booking'
  const scrollRoot = useRef<HTMLDivElement>(null)
  const privacyOpen =
    props.privacy !== undefined && (props.privacy.preferences === null || props.privacy.expanded)
  const [fold, setFold] = useState(() => ({ collapse: 0, viewportHeight: window.innerHeight }))
  const { collapse, viewportHeight } = fold
  // Entering booking from the mounted hero pins the panel at PANEL_COMPACT through one height
  // tween. The pin ends when that transition ends, and the scroll-driven height takes over.
  const [entering, setEntering] = useState(false)
  const stopEntering = useRef<(() => void) | null>(null)
  const mounted = useRef(false)
  const scrollFrame = useRef<number | null>(null)
  const compactPanel = collapse > 0
  const syncCollapse = (): void => {
    const root = scrollRoot.current
    if (root === null) return
    // Leave the whole hero scrollable above an open privacy panel, then retain the normal
    // compact navigation once About begins. The spacer preserves the document position.
    const height = mobileLayoutViewportHeight(root)
    const next = mobileFold(root.scrollTop, height, privacyOpen).collapse
    setFold((current) =>
      current.collapse === next && current.viewportHeight === height
        ? current
        : { collapse: next, viewportHeight: height },
    )
  }
  const onScroll = (): void => {
    if (scrollFrame.current !== null) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null
      syncCollapse()
      // A pan during the entry tween hands the height back to the scroll position at once. A
      // fractional viewport height or a clamped offset can read back a hair below the limit, so
      // only a real pan counts.
      const root = scrollRoot.current
      if (
        stopEntering.current !== null &&
        root !== null &&
        root.scrollTop < mobileFold(Infinity, mobileLayoutViewportHeight(root)).collapse - 1
      )
        stopEntering.current()
    })
  }
  useLayoutEffect(() => {
    const root = scrollRoot.current
    if (root === null || !inSection) return
    const limit = mobileFold(Infinity, mobileLayoutViewportHeight(root)).collapse
    // A direct booking URL or a CMS booking scene mounts folded. From the mounted hero the scroll
    // position jumps now while the panel height tweens down to meet it.
    const tween = mounted.current && !reduceMotion && root.scrollTop < limit - 1
    root.scrollTop = limit
    syncCollapse()
    if (!tween) return
    const panel = root.querySelector<HTMLElement>(panelSelector)
    if (panel === null) return
    setEntering(true)
    let timer = 0
    const ended = (event: TransitionEvent): void => {
      if (event.target === panel && event.propertyName === 'height') stop()
    }
    const stop = (): void => {
      if (stopEntering.current === null) return
      stopEntering.current = null
      window.clearTimeout(timer)
      panel.removeEventListener('transitionend', ended)
      setEntering(false)
    }
    panel.addEventListener('transitionend', ended)
    // An interrupted transition never ends; drop the pin a few frames after the tween at the latest.
    timer = window.setTimeout(stop, 700)
    stopEntering.current = stop
    return stop
  }, [inSection])
  useLayoutEffect(() => {
    mounted.current = true
  }, [])
  useEffect(() => {
    const root = scrollRoot.current
    if (root === null) return
    const sync = (): void => syncCollapse()
    window.addEventListener('resize', sync)
    const observer = new ResizeObserver(onScroll)
    observer.observe(root)
    sync()
    return () => {
      window.removeEventListener('resize', sync)
      observer.disconnect()
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current)
        scrollFrame.current = null
      }
    }
  }, [inSection, privacyOpen, reduceMotion])
  const chromeIcon = props.chromeIconStyle
  // Muted, theme-aware colour for the underlined hero links (sits on the panel surface).
  const heroLinkColor = dark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.6)'
  const brandMotion = mobileBrandMotion(collapse, viewportHeight, reduceMotion)
  // While the entry tween pins the panel, its rendered height is the fold progress; otherwise the
  // resting fold state is.
  const brandCollapse = (root: HTMLElement, height: number, resting: number): number => {
    const panel =
      stopEntering.current === null ? null : root.querySelector<HTMLElement>(panelSelector)
    return panel === null
      ? resting
      : Math.min(
          mobileFold(Infinity, height).collapse,
          Math.max(0, height - panel.getBoundingClientRect().height),
        )
  }
  useLayoutEffect(() => {
    const root = scrollRoot.current
    if (!root) return
    return observeMobileBrandGeometry(root, () => {
      const height = mobileLayoutViewportHeight(root)
      paintMobileBrand(
        root,
        brandCollapse(root, height, mobileFold(root.scrollTop, height, privacyOpen).collapse),
        height,
        reduceMotion,
      )
    })
  }, [props.homepageLogo, props.homepageScale, props.mode, props.lang, privacyOpen, reduceMotion])
  useLayoutEffect(() => {
    const root = scrollRoot.current
    if (root)
      paintMobileBrand(
        root,
        brandCollapse(root, viewportHeight, collapse),
        viewportHeight,
        reduceMotion,
      )
  })
  useEffect(() => {
    const root = scrollRoot.current
    if (!entering || root === null) return
    // The morph follows the tweening panel frame by frame instead of snapping to the final fold.
    let frame = 0
    const tick = (): void => {
      const height = mobileLayoutViewportHeight(root)
      const limit = mobileFold(Infinity, height).collapse
      paintMobileBrand(root, brandCollapse(root, height, limit), height, reduceMotion)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [entering])

  const foldingPanelStyle: StyleWithVars = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'clip',
    background: dark ? '#242427' : '#f4f3f0',
    color: c.text,
    borderRadius: compactPanel ? '0 0 28px 28px' : '0',
    height: entering ? PANEL_COMPACT : `calc(${PANEL_FULL} - ${collapse}px)`,
    transition: reduceMotion
      ? 'none'
      : entering
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
  // The banner receives the moving brand before the phone and emblem rules fade in.
  // It remains decorative and never takes pointer input from the controls beneath it.
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
    opacity: brandMotion.banner,
    pointerEvents: 'none',
    transition: 'none',
  }
  const panelTopStyle: JSX.CSSProperties = {
    flex: 'none',
    padding: '0 22px 16px',
    // The surrounding panel owns pinning. An inset-free sticky header does not move, but Safari
    // still registers it as a viewport-constrained color source and can retain its old tint.
    position: 'relative',
    zIndex: 0,
    background: 'inherit',
  }
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
    overflow: 'clip',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    textAlign: 'center',
    // Bottom padding = the top row's height (safe-area + ~76px) so the centered hero block lands on
    // the screen's TRUE vertical centre instead of the centre of the area below the top row.
    padding: '0 26px calc(env(safe-area-inset-top, 0px) + 76px)',
    // Entering booking fades the whole hero with the panel tween; scroll progress fades each control.
    opacity: entering ? 0 : undefined,
    // Visible controls remain usable throughout the fade. Disabling at 24px left almost opaque
    // buttons untappable when a browser restored scroll/focus after closing the privacy notice.
    pointerEvents: brandMotion.actions === 0 ? 'none' : 'auto',
    transition: entering ? 'opacity .34s ease' : undefined,
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
    scrollMarginTop: PANEL_COMPACT,
  }

  return useNativeSurface(
    <div
      style={{
        position: 'relative',
        // Fixed viewport scroll container. Both sections retain the full hero in normal flow;
        // entering booking starts at its content, and reverse scrolling restores the hero.
        height: 'calc(100dvh - var(--privacy-overlay-space, 0px))',
        overflowX: 'hidden',
        overflowY: 'auto',
        // The entry tween shrinks the panel above a fixed scroll position while the spacer keeps
        // its height; browser scroll anchoring would otherwise follow the moving spacer and pull
        // the scroll position back up frame by frame.
        overflowAnchor: 'none',
        background: c.bg,
        color: c.text,
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
      ref={scrollRoot}
      onScroll={onScroll}
      data-testid="mobile-site-scroll"
    >
      <div
        data-knc-fold="panel"
        style={{
          ...foldingPanelStyle,
          // The hero scrolls above an open privacy panel in normal flow; otherwise the panel pins
          // to the viewport top and shrinks with the scroll position.
          position: privacyOpen && !compactPanel ? 'relative' : 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={panelTopStyle}>
          <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 30px)' }}></div>
          <div
            data-knc-fold="controls"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              marginTop: 0,
              translate: `0px ${brandMotion.controlsShift}px`,
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
                data-knc-fold="return"
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

        <div data-knc-fold="mark" style={headerMarkStyle} aria-hidden="true">
          <CornerMark height={26} />
        </div>

        <div
          data-knc-fold="hero"
          style={heroExtrasStyle}
          inert={brandMotion.brand === 0 && brandMotion.actions === 0}
        >
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
          {!inSection && props.privacy !== undefined ? (
            <PrivacyManageButton lang={props.lang} dark={dark} controls={props.privacy} />
          ) : null}
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

      {/* Keep panel + spacer at one viewport tall. At max collapse the section begins below the
          compact top panel, while reverse scrolling recreates the hero without a mode switch. */}
      <div data-knc-fold="spacer" aria-hidden="true" style={{ height: collapse + 'px' }} />
      <div data-knc-fold="body" style={m3BodyStyle}>
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
              onMyBookings={props.openMyBookings}
              popupText={props.bookingPopupText}
              business={business}
              showDirections={business.mapsHref !== ''}
              {...((props.initialContact ?? props.initialBookingContact) === undefined
                ? {}
                : { initialContact: props.initialContact ?? props.initialBookingContact })}
              {...(props.onBookingComplete ? { onBookingComplete: props.onBookingComplete } : {})}
            />
          </LazySurface>
        ) : (
          <AboutSection
            mobile
            mode={props.mode}
            lang={props.lang}
            fontScale={props.aboutScale}
            {...(props.onManagePrivacy === undefined
              ? {}
              : { onManagePrivacy: props.onManagePrivacy })}
            {...(props.initialContact === undefined
              ? {}
              : { customerPhone: props.initialContact.phone })}
          />
        )}
      </div>
    </div>,
    `mobile-${props.view}`,
    props.lang,
    props.mode,
  )
}
