// The admin shell: left nav (tabs) + a content area and one clean top bar. Role drives the nav: a
// barber sees {Mina bokningar, Mitt schema}; the owner sees those PLUS {Alla bokningar, Barberare,
// Om oss} and a barber selector to act on any barber.
//
// Identity is kept human: a barber sees just their first name in the top bar ("Hej Victor") — they
// know their own email and job title. The owner instead sees the barber selector (in the controls
// row, leftmost), which is the only context that actually matters when acting for someone else.
//
// Chrome matches the public site: the brand is the pole logo + tracked wordmark, the theme control
// is the site's original track/knob switch (ThemeSwitch), and the language toggle is the same mini
// pill pair the site nav uses.
//
// Fully responsive: on narrow screens the sidebar collapses into a horizontal, safe-area-aware tab
// strip (see global.css `.knc-admin-*`), and the top bar scrolls with the page instead of stacking
// under the strip. All controls are buttons (keyboard-operable); the active tab is `aria-current`.

import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import { palette } from '../booking/bookingStyles'
import { PoleLogo } from '../ui/PoleLogo'
import { buildAdminStyles } from './adminStyles'
import { LangSwitch, ThemeSwitch } from './chrome'
import { BookingsView } from './views/BookingsView'
import { ScheduleView } from './views/ScheduleView'
import { BarbersView } from './views/BarbersView'
import { AboutView } from './views/AboutView'
import { useBarbers } from './useBarbers'
import type { AdminBarberId, AdminProfile } from './types'

export interface AdminShellProps {
  readonly profile: AdminProfile
  readonly dark: boolean
  readonly lang: Lang
  readonly toggleMode: () => void
  readonly setLang: (lang: Lang) => void
  readonly onSignOut: () => void
}

/** The tabs a barber can see; the owner gets all of them. */
type Tab = 'bookings' | 'schedule' | 'allBookings' | 'barbers' | 'about'

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
    { id: 'allBookings', label: t.tabAllBookings, ownerOnly: true },
    { id: 'barbers', label: t.tabBarbers, ownerOnly: true },
    { id: 'about', label: t.tabAbout, ownerOnly: true },
  ]

  const visibleTabs = TABS.filter((tab) => isOwner || !tab.ownerOnly)
  // Schedule first: managing today's availability is the barber's most frequent task.
  const [tab, setTab] = useState<Tab>('schedule')

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
          />
        )
      case 'schedule':
        return effectiveBarberId === null ? (
          <section style={s.card}>
            <p style={s.emptyState}>{t.scheduleNoBarber}</p>
          </section>
        ) : (
          <ScheduleView
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
        return <BarbersView lang={props.lang} s={s} onRosterChanged={() => void reloadBarbers()} />
      case 'about':
        return <AboutView dark={props.dark} lang={props.lang} s={s} />
    }
  }

  const navButton = (def: TabDef): JSX.Element => {
    const active = def.id === tab
    return (
      <button
        key={def.id}
        type="button"
        onClick={() => setTab(def.id)}
        aria-current={active ? 'page' : undefined}
        style={{
          textAlign: 'left',
          border: 'none',
          borderRadius: '9px',
          padding: '9px 12px',
          fontFamily: 'inherit',
          fontSize: '14px',
          fontWeight: active ? 700 : 500,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          background: active ? c.subtle : 'transparent',
          color: c.text,
          opacity: active ? 1 : 0.78,
        }}
      >
        {def.label}
      </button>
    )
  }

  return (
    <div style={s.appShell} class="knc-admin-shell">
      <nav style={s.sidebar} class="knc-admin-sidebar" aria-label={t.ariaNav}>
        <div style={s.brand}>
          <PoleLogo uid="admin" style={{ width: '24px', height: '24px', flex: 'none' }} />
          <span style={{ letterSpacing: '1.5px', whiteSpace: 'nowrap' }}>BLADE & BLEND STUDIO</span>
        </div>
        <div style={s.navList} class="knc-admin-navlist">
          {visibleTabs.map(navButton)}
        </div>
        <button
          type="button"
          style={{ ...s.ghostBtn, marginTop: '12px' }}
          class="knc-admin-signout-bottom"
          onClick={props.onSignOut}
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
            >
              {t.signOut}
            </button>
          </div>
        </header>

        {renderView()}
      </main>
    </div>
  )
}
