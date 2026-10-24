/**
 * Runs `run`, waits one task for Node to report rejections nobody handled, and returns their
 * reasons. Vitest fails the whole run on an unhandled rejection, so its own listeners are set aside
 * while this one collects and put back afterwards.
 */
export async function unhandledRejectionsDuring(run: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = []
  const collect = (reason: unknown): void => {
    reasons.push(reason)
  }
  const setAside = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', collect)
  try {
    await run()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off('unhandledRejection', collect)
    for (const listener of setAside) process.on('unhandledRejection', listener)
  }
  return reasons
}
