// The public-copy swap point. Supabase when configured, offline defaults otherwise — chosen ONCE at
// module load. With no `VITE_SUPABASE_*` set, homepage and booking-popup copy stay byte-identical to
// the i18n baseline. The Supabase adapter is reached through a LAZY proxy so supabase-js stays out of
// the public critical path.

import { isBackendConfigured } from '../../backend/config'
import type { Lang } from '../../i18n/index'
import type { SiteChromePort } from '../port'
import type { SiteChrome } from '../siteChrome'
import { mockSiteChromeAdapter } from './mockSiteChrome'

const lazySupabaseSiteChromePort: SiteChromePort = {
  load: (lang: Lang): Promise<SiteChrome> =>
    import('./supabaseSiteChrome').then((m) => m.supabaseSiteChromeAdapter.load(lang)),
  subscribe: (lang, onChange) => {
    let unsubscribe = (): void => undefined
    let closed = false
    void import('./supabaseSiteChrome').then((m) => {
      const subscribe = m.supabaseSiteChromeAdapter.subscribe
      if (!closed && subscribe !== undefined) unsubscribe = subscribe(lang, onChange)
    })
    return () => {
      closed = true
      unsubscribe()
    }
  },
}

export const defaultSiteChromePort: SiteChromePort = isBackendConfigured()
  ? lazySupabaseSiteChromePort
  : mockSiteChromeAdapter

/** Whether the site chrome comes from the offline mock (no backend) — paint defaults immediately. */
export const siteChromeIsMock = !isBackendConfigured()
