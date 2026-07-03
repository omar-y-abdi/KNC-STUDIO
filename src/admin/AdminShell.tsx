// The admin shell: left nav (tabs) + a content area, a top bar (theme/lang/sign-out), and a "whose
// data" banner so a barber (or the owner acting for a barber) always sees WHOSE schedule/bookings are
// shown. Role drives the nav: a barber sees {Mina bokningar, Mitt schema}; the owner sees those PLUS
// {Alla bokningar, Barberare, Om oss} and a BARBER SELECTOR to act on any barber.
//
// Fully responsive: on narrow screens the sidebar collapses into a horizontal scrolling tab bar
// (a CSS class handles the breakpoint; see global.css `.knc-admin-*`). All controls are buttons
// (keyboard-operable); the active tab is `aria-current`.

import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { palette } from '../booking/bookingStyles'
import { buildAdminStyles } from './adminStyles'
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

const TABS: readonly TabDef[] = [
  { id: 'bookings', label: 'Mina bokningar', ownerOnly: false },
  { id: 'schedule', label: 'Mitt schema', ownerOnly: false },
  { id: 'allBookings', label: 'Alla bokningar', ownerOnly: true },
  { id: 'barbers', label: 'Barberare', ownerOnly: true },
  { id: 'about', label: 'Om oss', ownerOnly: true },
]

export function AdminShell(props: AdminShellProps): JSX.Element {
  const { profile } = props
  const isOwner = profile.role === 'owner'
  const c = palette(props.dark)
  const s = buildAdminStyles(c, props.dark)

  const visibleTabs = TABS.filter((t) => isOwner || !t.ownerOnly)
  const [tab, setTab] = useState<Tab>('bookings')

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
            heading={isOwner ? `Bokningar · ${effectiveBarberName}` : 'Mina bokningar'}
            lead={
              isOwner
                ? 'Bokningar för vald barberare. Byt barberare uppe till höger.'
                : 'Dina kommande och tidigare bokningar. Avboka vid behov.'
            }
          />
        )
      case 'schedule':
        return effectiveBarberId === null ? (
          <section style={s.card}>
            <p style={s.emptyState}>Ingen barberare vald.</p>
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
            heading="Alla bokningar"
            lead="Samtliga barberares bokningar. Avboka vid behov."
          />
        )
      case 'barbers':
        return <BarbersView s={s} onRosterChanged={() => void reloadBarbers()} />
      case 'about':
        return <AboutView dark={props.dark} s={s} />
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

  const langButton = (target: Lang): JSX.Element => {
    const on = props.lang === target
    return (
      <button
        type="button"
        onClick={() => props.setLang(target)}
        aria-pressed={on}
        style={{
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.3px',
          padding: '4px 9px',
          borderRadius: '999px',
          background: on ? c.accent : 'transparent',
          color: on ? c.accentText : c.text,
          opacity: on ? 1 : 0.6,
        }}
      >
        {target.toUpperCase()}
      </button>
    )
  }

  return (
    <div style={s.appShell} class="knc-admin-shell">
      <nav style={s.sidebar} class="knc-admin-sidebar" aria-label="Adminmeny">
        <div style={s.brand}>
          <span aria-hidden="true">✂</span> KNC Studio
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
          Logga ut
        </button>
      </nav>

      <main style={s.content}>
        <header style={s.topbar} class="knc-admin-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {isOwner ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ ...s.label, margin: 0 }}>Barberare</span>
                <select
                  style={s.select}
                  value={effectiveBarberId ?? ''}
                  onChange={(e) => setActingBarberId(e.currentTarget.value)}
                  aria-label="Välj barberare att hantera"
                >
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.active ? '' : ' (dold)'}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                background: props.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
                borderRadius: '999px',
                padding: '2px',
              }}
            >
              {langButton('sv')}
              {langButton('en')}
            </div>
            <button
              type="button"
              style={s.ghostBtn}
              onClick={props.toggleMode}
              aria-label={props.dark ? 'Byt till ljust läge' : 'Byt till mörkt läge'}
            >
              {props.dark ? '☀' : '☾'}
            </button>
            <button
              type="button"
              style={s.ghostBtn}
              class="knc-admin-signout-top"
              onClick={props.onSignOut}
            >
              Logga ut
            </button>
          </div>
        </header>

        <div style={s.whoBanner} aria-live="polite">
          <span style={s.pill}>{isOwner ? 'Ägare' : 'Barberare'}</span>
          <span>
            Inloggad som <strong>{profile.email}</strong>
            {tab === 'schedule' || tab === 'bookings' ? ` · visar ${effectiveBarberName}` : ''}
          </span>
        </div>

        {renderView()}
      </main>
    </div>
  )
}
