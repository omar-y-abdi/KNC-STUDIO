// `useSiteChrome` — owner-editable public copy, business identity, SEO, and sizing as React state,
// refetched per language and updated when the owner changes `site_content` or `site_settings`.
//
// Under the MOCK (no backend): `DEFAULT_CHROME` is the immediate, stable value (no flash, no shift) —
// the site renders from its i18n defaults + 1.0× scale exactly as before. Under a BACKEND: the same
// default seeds the first paint, then the DB overlay replaces it once `load()` resolves (race-guarded,
// like the roster/availability effects). Any failure keeps the default.

import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import type { SiteChromePort } from './port'
import { DEFAULT_CHROME, type SiteChrome } from './siteChrome'
import { defaultSiteChromePort, siteChromeIsMock } from './adapters/index'

export function useSiteChrome(
  lang: Lang,
  port: SiteChromePort = defaultSiteChromePort,
): SiteChrome {
  const [chrome, setChrome] = useState<SiteChrome>(DEFAULT_CHROME)

  useEffect(() => {
    // Mock: the default IS the answer for both languages; never fetch (no flash/shift).
    if (siteChromeIsMock) return
    let cancelled = false
    void port
      .load(lang)
      .then((next) => {
        if (!cancelled) setChrome(next)
      })
      .catch(() => {
        if (!cancelled) setChrome(DEFAULT_CHROME)
      })
    const unsubscribe = port.subscribe?.(lang, (next) => {
      if (!cancelled) setChrome(next)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [lang, port])

  return chrome
}
