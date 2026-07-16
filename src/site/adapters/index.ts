// The site-chrome swap point. Supabase when configured, the offline mock (defaults) otherwise —
// chosen ONCE at module load. With no `VITE_SUPABASE_*` set this is the mock, so the homepage chrome
// is byte-identical to the i18n baseline and resolves immediately. The Supabase adapter is reached
// through a LAZY proxy (dynamic import on first call) so supabase-js stays out of the critical path.

import { isBackendConfigured } from '../../backend/config'
import type { Lang } from '../../i18n/index'
import type { SiteChromePort } from '../port'
import type { SiteChrome } from '../siteChrome'
import { mockSiteChromeAdapter } from './mockSiteChrome'

const lazySupabaseSiteChromePort: SiteChromePort = {
  load: (lang: Lang): Promise<SiteChrome> =>
    import('./supabaseSiteChrome').then((m) => m.supabaseSiteChromeAdapter.load(lang)),
}

export const defaultSiteChromePort: SiteChromePort = isBackendConfigured()
  ? lazySupabaseSiteChromePort
  : mockSiteChromeAdapter

/** Whether the site chrome comes from the offline mock (no backend) — paint defaults immediately. */
export const siteChromeIsMock = !isBackendConfigured()
