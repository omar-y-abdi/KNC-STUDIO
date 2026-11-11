import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'preact/compat'
import type * as Wouter from 'wouter-preact'
import { palette } from '../../modules/public-web/src/booking/bookingStyles'
import { LazyLoadingMessage, LazySurface } from '../../modules/public-web/src/ui/LazySurface'
import { AdminApp } from '../../modules/staff-admin/src/AdminApp'
import { AdminLazySurface } from '../../modules/staff-admin/src/AdminLazySurface'
import { AdminShell } from '../../modules/staff-admin/src/AdminShell'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import { buildAdminStyles } from '../../modules/staff-admin/src/adminStyles'
import AdminEntry from '../../modules/staff-admin/src/index'
import { defaultWeek } from '../../modules/staff-admin/src/time'
import type { AdminProfile } from '../../modules/staff-admin/src/types'
import { useAdminSession } from '../../modules/staff-admin/src/useAdminSession'
import { BarbersView } from '../../modules/staff-admin/src/views/BarbersView'
import { BookingsView } from '../../modules/staff-admin/src/views/BookingsView'
import { ProfileView } from '../../modules/staff-admin/src/views/ProfileView'
import {
  ScheduleDayGrid,
  type ScheduleDayGridProps,
} from '../../modules/staff-admin/src/views/ScheduleDayGrid'
import { ScheduleView } from '../../modules/staff-admin/src/views/ScheduleView'
import { ServicesView } from '../../modules/staff-admin/src/views/ServicesView'
import { commit, mount, nodes, render, reset, type RenderedNode } from './helpers/fakeHooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('wouter-preact', async (original) => ({
  ...(await original<typeof Wouter>()),
  useLocation: () => ['/admin', () => undefined],
}))
vi.mock('../../modules/staff-admin/src/adminClient', () => {
  const noBackend = (): never => {
    throw new Error('This test reaches no backend')
  }
  return {
    getAdminClient: noBackend,
    getAdminAuthClient: noBackend,
    createAdminAuthOperationClient: noBackend,
    clearStoredAdminSession: noBackend,
  }
})
vi.mock('../../modules/staff-admin/src/useAdminSession', () => ({ useAdminSession: vi.fn() }))
vi.mock('../../modules/staff-admin/src/useTheme', () => ({
  useTheme: () => ({
    dark: false,
    lang: 'sv',
    toggleMode: () => undefined,
    setLang: () => undefined,
  }),
}))
const roster = vi.hoisted(() => vi.fn())
vi.mock('../../modules/staff-admin/src/useBarbers', () => ({ useBarbers: roster }))
const capInputZoom = vi.hoisted(() => vi.fn())
vi.mock('../../modules/staff-admin/src/inputZoom', () => ({ capInputZoom }))

const s = buildAdminStyles(palette(false), false)
const sv = adminText('sv')
const barber: AdminProfile = {
  userId: 'u1',
  email: 'hassan@example.test',
  role: 'barber',
  barberId: 'hassan',
}

function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (typeof value !== 'object' || value === null || !('props' in value)) return ''
  const props = value.props
  return typeof props === 'object' && props !== null && 'children' in props
    ? textOf(props.children)
    : ''
}

/** The element whose own child is `text`. */
const holder = (tree: unknown, text: string): RenderedNode | undefined =>
  nodes(tree).find((node) => node.props.children === text)

const session = (gate: ReturnType<typeof useAdminSession>['gate']): void => {
  vi.mocked(useAdminSession).mockReturnValue({
    gate,
    error: null,
    revalidate: () => undefined,
    onSignOut: () => undefined,
  })
}

const rosterRead = (state: { loading: boolean; error: string | null }) => ({
  barbers: [],
  ...state,
  reload: async () => undefined,
})

beforeEach(() => {
  reset()
  roster.mockReturnValue(rosterRead({ loading: true, error: null }))
})
afterEach(() => vi.unstubAllGlobals())

describe('a staff view while its data is read', () => {
  const day: ScheduleDayGridProps = {
    c: palette(false),
    dark: false,
    lang: 'sv',
    s,
    barberId: 'hassan',
    week: defaultWeek(),
    timeOff: [],
    recurringBreaks: [],
    bookings: [],
    blocksNonce: 0,
    onPersistenceStateChange: () => undefined,
    onBookingsChanged: () => undefined,
    onBlockSlot: async () => ({ kind: 'error', error: { kind: 'network', message: '' } }),
    onBlockDay: async () => false,
    onOpenDay: async () => false,
  }
  const own = { dark: false, lang: 'sv', s, barberId: 'hassan', barberName: 'Hassan' } as const

  it.each([
    ['services', () => ServicesView(own), sv.svcLoading, [sv.svcEmpty]],
    [
      'profile',
      () => ProfileView({ ...own, isOwner: false, onRosterChanged: () => undefined }),
      sv.profileLoading,
      [sv.profileNoPhoto],
    ],
    [
      'bookings',
      () =>
        BookingsView({
          ...own,
          allBarbers: false,
          barbers: [],
          heading: sv.bookingsBarberHeading,
          lead: sv.bookingsBarberLead,
          showCalendarConnect: true,
        }),
      sv.bookingsLoading,
      [sv.bookingsEmptyUpcoming, sv.bookingsEmptyPast],
    ],
    [
      'barbers',
      () => BarbersView({ lang: 'sv', dark: false, s, onRosterChanged: () => undefined }),
      sv.barbersLoading,
      [sv.barbersEmpty],
    ],
    [
      'schedule',
      () => ScheduleView({ ...own, onPersistenceStateChange: () => undefined }),
      sv.scheduleLoading,
      [],
    ],
    [
      'day grid',
      () => ScheduleDayGrid(day),
      sv.scheduleGridLoading,
      [sv.scheduleGridDayOff, sv.scheduleGridNonWorkingDay],
    ],
  ] as const)(
    '%s paints nothing in place of its loading text and keeps its place and its text',
    (_, view, loading, empty) => {
      const tree = render(view)

      expect(holder(tree, loading)?.props['style']).toEqual({ ...s.emptyState, opacity: 0 })
      for (const text of empty) expect(textOf(tree)).not.toContain(text)
    },
  )

  it('keeps the schedule card and its heading while the schedule is read', () => {
    const tree = nodes(
      render(() => ScheduleView({ ...own, onPersistenceStateChange: () => undefined })),
    )

    expect(tree[0]?.props['style']).toEqual(s.card)
    expect(textOf(tree.find((node) => node.type === 'h2'))).toBe(
      `${sv.scheduleHeadingPrefix} · Hassan`,
    )
  })
})

describe('the panel while a code chunk loads', () => {
  it('paints nothing while the session is resolved and keeps the page and its text', () => {
    session({ kind: 'checking' })

    const tree = render(() => AdminApp())

    expect(nodes(tree)[0]?.props['style']).toMatchObject({ minHeight: '100vh', opacity: 0.7 })
    expect(holder(tree, sv.lazyLoading)?.props['style']).toEqual({ opacity: 0 })
  })

  it('keeps the visible error and retry while the session cannot be resolved', () => {
    session({ kind: 'unavailable' })

    const tree = nodes(render(() => AdminApp()))

    expect(tree.some((node) => node.props['role'] === 'alert')).toBe(true)
    expect(textOf(tree.find((node) => node.type === 'button'))).toBe(sv.lazyReload)
    expect(textOf(tree)).not.toContain(sv.lazyLoading)
  })

  it.each([
    ['the entry', () => AdminEntry()],
    [
      'the signed-in panel',
      () => {
        session({ kind: 'authed', profile: barber })
        return AdminApp()
      },
    ],
  ] as const)('%s loads its chunks behind the panel’s own lazy surface', (_, entry) => {
    const tree = nodes(render(entry))

    expect(tree.some((node) => node.type === LazySurface)).toBe(false)
    expect(tree.find((node) => node.type === AdminLazySurface)?.props).toMatchObject({
      loadingLabel: sv.lazyLoading,
      errorLabel: sv.lazyError,
      retryLabel: sv.lazyReload,
    })
  })

  it('paints nothing in place of a view whose chunk is still loading', () => {
    vi.stubGlobal('window', { location: { href: 'https://bladeblend.test/admin' } })

    const tree = nodes(
      render(() =>
        AdminShell({
          profile: barber,
          dark: false,
          lang: 'sv',
          toggleMode: () => undefined,
          setLang: () => undefined,
          onSignOut: () => undefined,
        }),
      ),
    )
    const fallback = tree.find((node) => node.type === Suspense)?.props['fallback']

    expect(nodes(fallback)[0]?.props['style']).toEqual({ ...s.card, opacity: 0 })
    expect(textOf(fallback)).toBe(sv.lazyLoading)
  })
})

describe('the owner’s shell before a barber is resolved', () => {
  const owner: AdminProfile = {
    userId: 'o1',
    email: 'owner@example.test',
    role: 'owner',
    barberId: null,
  }
  const view = (tab: string): RenderedNode | undefined => {
    vi.stubGlobal('window', { location: { href: `https://bladeblend.test/admin?tab=${tab}` } })
    const tree = nodes(
      render(() =>
        AdminShell({
          profile: owner,
          dark: false,
          lang: 'sv',
          toggleMode: () => undefined,
          setLang: () => undefined,
          onSignOut: () => undefined,
        }),
      ),
    )
    return nodes(tree.find((node) => node.type === Suspense)?.props.children)[0]
  }
  const tabs = ['schedule', 'services', 'profile'] as const

  it.each(tabs)('the %s tab paints nothing while the roster is read', (tab) => {
    const shown = view(tab)

    expect(shown?.props['style']).toEqual({ ...s.card, opacity: 0 })
    expect(textOf(shown)).toBe(sv.lazyLoading)
  })

  it.each(
    tabs.flatMap((tab) => [
      [tab, null],
      [tab, 'network'],
    ]),
  )('the %s tab says no barber is selected once the roster read ends (error %s)', (tab, error) => {
    roster.mockReturnValue(rosterRead({ loading: false, error }))

    const shown = view(tab)

    expect(shown?.props['style']).toEqual(s.card)
    expect(textOf(shown)).toBe(sv.scheduleNoBarber)
  })
})

describe('the panel’s lazy surface', () => {
  const drawn = AdminLazySurface({
    children: 'view',
    loadingLabel: 'loading',
    errorLabel: 'error',
    retryLabel: 'retry',
  })

  it('keeps the shared error and retry around the chunk and gives it no visible loading text', () => {
    expect(drawn.type).toBe(LazySurface)
    expect(drawn.props).toMatchObject({
      errorLabel: 'error',
      retryLabel: 'retry',
      minHeight: '100vh',
    })
    expect(drawn.props).not.toHaveProperty('loadingLabel')
  })

  it('suspends inside that surface and only announces the chunk while it loads', () => {
    const boundary = nodes(drawn.props.children)[0]
    const fallback = nodes(boundary?.props['fallback'])

    expect(boundary?.type).toBe(Suspense)
    expect(boundary?.props.children).toBe('view')
    expect(fallback.map((node) => node.type)).toEqual(['div', LazyLoadingMessage])
    expect(fallback[0]?.props['style']).toEqual({ opacity: 0 })
    expect(fallback[1]?.props).toEqual({ label: 'loading', overlay: false, minHeight: '100vh' })
  })
})

describe('the staff entry and input zoom', () => {
  const undo = vi.fn()
  beforeEach(() => {
    capInputZoom.mockReset()
    capInputZoom.mockReturnValue(undo)
    undo.mockReset()
  })

  it('caps input zoom once on mount and undoes it on unmount', () => {
    render(() => AdminEntry())
    const unmount = mount()

    expect(capInputZoom).toHaveBeenCalledTimes(1)
    expect(capInputZoom).toHaveBeenCalledWith()
    expect(undo).not.toHaveBeenCalled()

    unmount()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('keeps the one cap across re-renders', () => {
    render(() => AdminEntry())
    commit()
    render(() => AdminEntry())
    commit()

    expect(capInputZoom).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
  })
})
