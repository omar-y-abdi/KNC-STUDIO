// The public Realtime client. Live updates are an enhancement that starts after first content, so the
// library is loaded here, on the first subscription, and both subscribers (site chrome and booking
// catalog) share the one socket. The anonymous key is the only credential, as it was through the full
// client: the socket authenticates with it and no session is ever persisted.

import type { RealtimeClient } from '@supabase/realtime-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { BACKEND_NOT_CONFIGURED, realtimeUrl } from './publicApi'

async function createRealtime(): Promise<RealtimeClient> {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(BACKEND_NOT_CONFIGURED)
  }
  const key = SUPABASE_ANON_KEY
  const { RealtimeClient: Client } = await import('@supabase/realtime-js')
  return new Client(realtimeUrl(SUPABASE_URL), {
    params: { apikey: key },
    accessToken: () => Promise.resolve(key),
  })
}

/** Memoized — created on first `getPublicRealtime()` call, and again after a failed attempt. */
let client: Promise<RealtimeClient> | undefined

/** The shared public Realtime client; its library loads on the first call. */
export function getPublicRealtime(): Promise<RealtimeClient> {
  client ??= createRealtime().catch((error: unknown) => {
    client = undefined
    throw error
  })
  return client
}
