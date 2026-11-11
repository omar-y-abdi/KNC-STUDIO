// The staff tutorial's pure core: which tour a visit offers and every transition of a session.

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AdminTab } from '../../modules/staff-admin/src/adminTabs'
import {
  advance,
  eligibleTour,
  FRESH_PROGRESS,
  TOUR_IDS,
  withRemoved,
  withSeen,
  type TourEvent,
  type TourId,
  type TourProgress,
  type TourSession,
} from '../../modules/staff-admin/src/tour/tourModel'
import { TOURS, type TourAnchor } from '../../modules/staff-admin/src/tour/tourSteps'

const ALL_TABS = [
  'schedule',
  'bookings',
  'services',
  'profile',
  'allBookings',
  'barbers',
  'settings',
] as const satisfies readonly AdminTab[]

const ALL_ANCHORS = [
  'nav',
  'nav-settings',
  'week-day',
  'day-hours',
  'breaks',
  'time-off',
  'calendar',
  'booking-sections',
  'service-active',
  'service-move',
  'service-new',
  'profile-upload',
  'profile-details',
  'profile-work',
] as const satisfies readonly TourAnchor[]
const EVERY_ANCHOR: ReadonlySet<TourAnchor> = new Set(ALL_ANCHORS)

const progressOf = (seen: readonly TourId[], removed = false): TourProgress => ({
  seen: new Set(seen),
  removed,
})
const OVERVIEW_SEEN = progressOf(['overview'])
const ALL_SEEN = progressOf(TOUR_IDS)

const [DAY_HOURS, BREAKS, TIME_OFF] = TOURS.schedule.steps
if (DAY_HOURS === undefined || BREAKS === undefined || TIME_OFF === undefined)
  throw new Error('the schedule tour has three steps')

const running = (index: number): TourSession => ({
  kind: 'running',
  tour: 'schedule',
  steps: [DAY_HOURS, BREAKS, TIME_OFF],
  index,
})
const anchors = (...names: readonly TourAnchor[]): ReadonlySet<TourAnchor> => new Set(names)

describe('eligibleTour', () => {
  it('the lists below name every tab and every anchor', () => {
    expectTypeOf<Exclude<AdminTab, (typeof ALL_TABS)[number]>>().toBeNever()
    expectTypeOf<Exclude<TourAnchor, (typeof ALL_ANCHORS)[number]>>().toBeNever()
  })

  // [fresh, overview seen, all seen, removed]
  const OFFERED: Readonly<Record<AdminTab, readonly (TourId | null)[]>> = {
    schedule: ['overview', 'schedule', null, null],
    bookings: [null, 'bookings', null, null],
    services: [null, 'services', null, null],
    profile: [null, 'profile', null, null],
    allBookings: [null, null, null, null],
    barbers: [null, null, null, null],
    settings: [null, null, null, null],
  }

  it.each(ALL_TABS)('%s against fresh, overview-seen, all-seen and removed progress', (tab) => {
    expect([
      eligibleTour(tab, FRESH_PROGRESS),
      eligibleTour(tab, OVERVIEW_SEEN),
      eligibleTour(tab, ALL_SEEN),
      eligibleTour(tab, withRemoved(FRESH_PROGRESS)),
    ]).toEqual(OFFERED[tab])
  })

  it.each(ALL_TABS)('%s offers nothing once removed, whatever was seen', (tab) => {
    expect(eligibleTour(tab, withRemoved(OVERVIEW_SEEN))).toBeNull()
    expect(eligibleTour(tab, progressOf(['overview', 'schedule'], true))).toBeNull()
  })

  it('offers the overview on the schedule tab before the schedule tour', () => {
    expect(eligibleTour('schedule', progressOf(['schedule']))).toBe('overview')
    expect(eligibleTour('schedule', progressOf(['overview', 'bookings']))).toBe('schedule')
  })

  it.each(['bookings', 'services', 'profile'] as const)(
    '%s needs the overview first, even when every other tour is seen',
    (tab) => {
      const allButOverview = TOUR_IDS.filter((id) => id !== 'overview' && id !== tab)
      expect(eligibleTour(tab, progressOf(allButOverview))).toBeNull()
      expect(eligibleTour(tab, progressOf([...allButOverview, 'overview']))).toBe(tab)
    },
  )
})

describe('withSeen / withRemoved', () => {
  it('withSeen adds the tour and leaves its input as it was', () => {
    const input = progressOf(['overview'])
    expect(withSeen(input, 'profile')).toEqual(progressOf(['overview', 'profile']))
    expect([...input.seen]).toEqual(['overview'])
    expect(input.removed).toBe(false)
  })

  it('withSeen keeps removed', () => {
    expect(withSeen(progressOf([], true), 'overview')).toEqual(progressOf(['overview'], true))
  })

  it('withSeen leaves the shared fresh progress empty', () => {
    withSeen(FRESH_PROGRESS, 'overview')
    expect(FRESH_PROGRESS.seen.size).toBe(0)
    expect(FRESH_PROGRESS.removed).toBe(false)
  })

  it('withRemoved sets removed, keeps seen and leaves its input as it was', () => {
    const input = progressOf(['overview', 'bookings'])
    expect(withRemoved(input)).toEqual(progressOf(['overview', 'bookings'], true))
    expect(input.removed).toBe(false)
    expect([...input.seen]).toEqual(['overview', 'bookings'])
  })
})

describe('advance', () => {
  it.each<TourSession>([
    { kind: 'idle' },
    { kind: 'waiting', tour: 'bookings' },
    { kind: 'settled' },
  ])('visit from %o waits for the eligible tour', (session) => {
    expect(advance(session, { kind: 'visit', tab: 'schedule' }, FRESH_PROGRESS)).toEqual({
      session: { kind: 'waiting', tour: 'overview' },
      finished: null,
    })
  })

  it('visit settles when the tab offers nothing', () => {
    expect(advance({ kind: 'idle' }, { kind: 'visit', tab: 'settings' }, FRESH_PROGRESS)).toEqual({
      session: { kind: 'settled' },
      finished: null,
    })
  })

  it('visit from running resets the session and does not mark the interrupted tour seen', () => {
    expect(advance(running(1), { kind: 'visit', tab: 'bookings' }, OVERVIEW_SEEN)).toEqual({
      session: { kind: 'waiting', tour: 'bookings' },
      finished: null,
    })
    expect(advance(running(1), { kind: 'visit', tab: 'settings' }, OVERVIEW_SEEN)).toEqual({
      session: { kind: 'settled' },
      finished: null,
    })
  })

  it('ready while waiting runs every present step from the first', () => {
    const waiting: TourSession = { kind: 'waiting', tour: 'schedule' }
    expect(advance(waiting, { kind: 'ready', present: EVERY_ANCHOR }, ALL_SEEN)).toEqual({
      session: running(0),
      finished: null,
    })
  })

  it('ready keeps the step order and drops absent anchors', () => {
    const waiting: TourSession = { kind: 'waiting', tour: 'schedule' }
    const present = anchors('time-off', 'week-day', 'day-hours')
    expect(advance(waiting, { kind: 'ready', present }, FRESH_PROGRESS)).toEqual({
      session: { kind: 'running', tour: 'schedule', steps: [DAY_HOURS, TIME_OFF], index: 0 },
      finished: null,
    })
  })

  it('ready with no available step finishes the tour without running it', () => {
    const waiting: TourSession = { kind: 'waiting', tour: 'profile' }
    const present = anchors()
    expect(advance(waiting, { kind: 'ready', present }, OVERVIEW_SEEN)).toEqual({
      session: { kind: 'settled' },
      finished: 'profile',
    })
  })

  it('gaveUp while waiting settles without marking the tour seen', () => {
    const waiting: TourSession = { kind: 'waiting', tour: 'services' }
    expect(advance(waiting, { kind: 'gaveUp' }, OVERVIEW_SEEN)).toEqual({
      session: { kind: 'settled' },
      finished: null,
    })
  })

  it('next moves one step on', () => {
    expect(advance(running(0), { kind: 'next' }, FRESH_PROGRESS)).toEqual({
      session: running(1),
      finished: null,
    })
  })

  it('next on the last step finishes the tour', () => {
    expect(advance(running(2), { kind: 'next' }, FRESH_PROGRESS)).toEqual({
      session: { kind: 'settled' },
      finished: 'schedule',
    })
  })

  it('back moves one step back', () => {
    expect(advance(running(2), { kind: 'back' }, FRESH_PROGRESS)).toEqual({
      session: running(1),
      finished: null,
    })
  })

  it('back on the first step is a no-op', () => {
    const first = running(0)
    const transition = advance(first, { kind: 'back' }, FRESH_PROGRESS)
    expect(transition.session).toBe(first)
    expect(transition.finished).toBeNull()
  })

  it.each([0, 1, 2])('skip on step %i finishes the tour', (index) => {
    expect(advance(running(index), { kind: 'skip' }, FRESH_PROGRESS)).toEqual({
      session: { kind: 'settled' },
      finished: 'schedule',
    })
  })

  it('lost stays on the current step when it is still there', () => {
    const present = anchors('breaks', 'time-off')
    expect(advance(running(2), { kind: 'lost', present }, FRESH_PROGRESS)).toEqual({
      session: { kind: 'running', tour: 'schedule', steps: [BREAKS, TIME_OFF], index: 1 },
      finished: null,
    })
  })

  it('lost moves to the first remaining step after a vanished current step', () => {
    expect(
      advance(running(1), { kind: 'lost', present: anchors('day-hours', 'time-off') }, ALL_SEEN),
    ).toEqual({
      session: { kind: 'running', tour: 'schedule', steps: [DAY_HOURS, TIME_OFF], index: 1 },
      finished: null,
    })
    expect(advance(running(0), { kind: 'lost', present: anchors('time-off') }, ALL_SEEN)).toEqual({
      session: { kind: 'running', tour: 'schedule', steps: [TIME_OFF], index: 0 },
      finished: null,
    })
  })

  it('lost moves to the last remaining step when nothing after the current one is left', () => {
    expect(
      advance(running(2), { kind: 'lost', present: anchors('day-hours', 'breaks') }, ALL_SEEN),
    ).toEqual({
      session: { kind: 'running', tour: 'schedule', steps: [DAY_HOURS, BREAKS], index: 1 },
      finished: null,
    })
  })

  it('lost with no step left finishes the tour', () => {
    expect(advance(running(1), { kind: 'lost', present: anchors('week-day') }, ALL_SEEN)).toEqual({
      session: { kind: 'settled' },
      finished: 'schedule',
    })
  })

  it('lost with every step still present keeps the same session', () => {
    const session = running(1)
    const transition = advance(session, { kind: 'lost', present: EVERY_ANCHOR }, ALL_SEEN)
    expect(transition.session).toBe(session)
    expect(transition.finished).toBeNull()
  })

  const READY: TourEvent = { kind: 'ready', present: EVERY_ANCHOR }
  const LOST: TourEvent = { kind: 'lost', present: anchors() }
  const RUNNING_ONLY: readonly TourEvent[] = [
    { kind: 'next' },
    { kind: 'back' },
    { kind: 'skip' },
    LOST,
  ]
  const pairs = (
    session: TourSession,
    events: readonly TourEvent[],
  ): readonly (readonly [TourSession, TourEvent])[] => events.map((event) => [session, event])

  it.each([
    ...pairs({ kind: 'idle' }, [READY, { kind: 'gaveUp' }, ...RUNNING_ONLY]),
    ...pairs({ kind: 'settled' }, [READY, { kind: 'gaveUp' }, ...RUNNING_ONLY]),
    ...pairs({ kind: 'waiting', tour: 'overview' }, RUNNING_ONLY),
    ...pairs(running(1), [READY, { kind: 'gaveUp' }]),
  ])('%o ignores %o: same session object, nothing finished', (session, event) => {
    const transition = advance(session, event, FRESH_PROGRESS)
    expect(transition.session).toBe(session)
    expect(transition.finished).toBeNull()
  })
})

describe('a barber walking through every tour', () => {
  /** Visit a tab, show every present step and press next to the end. */
  function walk(
    tab: AdminTab,
    progress: TourProgress,
  ): { readonly finished: TourId | null; readonly progress: TourProgress } {
    let transition = advance({ kind: 'idle' }, { kind: 'visit', tab }, progress)
    if (transition.session.kind === 'waiting')
      transition = advance(transition.session, { kind: 'ready', present: EVERY_ANCHOR }, progress)
    for (let presses = 0; transition.session.kind === 'running' && presses < 10; presses += 1)
      transition = advance(transition.session, { kind: 'next' }, progress)
    expect(transition.session).toEqual({ kind: 'settled' })
    const { finished } = transition
    return { finished, progress: finished === null ? progress : withSeen(progress, finished) }
  }

  it('sees the overview, the schedule tour on the next visit, then each section once', () => {
    const first = walk('schedule', FRESH_PROGRESS)
    expect(first.finished).toBe('overview')
    expect(first.progress).toEqual(progressOf(['overview']))

    const second = walk('schedule', first.progress)
    expect(second.finished).toBe('schedule')
    expect(second.progress).toEqual(progressOf(['overview', 'schedule']))

    const bookings = walk('bookings', second.progress)
    const services = walk('services', bookings.progress)
    const profile = walk('profile', services.progress)
    expect([bookings.finished, services.finished, profile.finished]).toEqual([
      'bookings',
      'services',
      'profile',
    ])
    expect(profile.progress).toEqual(ALL_SEEN)

    for (const tab of ALL_TABS) expect(walk(tab, profile.progress).finished).toBeNull()
  })

  it('shows the overview steps in order', () => {
    let transition = advance(
      { kind: 'waiting', tour: 'overview' },
      { kind: 'ready', present: EVERY_ANCHOR },
      FRESH_PROGRESS,
    )
    const shown: TourAnchor[] = []
    while (transition.session.kind === 'running') {
      const step = transition.session.steps[transition.session.index]
      if (step !== undefined) shown.push(step.anchor)
      transition = advance(transition.session, { kind: 'next' }, FRESH_PROGRESS)
    }
    expect(shown).toEqual(['nav', 'week-day', 'nav-settings'])
    expect(transition.finished).toBe('overview')
  })
})
