// Which tutorial tour a visit starts and how a running tour moves. Pure: no DOM, network or time.

import type { AdminTab } from '../adminTabs'
import { TOURS, type TourAnchor, type TourStep } from './tourSteps'

export const TOUR_IDS = ['overview', 'schedule', 'bookings', 'services', 'profile'] as const
export type TourId = (typeof TOUR_IDS)[number]

export interface TourProgress {
  readonly seen: ReadonlySet<TourId>
  readonly removed: boolean
}

export const FRESH_PROGRESS: TourProgress = { seen: new Set<TourId>(), removed: false }

export function withSeen(progress: TourProgress, tour: TourId): TourProgress {
  return { seen: new Set([...progress.seen, tour]), removed: progress.removed }
}

export function withRemoved(progress: TourProgress): TourProgress {
  return { seen: progress.seen, removed: true }
}

export function eligibleTour(tab: AdminTab, progress: TourProgress): TourId | null {
  if (progress.removed) return null
  switch (tab) {
    case 'schedule':
      if (!progress.seen.has('overview')) return 'overview'
      return progress.seen.has('schedule') ? null : 'schedule'
    case 'bookings':
    case 'services':
    case 'profile':
      return progress.seen.has('overview') && !progress.seen.has(tab) ? tab : null
    case 'allBookings':
    case 'barbers':
    case 'settings':
      return null
  }
}

export type TourSession =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting'; readonly tour: TourId }
  | {
      readonly kind: 'running'
      readonly tour: TourId
      readonly steps: readonly TourStep[]
      readonly index: number
    }
  | { readonly kind: 'settled' }

export type TourEvent =
  | { readonly kind: 'visit'; readonly tab: AdminTab }
  | { readonly kind: 'ready'; readonly present: ReadonlySet<TourAnchor> }
  | { readonly kind: 'gaveUp' }
  | { readonly kind: 'next' }
  | { readonly kind: 'back' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'lost'; readonly present: ReadonlySet<TourAnchor> }

/** `finished` is the tour to mark seen. */
export interface TourTransition {
  readonly session: TourSession
  readonly finished: TourId | null
}

type Running = Extract<TourSession, { readonly kind: 'running' }>

const SETTLED: TourSession = { kind: 'settled' }

const unchanged = (session: TourSession): TourTransition => ({ session, finished: null })

const finish = (tour: TourId): TourTransition => ({ session: SETTLED, finished: tour })

function start(tour: TourId, present: ReadonlySet<TourAnchor>): TourTransition {
  const steps = TOURS[tour].steps.filter((step) => present.has(step.anchor))
  return steps.length === 0
    ? finish(tour)
    : { session: { kind: 'running', tour, steps, index: 0 }, finished: null }
}

/** Stays on the current step, else the next one still present, else the last one left. */
function relocate(session: Running, present: ReadonlySet<TourAnchor>): TourTransition {
  const steps = session.steps.filter((step) => present.has(step.anchor))
  if (steps.length === session.steps.length) return unchanged(session)
  if (steps.length === 0) return finish(session.tour)
  const keptBefore = session.steps
    .slice(0, session.index)
    .filter((step) => present.has(step.anchor)).length
  const index = Math.min(keptBefore, steps.length - 1)
  return { session: { ...session, steps, index }, finished: null }
}

export function advance(
  session: TourSession,
  event: TourEvent,
  progress: TourProgress,
): TourTransition {
  switch (event.kind) {
    case 'visit': {
      const tour = eligibleTour(event.tab, progress)
      return { session: tour === null ? SETTLED : { kind: 'waiting', tour }, finished: null }
    }
    case 'ready':
      return session.kind === 'waiting' ? start(session.tour, event.present) : unchanged(session)
    case 'gaveUp':
      return session.kind === 'waiting' ? { session: SETTLED, finished: null } : unchanged(session)
    case 'next':
      if (session.kind !== 'running') return unchanged(session)
      return session.index + 1 < session.steps.length
        ? { session: { ...session, index: session.index + 1 }, finished: null }
        : finish(session.tour)
    case 'back':
      return session.kind === 'running' && session.index > 0
        ? { session: { ...session, index: session.index - 1 }, finished: null }
        : unchanged(session)
    case 'skip':
      return session.kind === 'running' ? finish(session.tour) : unchanged(session)
    case 'lost':
      return session.kind === 'running' ? relocate(session, event.present) : unchanged(session)
  }
}
