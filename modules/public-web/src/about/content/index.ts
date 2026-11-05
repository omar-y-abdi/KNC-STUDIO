// The about-content swap point. Supabase when configured, the offline mock (an empty overlay → pure
// i18n copy) otherwise — chosen ONCE at module load. With no `VITE_SUPABASE_*` the About copy is
// byte-identical to today and resolves immediately. The Supabase adapter is reached through a LAZY
// proxy (dynamic import on first call) so supabase-js stays out of the public critical path.

import { isBackendConfigured } from '../../backend/config'
import type { Lang } from '../../i18n/index'
import type { AboutContentPort, AboutOverlay } from './port'
import { mockAboutContentAdapter } from './mockAboutContent'

const lazySupabaseAboutContentPort: AboutContentPort = {
  overlay: (lang: Lang): Promise<AboutOverlay> =>
    import('./supabaseAboutContent').then((m) => m.supabaseAboutContentAdapter.overlay(lang)),
}

export const defaultAboutContentPort: AboutContentPort = isBackendConfigured()
  ? lazySupabaseAboutContentPort
  : mockAboutContentAdapter

/** True when the About copy comes from the offline mock (i.e. no backend) — paint i18n immediately. */
export const aboutContentIsMock = !isBackendConfigured()
