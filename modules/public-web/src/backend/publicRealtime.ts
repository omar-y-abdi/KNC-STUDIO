// The public Realtime client. Live updates are an enhancement that starts after first content, so the
// library is loaded here, on the first subscription, and both subscribers (site chrome and booking
// catalog) share the one socket. The anonymous key is the only credential, as it was through the full
// client: the socket authenticates with it and no session is ever persisted.

import type { RealtimeClient } from '@supabase/realtime-js'
import { backgroundLoad } from './backgroundLoad'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { BACKEND_NOT_CONFIGURED, realtimeUrl } from './publicApi'

async function createRealtime(): Promise<RealtimeClient | null> {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(BACKEND_NOT_CONFIGURED)
  }
  const key = SUPABASE_ANON_KEY
  const library = await backgroundLoad(() => import('@supabase/realtime-js'))
  if (library === null) return null
  return new library.RealtimeClient(realtimeUrl(SUPABASE_URL), {
    params: { apikey: key },
    accessToken: () => Promise.resolve(key),
  })
}

/**
 * Memoized — created on first `getPublicRealtime()` call, and again after a failed attempt or one
 * that gave no client.
 */
let client: Promise<RealtimeClient | null> | undefined

/**
 * The shared public Realtime client; its library loads on the first call. Null when that load
 * failed because the page is leaving or offline (`backgroundLoad`): the page then has no live
 * updates, and the next call loads again.
 */
export function getPublicRealtime(): Promise<RealtimeClient | null> {
  client ??= createRealtime()
    .then((realtime) => {
      if (realtime === null) client = undefined
      return realtime
    })
    .catch((error: unknown) => {
      client = undefined
      throw error
    })
  return client
}
