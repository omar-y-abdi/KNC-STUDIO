// The staff tutorial's controller: progress through the port, at most one tour per visit, what was
// seen saved, and the actions of the Settings box. Without a port it does nothing.

import { useEffect, useRef, useState } from 'preact/hooks'
import type { TourProgressPort } from '../adapters/tourProgress'
import type { AdminTab } from '../adminTabs'
import { orderedAdminOperation } from '../orderedOperations'
import type { AdminResult } from '../types'
import { presentAnchors, waitForReady } from './tourDom'
import {
  advance,
  FRESH_PROGRESS,
  withRemoved,
  withSeen,
  type TourEvent,
  type TourProgress,
  type TourSession,
} from './tourModel'
import { TOURS, type TourAnchor } from './tourSteps'

const RESOURCE = 'staff:tour-progress'

export type RunningTour = Extract<TourSession, { readonly kind: 'running' }>

export interface TourControls {
  readonly running: RunningTour
  readonly next: () => void
  readonly back: () => void
  readonly skip: () => void
  readonly lost: (present: ReadonlySet<TourAnchor>) => void
}

export interface TutorialControls {
  readonly removed: boolean
  /** `false` when the save failed; nothing else changed then. */
  readonly replay: () => Promise<boolean>
  readonly remove: () => Promise<boolean>
}

export interface StaffTourInput {
  readonly port: TourProgressPort | undefined
  readonly tab: AdminTab
  readonly selectTab: (tab: AdminTab) => void
  readonly setMenuOpen: (open: boolean) => void
}

export interface StaffTour {
  /** Only while a tour runs. */
  readonly tour: TourControls | null
  /** Only once the progress is loaded. */
  readonly tutorial: TutorialControls | null
}

interface TourState {
  readonly progress: TourProgress | null
  readonly session: TourSession
}

const START: TourState = { progress: null, session: { kind: 'idle' } }

const write = (port: TourProgressPort, progress: TourProgress): Promise<AdminResult<void>> =>
  orderedAdminOperation(RESOURCE, () => port.write(progress))

export function useStaffTour(input: StaffTourInput): StaffTour {
  const { port } = input
  const [state, setState] = useState<TourState>(START)
  const [replays, setReplays] = useState(0)
  const latest = useRef<TourState>(START)
  const inputRef = useRef(input)
  inputRef.current = input
  const returnFocus = useRef<Element | null>(null)
  const mounted = useRef(false)

  const commit = (next: TourState): void => {
    latest.current = next
    setState(next)
  }

  const dispatch = (event: TourEvent): void => {
    const { progress, session } = latest.current
    if (port === undefined || progress === null) return
    const step = advance(session, event, progress)
    if (step.session === session && step.finished === null) return
    // Read before `inert` lands on the focused element and the browser drops its focus.
    if (step.session.kind === 'running' && session.kind !== 'running')
      returnFocus.current = document.activeElement
    const next = step.finished === null ? progress : withSeen(progress, step.finished)
    commit({ progress: next, session: step.session })
    if (step.finished !== null) void write(port, next)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (port === undefined) return
    let active = true
    void orderedAdminOperation(RESOURCE, () => port.read()).then((result) => {
      if (active && result.ok) commit({ progress: result.value, session: latest.current.session })
    })
    return () => {
      active = false
    }
  }, [port])

  const loaded = state.progress !== null
  useEffect(() => {
    if (loaded) dispatch({ kind: 'visit', tab: input.tab })
  }, [loaded, input.tab, replays])

  useEffect(() => {
    const session = state.session
    if (session.kind !== 'waiting') return
    const tour = session.tour
    return waitForReady(
      TOURS[tour].ready,
      () => dispatch({ kind: 'ready', present: presentAnchors(tour) }),
      () => dispatch({ kind: 'gaveUp' }),
    )
  }, [state.session])

  const touring = state.session.kind === 'running'
  useEffect(() => {
    if (!touring) return
    return () => {
      inputRef.current.setMenuOpen(false)
      const back = returnFocus.current
      returnFocus.current = null
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true })
    }
  }, [touring])

  const replay = async (): Promise<boolean> => {
    if (port === undefined) return false
    const result = await write(port, FRESH_PROGRESS)
    if (!result.ok) return false
    if (!mounted.current) return true
    commit({ progress: FRESH_PROGRESS, session: latest.current.session })
    setReplays((count) => count + 1)
    inputRef.current.selectTab('schedule')
    return true
  }

  const remove = async (): Promise<boolean> => {
    const progress = latest.current.progress
    if (port === undefined || progress === null) return false
    const next = withRemoved(progress)
    const result = await write(port, next)
    if (!result.ok) return false
    if (mounted.current) commit({ progress: next, session: latest.current.session })
    return true
  }

  const session = state.session
  return {
    tour:
      session.kind === 'running'
        ? {
            running: session,
            next: () => dispatch({ kind: 'next' }),
            back: () => dispatch({ kind: 'back' }),
            skip: () => dispatch({ kind: 'skip' }),
            lost: (present) => dispatch({ kind: 'lost', present }),
          }
        : null,
    tutorial:
      port === undefined || state.progress === null
        ? null
        : { removed: state.progress.removed, replay, remove },
  }
}
