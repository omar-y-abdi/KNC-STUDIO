// The "backend-ready" seam for the homepage chrome (Task 2 §2). A `SiteChromePort` loads the
// editable text overlay + the two font-size presets for one language. The public shells depend on
// this interface only; the implementations are the offline mock (defaults) and Supabase (reads
// site_content + site_settings).

import type { Lang } from '../i18n/index'
import type { SiteChrome } from './siteChrome'

export interface SiteChromePort {
  /** The homepage chrome for `lang`. Resolves to `DEFAULT_CHROME` under the mock. */
  load(lang: Lang): Promise<SiteChrome>
}
