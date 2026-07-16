// The offline (mock) SiteChromePort: returns `DEFAULT_CHROME` (empty text overlay + 1.0× scales) for
// either language, so the public site renders entirely from its i18n defaults — byte-identical to
// today. Resolves synchronously-wrapped so the shell paints immediately (no flash).

import { DEFAULT_CHROME, type SiteChrome } from '../siteChrome'
import type { SiteChromePort } from '../port'

export const mockSiteChromeAdapter: SiteChromePort = {
  load(): Promise<SiteChrome> {
    return Promise.resolve(DEFAULT_CHROME)
  },
}
