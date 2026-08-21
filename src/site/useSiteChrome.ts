// `useSiteChrome` — owner-editable public copy, business identity, SEO, and sizing as React state,
// refetched per language and updated when the owner changes `site_content` or `site_settings`.
//
// Under the MOCK (no backend): `DEFAULT_CHROME` is the immediate, stable value (no flash, no shift) —
// the site renders from its i18n defaults + 1.0× scale exactly as before. Under a BACKEND: the same
// default seeds visible content, then the DB overlay replaces it once `load()` resolves
// (race-guarded, like the roster/availability effects). Metadata is not client-replaced until that
// language has resolved, preserving complete Worker-rendered JSON-LD when the backend is unavailable.

import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import type { SiteChromePort } from './port'
import { DEFAULT_CHROME, type SiteChrome } from './siteChrome'
import { defaultSiteChromePort, siteChromeIsMock } from './adapters/index'

export interface SiteChromeSnapshot {
  readonly chrome: SiteChrome
  readonly metadataReady: boolean
}

type SiteChromeCache = Readonly<Partial<Record<Lang, SiteChrome>>>

export function resolveSiteChromeSnapshot(
  cache: SiteChromeCache,
  lang: Lang,
  isMock: boolean,
): SiteChromeSnapshot {
  const resolved = cache[lang]
  return {
    chrome: resolved ?? DEFAULT_CHROME,
    metadataReady: isMock || resolved !== undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function canReplaceDocumentMetadata(
  metadataReady: boolean,
  initialStructuredData: string | null,
): boolean {
  if (metadataReady) return true
  if (initialStructuredData === null) return true
  try {
    const value: unknown = JSON.parse(initialStructuredData)
    if (!isRecord(value) || value['@type'] !== 'HairSalon') return true
    const address = value['address']
    return !(
      typeof value['name'] === 'string' &&
      value['name'].trim() !== '' &&
      isRecord(address) &&
      typeof address['streetAddress'] === 'string' &&
      address['streetAddress'].trim() !== ''
    )
  } catch {
    return true
  }
}

export function useSiteChrome(
  lang: Lang,
  port: SiteChromePort = defaultSiteChromePort,
): SiteChromeSnapshot {
  const [cache, setCache] = useState<SiteChromeCache>(() =>
    siteChromeIsMock ? { sv: DEFAULT_CHROME, en: DEFAULT_CHROME } : {},
  )

  useEffect(() => {
    // Mock: the default IS the answer for both languages; never fetch (no flash/shift).
    if (siteChromeIsMock) return
    let cancelled = false
    void port
      .load(lang)
      .then((next) => {
        if (!cancelled && next !== null) setCache((current) => ({ ...current, [lang]: next }))
      })
      .catch(() => undefined)
    const unsubscribe = port.subscribe?.(lang, (next) => {
      if (!cancelled) setCache((current) => ({ ...current, [lang]: next }))
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [lang, port])

  return resolveSiteChromeSnapshot(cache, lang, siteChromeIsMock)
}
