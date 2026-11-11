// The staff tutorial in the panel: who gets it, what one visit starts, what is saved, the Settings
// box, and the tour anchors on the views. The layer's DOM work is covered by the browser check.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense } from 'preact/compat'
import type * as Wouter from 'wouter-preact'
import { palette } from '../../modules/public-web/src/booking/bookingStyles'
import { AdminApp } from '../../modules/staff-admin/src/AdminApp'
import { AdminShell } from '../../modules/staff-admin/src/AdminShell'
import {
  TOUR_PROGRESS_FAILED,
  tourProgressPort,
  type TourProgressPort,
} from '../../modules/staff-admin/src/adapters/tourProgress'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import { buildAdminStyles } from '../../modules/staff-admin/src/adminStyles'
import type { AdminTab } from '../../modules/staff-admin/src/adminTabs'
import { CalendarConnectButton } from '../../modules/staff-admin/src/calendar/CalendarConnectButton'
import type { CalendarStatus } from '../../modules/staff-admin/src/calendar/port'
import { useCalendarSync } from '../../modules/staff-admin/src/calendar/useCalendarSync'
import { WorkSwitch } from '../../modules/staff-admin/src/chrome'
import { defaultWeek } from '../../modules/staff-admin/src/time'
import type * as TourDom from '../../modules/staff-admin/src/tour/tourDom'
import { TourLayer } from '../../modules/staff-admin/src/tour/TourLayer'
import {
  FRESH_PROGRESS,
  withSeen,
  type TourProgress,
} from '../../modules/staff-admin/src/tour/tourModel'
import { paddedBox, scrollDelta, type Box } from '../../modules/staff-admin/src/tour/tourPlacement'
import type { TourAnchor } from '../../modules/staff-admin/src/tour/tourSteps'
import {
  useStaffTour,
  type StaffTour,
  type TutorialControls,
} from '../../modules/staff-admin/src/tour/useStaffTour'
import { ok, type AdminProfile, type AdminResult } from '../../modules/staff-admin/src/types'
import { useAdminSession } from '../../modules/staff-admin/src/useAdminSession'
import {
  ServicesView,
  type ServicesViewPort,
} from '../../modules/staff-admin/src/views/ServicesView'
import { SettingsView } from '../../modules/staff-admin/src/views/SettingsView'
import { TutorialSection } from '../../modules/staff-admin/src/views/TutorialSection'
import { WeekHoursCard } from '../../modules/staff-admin/src/views/WeekHoursCard'
import { commit, nodes, render, reset, type RenderedNode } from './helpers/fakeHooks'

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
    lang: 'en',
    toggleMode: () => undefined,
    setLang: () => undefined,
  }),
}))
vi.mock('../../modules/staff-admin/src/useBarbers', () => ({
  useBarbers: () => ({ barbers: [], loading: true, error: null, reload: async () => undefined }),
}))
vi.mock('../../modules/staff-admin/src/calendar/useCalendarSync', () => ({
  useCalendarSync: vi.fn(),
}))
const dom = vi.hoisted(() => ({ waitForReady: vi.fn(), presentAnchors: vi.fn() }))
vi.mock('../../modules/staff-admin/src/tour/tourDom', async (original) => ({
  ...(await original<typeof TourDom>()),
  waitForReady: dom.waitForReady,
  presentAnchors: dom.presentAnchors,
}))

const s = buildAdminStyles(palette(false), false)
const en = adminText('en')
const barber: AdminProfile = {
  userId: 'u1',
  email: 'hassan@example.test',
  role: 'barber',
  barberId: 'hassan',
}
const owner: AdminProfile = {
  userId: 'o1',
  email: 'owner@example.test',
  role: 'owner',
  barberId: null,
}
const OVERVIEW_ANCHORS: ReadonlySet<TourAnchor> = new Set(['nav', 'week-day', 'nav-settings'])

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function press(node: RenderedNode | undefined): void {
  const action = node?.props['onClick']
  if (typeof action !== 'function') throw new Error('Nothing to press')
  action()
}

const buttons = (tree: readonly RenderedNode[]): RenderedNode[] =>
  tree.filter((node) => node.type === 'button')
const button = (tree: readonly RenderedNode[], label: string): RenderedNode | undefined =>
  buttons(tree).find((node) => node.props.children === label)
const anchored = (tree: readonly RenderedNode[], anchor: TourAnchor): RenderedNode[] =>
  tree.filter((node) => node.props['data-tour'] === anchor)

function fakePort(read: AdminResult<TourProgress> = ok(FRESH_PROGRESS)) {
  return {
    read: vi.fn<TourProgressPort['read']>(async () => read),
    write: vi.fn<TourProgressPort['write']>(async () => ok(undefined)),
  }
}

/** What a write sent, in a form `toEqual` can compare. */
const written = (port: ReturnType<typeof fakePort>) =>
  port.write.mock.calls.map(([progress]) => ({
    seen: [...progress.seen],
    removed: progress.removed,
  }))

class FakeElement {
  isConnected = true
  readonly focus = vi.fn()
}

beforeEach(() => {
  reset()
  dom.waitForReady.mockReset()
  dom.presentAnchors.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('the shell without a tutorial port', () => {
  const shell = (profile: AdminProfile, tab: string, port?: TourProgressPort) => {
    vi.stubGlobal('window', { location: { href: `https://bladeblend.test/admin?tab=${tab}` } })
    return nodes(
      render(() =>
        AdminShell({
          profile,
          dark: false,
          lang: 'en',
          toggleMode: () => undefined,
          setLang: () => undefined,
          onSignOut: () => undefined,
          ...(port === undefined ? {} : { tourProgress: port }),
        }),
      ),
    )
  }
  const view = (tree: readonly RenderedNode[]): RenderedNode | undefined =>
    nodes(tree.find((node) => node.type === Suspense)?.props.children)[0]

  it.each([
    ['a barber', barber],
    ['the owner', owner],
  ])('gives %s no tour layer and leaves the nav and the content usable', (_, profile) => {
    const tree = shell(profile, 'schedule')

    expect(tree.some((node) => node.type === TourLayer)).toBe(false)
    expect(tree.some((node) => String(node.props['class'] ?? '').includes('knc-tour'))).toBe(false)
    expect(tree.find((node) => node.type === 'nav')?.props['inert']).toBeUndefined()
    expect(tree.find((node) => node.type === 'main')?.props['inert']).toBeUndefined()
  })

  it('gives Settings no tutorial controls', () => {
    const shown = view(shell(barber, 'settings'))

    expect(shown?.props['profile']).toBe(barber)
    expect(shown?.props).not.toHaveProperty('tutorial')
  })

  it('reads no progress while it renders, and shows nothing until it has it', () => {
    const port = fakePort()
    const tree = shell(barber, 'settings', port)

    expect(port.read).not.toHaveBeenCalled()
    expect(tree.some((node) => node.type === TourLayer)).toBe(false)
    expect(view(tree)?.props).not.toHaveProperty('tutorial')
  })

  it('marks the nav list and every nav button as tour anchors', () => {
    const tree = shell(barber, 'schedule')

    expect(tree.find((node) => node.props['id'] === 'admin-nav-tabs')?.props['data-tour']).toBe(
      'nav',
    )
    expect(
      buttons(tree)
        .map((node) => node.props['data-tour'])
        .filter((anchor) => anchor !== undefined),
    ).toEqual(['nav-schedule', 'nav-bookings', 'nav-services', 'nav-profile', 'nav-settings'])
  })
})

describe('the panel gate', () => {
  const shellProps = (profile: AdminProfile) => {
    vi.mocked(useAdminSession).mockReturnValue({
      gate: { kind: 'authed', profile },
      error: null,
      revalidate: () => undefined,
      onSignOut: () => undefined,
    })
    return nodes(render(() => AdminApp())).find((node) => 'profile' in node.props)?.props
  }

  it('passes the tutorial port to a barber with a barber id', () => {
    expect(shellProps(barber)?.['tourProgress']).toBe(tourProgressPort)
  })

  it.each([
    ['the owner', owner],
    ['a barber without a barber id', { ...barber, barberId: null }],
  ])('passes no tutorial port to %s', (_, profile) => {
    const props = shellProps(profile)

    expect(props?.['profile']).toBe(profile)
    expect(props).not.toHaveProperty('tourProgress')
  })
})

describe('the tutorial controller', () => {
  function tourUi(port: TourProgressPort | undefined, tab: AdminTab = 'schedule') {
    let current = tab
    const selectTab = vi.fn<(next: AdminTab) => void>((next) => {
      current = next
    })
    const setMenuOpen = vi.fn<(open: boolean) => void>()
    /** Renders, then runs the effects, as the renderer does after each render. */
    const draw = (): StaffTour => {
      const out = render(() => useStaffTour({ port, tab: current, selectTab, setMenuOpen }))
      commit()
      return out
    }
    const go = (next: AdminTab): StaffTour => {
      current = next
      draw()
      return draw()
    }
    /** Mount, let the read answer, then the visit and the wait it starts. */
    const open = async (): Promise<StaffTour> => {
      draw()
      await flush()
      draw()
      return draw()
    }
    return { draw, go, open, selectTab, setMenuOpen }
  }

  /** The `ready` and `gaveUp` of the last wait. */
  const lastWait = () => {
    const call = dom.waitForReady.mock.calls.at(-1)
    const [anchor, ready, gaveUp] = call ?? []
    if (typeof ready !== 'function' || typeof gaveUp !== 'function') throw new Error('No wait')
    return { anchor, ready: () => ready(), gaveUp: () => gaveUp() }
  }

  function startOverview(present: ReadonlySet<TourAnchor> = OVERVIEW_ANCHORS): FakeElement {
    vi.stubGlobal('HTMLElement', FakeElement)
    const before = new FakeElement()
    vi.stubGlobal('document', { activeElement: before })
    dom.presentAnchors.mockReturnValue(present)
    lastWait().ready()
    return before
  }

  it('does nothing without a port', async () => {
    const ui = tourUi(undefined)

    const shown = await ui.open()

    expect(shown).toEqual({ tour: null, tutorial: null })
    expect(dom.waitForReady).not.toHaveBeenCalled()
  })

  it('shows no tour and no Settings box when the progress cannot be read', async () => {
    const port = fakePort(TOUR_PROGRESS_FAILED)
    const ui = tourUi(port)

    const shown = await ui.open()

    expect(port.read).toHaveBeenCalledOnce()
    expect(shown).toEqual({ tour: null, tutorial: null })
    expect(dom.waitForReady).not.toHaveBeenCalled()
  })

  it('starts the overview on the schedule tab once its ready anchor is there', async () => {
    const cancel = vi.fn()
    dom.waitForReady.mockReturnValue(cancel)
    const ui = tourUi(fakePort())

    const waiting = await ui.open()
    expect(waiting.tour).toBeNull()
    expect(waiting.tutorial?.removed).toBe(false)
    expect(lastWait().anchor).toBe('week-day')

    startOverview()
    const shown = ui.draw()

    expect(shown.tour?.running.tour).toBe('overview')
    expect(shown.tour?.running.steps.map((step) => step.anchor)).toEqual([
      'nav',
      'week-day',
      'nav-settings',
    ])
    expect(shown.tour?.running.index).toBe(0)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('counts only the steps whose anchor is there', async () => {
    const ui = tourUi(fakePort())
    await ui.open()

    startOverview(new Set(['nav', 'week-day']))

    expect(ui.draw().tour?.running.steps.map((step) => step.anchor)).toEqual(['nav', 'week-day'])
  })

  it('saves the overview when it is done, starts nothing else and gives the focus back', async () => {
    const port = fakePort()
    const ui = tourUi(port)
    await ui.open()
    const before = startOverview()

    let shown = ui.draw()
    shown.tour?.back()
    shown = ui.draw()
    expect(shown.tour?.running.index).toBe(0)
    shown.tour?.next()
    shown = ui.draw()
    shown.tour?.next()
    shown = ui.draw()
    expect(shown.tour?.running.index).toBe(2)
    shown.tour?.next()
    shown = ui.draw()
    ui.draw()
    await flush()

    expect(shown.tour).toBeNull()
    expect(written(port)).toEqual([{ seen: ['overview'], removed: false }])
    expect(dom.waitForReady).toHaveBeenCalledOnce()
    expect(ui.setMenuOpen).toHaveBeenLastCalledWith(false)
    expect(before.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('saves a tour that is closed, but not one a tab change interrupts', async () => {
    const closed = fakePort()
    const closing = tourUi(closed)
    await closing.open()
    startOverview()
    closing.draw().tour?.skip()
    expect(closing.draw().tour).toBeNull()

    reset()
    const left = fakePort()
    const leaving = tourUi(left)
    await leaving.open()
    startOverview()
    leaving.draw()
    expect(leaving.go('bookings').tour).toBeNull()
    await flush()

    expect(written(closed)).toEqual([{ seen: ['overview'], removed: false }])
    expect(left.write).not.toHaveBeenCalled()
    expect(leaving.setMenuOpen).toHaveBeenLastCalledWith(false)
  })

  it('marks a tour seen without showing it when none of its anchors is there', async () => {
    const port = fakePort()
    const ui = tourUi(port)
    await ui.open()

    startOverview(new Set())
    expect(ui.draw().tour).toBeNull()
    await flush()

    expect(written(port)).toEqual([{ seen: ['overview'], removed: false }])
  })

  it('saves nothing when the ready anchor never comes', async () => {
    const port = fakePort()
    const ui = tourUi(port)
    await ui.open()

    lastWait().gaveUp()
    expect(ui.draw().tour).toBeNull()
    await flush()

    expect(port.write).not.toHaveBeenCalled()
  })

  it('starts the next tour of a tab only on its next visit', async () => {
    const ui = tourUi(fakePort(ok(withSeen(FRESH_PROGRESS, 'overview'))), 'settings')
    await ui.open()
    expect(dom.waitForReady).not.toHaveBeenCalled()

    ui.go('schedule')
    ui.go('services')

    expect(dom.waitForReady.mock.calls.map(([anchor]) => anchor)).toEqual([
      'week-day',
      'service-new',
    ])
  })

  it('runs it again from the overview after a saved replay', async () => {
    const port = fakePort(ok(withSeen(FRESH_PROGRESS, 'overview')))
    const ui = tourUi(port, 'settings')
    const settings = await ui.open()

    await expect(settings.tutorial?.replay()).resolves.toBe(true)
    ui.draw()
    ui.draw()

    expect(written(port)).toEqual([{ seen: [], removed: false }])
    expect(ui.selectTab.mock.calls).toEqual([['schedule']])
    expect(dom.waitForReady.mock.calls.map(([anchor]) => anchor)).toEqual(['week-day'])
    startOverview()
    expect(ui.draw().tour?.running.tour).toBe('overview')
  })

  it('removes it, keeps what was seen and starts no tour after that', async () => {
    const port = fakePort(ok(withSeen(FRESH_PROGRESS, 'overview')))
    const ui = tourUi(port, 'settings')
    const settings = await ui.open()

    await expect(settings.tutorial?.remove()).resolves.toBe(true)

    expect(written(port)).toEqual([{ seen: ['overview'], removed: true }])
    expect(ui.draw().tutorial?.removed).toBe(true)
    ui.go('bookings')
    ui.go('schedule')
    expect(dom.waitForReady).not.toHaveBeenCalled()
  })

  it.each(['replay', 'remove'] as const)(
    'changes nothing when the %s save fails',
    async (action) => {
      const port = fakePort(ok(withSeen(FRESH_PROGRESS, 'overview')))
      port.write.mockResolvedValue(TOUR_PROGRESS_FAILED)
      const ui = tourUi(port, 'settings')
      const settings = await ui.open()

      await expect(settings.tutorial?.[action]()).resolves.toBe(false)
      const after = ui.draw()
      ui.draw()

      expect(after.tutorial?.removed).toBe(false)
      expect(ui.selectTab).not.toHaveBeenCalled()
      expect(dom.waitForReady).not.toHaveBeenCalled()
    },
  )
})

describe('the Tutorial box in Settings', () => {
  const controls = (removed = false) => ({
    removed,
    replay: vi.fn<TutorialControls['replay']>(async () => true),
    remove: vi.fn<TutorialControls['remove']>(async () => true),
  })
  const settings = (tutorial?: TutorialControls) =>
    nodes(
      render(() =>
        SettingsView({
          dark: false,
          lang: 'en',
          s,
          profile: barber,
          ...(tutorial === undefined ? {} : { tutorial }),
        }),
      ),
      { expandComponents: true },
    )
  const box = (tree: readonly RenderedNode[]): RenderedNode[] =>
    nodes(
      tree.find(
        (node) =>
          node.type === 'section' && node.props['aria-labelledby'] === 'settings-tutorial-heading',
      ),
    )
  const alertText = (tree: readonly RenderedNode[]): unknown =>
    tree.find((node) => node.props['role'] === 'alert')?.props.children

  it('is not there without the controls', () => {
    expect(box(settings())).toEqual([])
  })

  it('comes after the password form, behind the view’s divider', () => {
    const tree = settings(controls())
    const password = tree.findIndex(
      (node) =>
        node.type === 'form' && node.props['aria-labelledby'] === 'settings-password-heading',
    )
    const section = tree.findIndex(
      (node) => node.props['aria-labelledby'] === 'settings-tutorial-heading',
    )

    expect(password).toBeGreaterThan(-1)
    expect(section).toBeGreaterThan(password)
    expect(tree[section - 1]?.type).toBe('hr')
  })

  it('shows the heading, the lead and both buttons in that order', () => {
    const shown = box(settings(controls()))

    const heading = shown.find((node) => node.type === 'h3')
    expect(heading?.props['id']).toBe('settings-tutorial-heading')
    expect(heading?.props.children).toBe(en.tutorialTitle)
    const lead = shown.find((node) => node.type === 'p')
    expect(lead?.props['aria-live']).toBe('polite')
    expect(lead?.props.children).toBe(en.tutorialLead)
    expect(buttons(shown).map((node) => [node.props.children, node.props['style']])).toEqual([
      [en.tutorialReplay, { ...s.primaryBtn, opacity: 1 }],
      [en.tutorialRemove, { ...s.ghostBtn, opacity: 1 }],
    ])
    expect(alertText(shown)).toBeUndefined()
  })

  it('says it is removed and offers only to run it again', () => {
    const shown = box(settings(controls(true)))

    expect(shown.find((node) => node.type === 'p')?.props.children).toBe(en.tutorialRemovedLead)
    expect(buttons(shown).map((node) => node.props.children)).toEqual([en.tutorialReplay])
  })

  it('disables both buttons while a save runs and shows the alert when it failed', async () => {
    const tutorial = controls()
    let answer: (saved: boolean) => void = () => undefined
    tutorial.remove.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )

    press(button(settings(tutorial), en.tutorialRemove))
    expect(
      buttons(box(settings(tutorial))).map((node) => [
        node.props['disabled'],
        (node.props['style'] as { opacity?: number }).opacity,
      ]),
    ).toEqual([
      [true, 0.6],
      [true, 0.6],
    ])
    answer(false)
    await flush()
    const shown = box(settings(tutorial))

    expect(alertText(shown)).toBe(en.tutorialSaveError)
    expect(buttons(shown).map((node) => node.props['disabled'])).toEqual([false, false])
  })
})

describe('the Tutorial box buttons', () => {
  const headingStyle = { margin: '0 0 4px' }
  const ui = (tutorial: TutorialControls) =>
    nodes(render(() => TutorialSection({ lang: 'en', s, headingStyle, controls: tutorial })))

  it('call the controls once per press and keep the given heading style', async () => {
    const tutorial = {
      removed: false,
      replay: vi.fn<TutorialControls['replay']>(async () => true),
      remove: vi.fn<TutorialControls['remove']>(async () => true),
    }

    const shown = ui(tutorial)
    press(button(shown, en.tutorialReplay))
    press(button(shown, en.tutorialReplay))
    await flush()
    press(button(ui(tutorial), en.tutorialRemove))
    await flush()

    expect(shown.find((node) => node.type === 'h3')?.props['style']).toBe(headingStyle)
    expect(tutorial.replay).toHaveBeenCalledOnce()
    expect(tutorial.remove).toHaveBeenCalledOnce()
    expect(ui(tutorial).some((node) => node.props['role'] === 'alert')).toBe(false)
  })
})

describe('tour anchors on the views', () => {
  it('marks only the first weekday row', () => {
    const tree = nodes(
      render(() =>
        WeekHoursCard({
          dark: false,
          lang: 'en',
          s,
          barberName: 'Hassan',
          week: defaultWeek(),
          status: { kind: 'idle' },
          onChange: () => undefined,
          onRetry: () => undefined,
        }),
      ),
    )
    const rows = anchored(tree, 'week-day')
    const isSwitch = (node: RenderedNode): boolean => node.type === WorkSwitch

    expect(rows).toHaveLength(1)
    expect(nodes(rows[0]).find(isSwitch)).toBe(tree.find(isSwitch))
  })

  it('marks the first service row, its move-down button and the add box', async () => {
    const service = (id: string, sortOrder: number) => ({
      id,
      barberId: 'hassan',
      name: id,
      price: 300,
      durationMin: 30,
      active: true,
      sortOrder,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6] as const,
    })
    const shown = async (count: number) => {
      reset()
      const port: ServicesViewPort = {
        createService: vi.fn(),
        deleteService: vi.fn(),
        listServices: vi.fn<ServicesViewPort['listServices']>(async () =>
          ok([service('a', 0), service('b', 1)].slice(0, count)),
        ),
        reorderService: vi.fn(),
        updateService: vi.fn(),
      }
      const view = () =>
        nodes(
          render(() =>
            ServicesView({
              dark: false,
              lang: 'en',
              s,
              barberId: 'hassan',
              barberName: 'Hassan',
              port,
            }),
          ),
        )
      view()
      commit()
      await flush()
      return view()
    }

    const two = await shown(2)
    const moveDown = two.filter((node) => node.props['aria-label'] === en.svcMoveDown)
    expect(anchored(two, 'service-active')).toHaveLength(1)
    expect(anchored(two, 'service-move')).toEqual([moveDown[0]])
    expect(anchored(two, 'service-new')).toHaveLength(1)
    const firstActive = anchored(two, 'service-active')[0]
    expect(nodes(firstActive).some((node) => node.props.children === en.svcActive)).toBe(true)

    const one = await shown(1)
    expect(anchored(one, 'service-active')).toHaveLength(1)
    expect(anchored(one, 'service-move')).toEqual([])
  })

  it('marks the first calendar connect only, never the access repair', () => {
    const calendar = (status: Partial<CalendarStatus>) => {
      vi.mocked(useCalendarSync).mockReturnValue({
        status: {
          connected: false,
          disconnectPending: false,
          repairRequired: false,
          googleEmail: null,
          lastSyncError: null,
          ...status,
        },
        loading: false,
        busy: false,
        error: null,
        connect: async () => undefined,
        disconnect: async () => undefined,
        refresh: async () => undefined,
      })
      return nodes(CalendarConnectButton({ s, dark: false, lang: 'en' }))
    }

    const connect = calendar({})
    expect(anchored(connect, 'calendar').map((node) => node.props.children)).toEqual([
      en.calendarConnect,
    ])
    expect(anchored(calendar({ connected: true, repairRequired: true }), 'calendar')).toEqual([])
  })
})

// What the layer's re-scroll leans on: a scroll that moved the page by the whole delta leaves a
// delta the `|delta| <= 1` guard refuses, so a fixed layout gets no second move.
describe('the step scroll', () => {
  const viewportHeight = 800
  const cardHeight = 180
  const delta = (target: Box, topInset: number): number =>
    scrollDelta({ hole: paddedBox(target), cardHeight, viewportHeight, topInset })
  const inBand = (target: Box, topInset: number): boolean => {
    const padded = paddedBox(target)
    return padded.top >= topInset && padded.top + padded.height <= viewportHeight
  }

  it.each([
    { name: 'below the fold', top: 1400, height: 60, topInset: 72, fits: true },
    { name: 'above the bar', top: -500, height: 60, topInset: 72, fits: true },
    { name: 'below, no bar', top: 1400, height: 60, topInset: 8, fits: true },
    { name: 'taller than the band', top: 1400, height: 900, topInset: 72, fits: false },
    { name: 'taller, no bar', top: -500, height: 900, topInset: 8, fits: false },
  ])('$name: one move, then nothing left to scroll', ({ top, height, topInset, fits }) => {
    const target: Box = { left: 24, top, width: 300, height }
    const first = delta(target, topInset)
    expect(Math.abs(first)).toBeGreaterThan(1)
    const moved: Box = { ...target, top: target.top - first }
    expect(Math.abs(delta(moved, topInset))).toBeLessThanOrEqual(1)
    expect(inBand(moved, topInset)).toBe(fits)
  })
})
