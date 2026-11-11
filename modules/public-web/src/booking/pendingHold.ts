/** Resolves once `ms` milliseconds have passed. */
export type Delay = (ms: number) => Promise<void>

export const timerDelay: Delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Where the flow runs: the public site, or a Studio scene or preview. */
export type FlowStage = 'live' | 'preview'

export type Motion = 'full' | 'reduced'

/** The shortest time the details popup says a booking is on its way, so it can be read. */
export const PENDING_MINIMUM_MS = 900

export function pendingMinimumMs(stage: FlowStage, motion: Motion): number {
  return stage === 'live' && motion === 'full' ? PENDING_MINIMUM_MS : 0
}

/** Started with a submit; its answer is handled once both have settled. */
export function pendingHold(minimumMs: number, delay: Delay): Promise<void> {
  return minimumMs > 0 ? delay(minimumMs) : Promise.resolve()
}
