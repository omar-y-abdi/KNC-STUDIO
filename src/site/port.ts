// The "backend-ready" seam for owner-editable public copy (Task 2 §2). A `SiteChromePort` loads the
// homepage overlay, booking-popup text, and two font-size presets for one language. Public shells
// depend on this interface only; implementations are the offline mock (defaults) and Supabase
// (`site_content` + `site_settings`).

import type { Lang } from '../i18n/index'
import type { SiteChrome } from './siteChrome'

export interface SiteChromePort {
  /** The homepage chrome for `lang`. Resolves to `DEFAULT_CHROME` under the mock. */
  load(lang: Lang): Promise<SiteChrome>
  /** Subscribe an open public page to owner edits. Omitted by static/offline adapters. */
  subscribe?(lang: Lang, onChange: (chrome: SiteChrome) => void): () => void
}
