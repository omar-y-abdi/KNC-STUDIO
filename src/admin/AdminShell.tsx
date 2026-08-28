// The admin shell: left nav (tabs) + a content area and one clean top bar. Role drives the nav: a
// barber sees operational tabs plus Settings; the owner sees those PLUS {Alla bokningar, Barberare,
// Om oss} and a barber selector to act on any barber.
//
// Identity is kept human: a barber sees just their first name in the top bar — they
// know their own email and job title. The owner instead sees the barber selector (in the controls
// row, leftmost), which is the only context that actually matters when acting for someone else.
//
// Chrome matches the public site: the brand is the pole logo + tracked wordmark, the theme control
// is the site's original track/knob switch (ThemeSwitch), and the language toggle is the same mini
// pill pair the site nav uses.
//
// Fully responsive: on narrow screens the sidebar becomes a compact header with the public site's
// circular down-chevron. It opens a small vertical tab menu instead of forcing a horizontal strip.
// The top bar scrolls with the page instead of stacking under the sticky header. All controls are
// buttons (keyboard-operable); the active tab is `aria-current`.

import type { JSX } from 'preact'
import { lazy, Suspense } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import { palette } from '../booking/bookingStyles'
import { PoleLogo } from '../ui/PoleLogo'
import { buildAdminStyles } from './adminStyles'
import { LangSwitch, ThemeSwitch } from './chrome'
import { ScheduleView } from './views/ScheduleView'
import { useBarbers } from './useBarbers'
import {
  adminUrlForTab,
  persistAdminScroll,
  readAdminScroll,
  restoreAdminScrollPosition,
  tabFromAdminUrl,
  withAdminNavigationHistoryState,
} from './navigationState'
import type { AdminBarberId, AdminProfile } from './types'

const BookingsView = lazy(() =>
  import('./views/BookingsView').then((module) => ({ default: module.BookingsView })),
)
const BarbersView = lazy(() =>
  import('./views/BarbersView').then((module) => ({ default: module.BarbersView })),
)
const ServicesView = lazy(() =>
  import('./views/ServicesView').then((module) => ({ default: module.ServicesView })),
)
const ProfileView = lazy(() =>
  import('./views/ProfileView').then((module) => ({ default: module.ProfileView })),
)
const SiteView = lazy(() =>
  import('./views/SiteView').then((module) => ({ default: module.SiteView })),
)
const AboutView = lazy(() =>
  import('./views/AboutView').then((module) => ({ default: module.AboutView })),
)
const SettingsView = lazy(() =>
  import('./views/SettingsView').then((module) => ({ default: module.SettingsView })),
)
const MailView = lazy(() =>
  import('./views/MailView').then((module) => ({ default: module.MailView })),
)

export interface AdminShellProps {
  readonly profile: AdminProfile
  readonly dark: boolean
  readonly lang: Lang
  readonly toggleMode: () => void
  readonly setLang: (lang: Lang) => void
  readonly onSignOut: () => void
}

/** The tabs a barber can see; the owner gets all of them. */
type Tab =
  | 'bookings'
  | 'schedule'
  | 'services'
  | 'profile'
  | 'allBookings'
  | 'barbers'
  | 'site'
  | 'about'
  | 'settings'
  | 'mail'

interface TabDef {
  readonly id: Tab
  readonly label: string
  readonly ownerOnly: boolean
}

export function AdminShell(props: AdminShellProps): JSX.Element {
  const { profile } = props
  const isOwner = profile.role === 'owner'
  const c = palette(props.dark)
  const s = buildAdminStyles(c, props.dark)
  const t = adminText(props.lang)

  const TABS: readonly TabDef[] = [
    { id: 'schedule', label: t.tabSchedule, ownerOnly: false },
    { id: 'bookings', label: t.tabBookings, ownerOnly: false },
    { id: 'services', label: t.tabServices, ownerOnly: false },
    { id: 'profile', label: t.tabProfile, ownerOnly: false },
    { id: 'allBookings', label: t.tabAllBookings, ownerOnly: true },
    { id: 'barbers', label: t.tabBarbers, ownerOnly: true },
    { id: 'site', label: t.tabSite, ownerOnly: true },
    { id: 'about', label: t.tabAbout, ownerOnly: true },
    { id: 'mail', label: t.tabMail, ownerOnly: true },
    { id: 'settings', label: t.tabSettings, ownerOnly: false },
  ]

  const visibleTabs = TABS.filter((tab) => isOwner || !tab.ownerOnly)
  const visibleTabIds = useMemo(() => visibleTabs.map((entry) => entry.id), [isOwner, props.lang])
  // Schedule first: managing today's availability is the barber's most frequent task.
  const [tab, setTab] = useState<Tab>(() =>
    tabFromAdminUrl(window.location.href, visibleTabIds, 'schedule'),
  )
  const scrollCaptureGeneration = useRef(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scheduleBlocked, setScheduleBlocked] = useState(false)
  const navigationLocked = tab === 'schedule' && scheduleBlocked

  const persistScroll = (tabToPersist: Tab, scrollY: number = window.scrollY): void => {
    const value = Math.max(0, Math.round(scrollY))
    persistAdminScroll(sessionStorage, profile.userId, tabToPersist, value)
    window.history.replaceState(
      withAdminNavigationHistoryState(window.history.state, {
        userId: profile.userId,
        tab: tabToPersist,
        scrollY: value,
      }),
      '',
      adminUrlForTab(window.location.href, tabToPersist),
    )
  }

  const selectTab = (nextTab: Tab): void => {
    if (nextTab === tab) return
    persistScroll(tab)
    scrollCaptureGeneration.current += 1
    window.history.pushState(
      withAdminNavigationHistoryState(window.history.state, {
        userId: profile.userId,
        tab: nextTab,
        scrollY: 0,
      }),
      '',
      adminUrlForTab(window.location.href, nextTab),
    )
    setTab(nextTab)
    // Destination restoration owns the scroll. Scrolling here races the outgoing tab listener and
    // can overwrite its saved position with zero before that effect cleans up.
  }

  useEffect(() => {
    if (!navigationLocked) return
    const preventLeave = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventLeave)
    return () => window.removeEventListener('beforeunload', preventLeave)
  }, [navigationLocked])

  useEffect(() => {
    let frame: number | null = null
    const generation = ++scrollCaptureGeneration.current
    // Preserve a matching browser/session scroll snapshot until the restore effect can reach it.
    // Writing the current initial `window.scrollY` here would overwrite the only reload evidence.
    const initialScrollY = readAdminScroll(
      window.history.state,
      sessionStorage,
      profile.userId,
      tab,
    )
    const capture = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (scrollCaptureGeneration.current === generation) persistScroll(tab)
      })
    }
    const flush = (): void => {
      if (scrollCaptureGeneration.current === generation) persistScroll(tab)
    }
    // Initialise an addressable history entry so reload and share preserve the active admin tab.
    persistScroll(tab, initialScrollY)
    window.addEventListener('scroll', capture, { passive: true })
    window.addEventListener('pagehide', flush)
    return () => {
      if (scrollCaptureGeneration.current === generation) scrollCaptureGeneration.current += 1
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', capture)
      window.removeEventListener('pagehide', flush)
    }
  }, [profile.userId, tab])

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  useEffect(() => {
    const restoreY = readAdminScroll(window.history.state, sessionStorage, profile.userId, tab)
    return restoreAdminScrollPosition(restoreY)
  }, [profile.userId, tab])

  useEffect(() => {
    const onPopState = (): void => {
      const destination = tabFromAdminUrl(window.location.href, visibleTabIds, 'schedule')
      scrollCaptureGeneration.current += 1
      setTab(destination)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [visibleTabIds])

  // The roster (for the owner's barber selector + resolving ids -> names in views). A barber doesn't
  // strictly need it, but the active-roster read is harmless (RLS lets them read active barbers).
  const { barbers, reload: reloadBarbers } = useBarbers()

  // The barber the owner is acting for. Defaults to the first active barber once the roster loads.
  // A barber always acts as their own linked id.
  const [actingBarberId, setActingBarberId] = useState<AdminBarberId | null>(null)
  const effectiveBarberId: AdminBarberId | null = isOwner
    ? (actingBarberId ?? barbers.find((b) => b.active)?.id ?? barbers[0]?.id ?? null)
    : profile.barberId

  const effectiveBarberName = useMemo(() => {
    const found = barbers.find((b) => b.id === effectiveBarberId)
    if (found !== undefined) return found.name
    return effectiveBarberId ?? '—'
  }, [barbers, effectiveBarberId])

  /** The signed-in barber's first name (identity in the top bar — nothing more is needed). */
  const firstName = effectiveBarberName.trim().split(/\s+/)[0] ?? effectiveBarberName

  const renderView = (): JSX.Element => {
    switch (tab) {
      case 'bookings':
        return (
          <BookingsView
            dark={props.dark}
            lang={props.lang}
            s={s}
            barberId={effectiveBarberId}
            allBarbers={false}
            barbers={barbers}
            heading={
              isOwner
                ? `${t.bookingsOwnerHeadingPrefix} · ${effectiveBarberName}`
                : t.bookingsBarberHeading
            }
            lead={isOwner ? t.bookingsOwnerLead : t.bookingsBarberLead}
            showCalendarConnect={!isOwner}
          />
        )
      case 'schedule':
        return effectiveBarberId === null ? (
          <section style={s.card}>
            <p style={s.emptyState}>{t.scheduleNoBarber}</p>
          </section>
        ) : (
          <ScheduleView
            key={effectiveBarberId}
            dark={props.dark}
            lang={props.lang}
            s={s}
            barberId={effectiveBarberId}
            barberName={effectiveBarberName}
            onPersistenceStateChange={setScheduleBlocked}
          />
        )
      case 'services':
        return effectiveBarberId === null ? (
          <section style={s.card}>
            <p style={s.emptyState}>{t.scheduleNoBarber}</p>
          </section>
        ) : (
          <ServicesView
            dark={props.dark}
            lang={props.lang}
            s={s}
            barberId={effectiveBarberId}
            barberName={effectiveBarberName}
          />
        )
      case 'allBookings':
        return (
          <BookingsView
            dark={props.dark}
            lang={props.lang}
            s={s}
            barberId={null}
            allBarbers
            barbers={barbers}
            heading={t.tabAllBookings}
            lead={t.bookingsOwnerLead}
          />
        )
      case 'barbers':
        return (
          <BarbersView
            dark={props.dark}
            lang={props.lang}
            s={s}
            onRosterChanged={() => void reloadBarbers()}
          />
        )
      case 'profile':
        return effectiveBarberId === null ? (
          <section style={s.card}>
            <p style={s.emptyState}>{t.scheduleNoBarber}</p>
          </section>
        ) : (
          <ProfileView
            dark={props.dark}
            lang={props.lang}
            s={s}
            barberId={effectiveBarberId}
            barberName={effectiveBarberName}
          />
        )
      case 'site':
        return <SiteView dark={props.dark} lang={props.lang} s={s} />
      case 'about':
        return <AboutView dark={props.dark} lang={props.lang} s={s} />
      case 'settings':
        return <SettingsView dark={props.dark} lang={props.lang} s={s} profile={profile} />
      case 'mail':
        return <MailView dark={props.dark} lang={props.lang} s={s} />
    }
  }

  const navButton = (def: TabDef): JSX.Element => {
    const active = def.id === tab
    return (
      <button
        key={def.id}
        type="button"
        onClick={() => {
          if (navigationLocked && !active) return
          selectTab(def.id)
          setMobileMenuOpen(false)
        }}
        disabled={navigationLocked && !active}
        aria-current={active ? 'page' : undefined}
        style={{
          textAlign: 'left',
          border: 'none',
          borderRadius: '9px',
          padding: '9px 12px',
          fontFamily: 'inherit',
          fontSize: '14px',
          fontWeight: active ? 700 : 500,
          cursor: navigationLocked && !active ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          background: active ? c.subtle : 'transparent',
          color: c.text,
          opacity: navigationLocked && !active ? 0.4 : active ? 1 : 0.78,
        }}
      >
        {def.label}
      </button>
    )
  }

  return (
    <div style={s.appShell} class="knc-admin-shell">
      <nav style={s.sidebar} class="knc-admin-sidebar" aria-label={t.ariaNav}>
        <button
          type="button"
          class="knc-admin-mobile-menu-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={t.ariaNav}
          aria-controls="admin-nav-tabs"
          aria-expanded={mobileMenuOpen}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            padding: 0,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: c.closeBg,
            flex: 'none',
          }}
        >
          <img
            src="/icons/chevron.down.svg"
            alt=""
            aria-hidden="true"
            style={{
              width: '13px',
              height: '13px',
              filter: c.iconF,
              transform: mobileMenuOpen ? 'rotate(180deg)' : undefined,
            }}
          />
        </button>
        <div style={s.brand} class="knc-admin-brand">
          <PoleLogo uid="admin" style={{ width: '24px', height: '24px', flex: 'none' }} />
          <span style={{ letterSpacing: '1.5px' }}>BLADE & BLEND STUDIO</span>
        </div>
        <div
          id="admin-nav-tabs"
          style={s.navList}
          class={`knc-admin-navlist${mobileMenuOpen ? ' knc-admin-navlist-open' : ''}`}
        >
          {visibleTabs.map(navButton)}
        </div>
        <button
          type="button"
          style={{ ...s.ghostBtn, marginTop: '12px' }}
          class="knc-admin-signout-bottom"
          onClick={props.onSignOut}
          disabled={navigationLocked}
        >
          {t.signOut}
        </button>
      </nav>

      <main style={s.content}>
        <header style={s.topbar} class="knc-admin-topbar">
          {/* Barbers see their first name on the left; the owner's context lives in the selector. */}
          {!isOwner && (
            <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.2px' }}>
              {t.greeting} {firstName}
            </span>
          )}

          {/* Controls row: barber selector (owner only, leftmost) then lang · theme · sign-out.
              All in one flex group so the selector never wraps onto a separate line above them. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {isOwner && (
              <select
                style={s.select}
                value={effectiveBarberId ?? ''}
                onChange={(e) => setActingBarberId(e.currentTarget.value)}
                aria-label={t.ariaSelectBarber}
                disabled={navigationLocked}
              >
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.active ? '' : ' (dold)'}
                  </option>
                ))}
              </select>
            )}
            <LangSwitch lang={props.lang} setLang={props.setLang} dark={props.dark} />
            <ThemeSwitch
              dark={props.dark}
              onToggle={props.toggleMode}
              label={props.dark ? t.themeLight : t.themeDark}
            />
            <button
              type="button"
              style={s.ghostBtn}
              class="knc-admin-signout-top"
              onClick={props.onSignOut}
              disabled={navigationLocked}
            >
              {t.signOut}
            </button>
          </div>
        </header>

        <Suspense
          fallback={
            <section style={s.card}>
              <p style={s.emptyState}>Laddar …</p>
            </section>
          }
        >
          {renderView()}
        </Suspense>
      </main>
    </div>
  )
}
