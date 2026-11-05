// Background loads (the live-update client, the booking-catalog preload and the adapter imports of
// both live-update subscriptions) run while the visitor may already be leaving. WebKit cancels a
// leaving page's pending loads while that page still runs script, and a load fails the same way
// when the network is gone. Neither is a fault of the page, which works without what such a load
// brings, so the load gives null. Every other failure rejects unchanged, for the caller to surface.

/**
 * Runs `load` for a page that may be leaving. Gives null when it fails after a `beforeunload` that
 * fired during the load, or while the browser reports no network, and rethrows any other failure.
 * A navigation that does not happen after all (a download, a cancelled prompt) costs only this
 * attempt.
 */
export async function backgroundLoad<T>(load: () => Promise<T>): Promise<T | null> {
  let leaving = false
  const leave = (): void => {
    leaving = true
  }
  window.addEventListener('beforeunload', leave)
  try {
    return await load()
  } catch (error) {
    if (leaving || !navigator.onLine) return null
    throw error
  } finally {
    window.removeEventListener('beforeunload', leave)
  }
}
