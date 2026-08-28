// `useSiteChrome` — owner-editable public copy, business identity, SEO, and sizing as React state,
// refetched per language and updated when the owner changes public CMS/business tables. Realtime is
// visibility-gated so hidden tabs do not retain a socket; returning to the page also revalidates.
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
import { scheduleIdle } from '../ui/idle'

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
    let unsubscribe: (() => void) | undefined
    let cancelIdle = (): void => undefined

    const load = (): void => {
      void port
        .load(lang)
        .then((next) => {
          if (!cancelled && next !== null) setCache((current) => ({ ...current, [lang]: next }))
        })
        .catch(() => undefined)
    }
    const stopSubscription = (): void => {
      cancelIdle()
      cancelIdle = (): void => undefined
      unsubscribe?.()
      unsubscribe = undefined
    }
    const startSubscription = (): void => {
      if (cancelled || port.subscribe === undefined || document.visibilityState === 'hidden') return
      cancelIdle = scheduleIdle(() => {
        if (cancelled || document.visibilityState === 'hidden' || unsubscribe !== undefined) return
        unsubscribe = port.subscribe?.(lang, (next) => {
          if (!cancelled) setCache((current) => ({ ...current, [lang]: next }))
        })
      })
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        stopSubscription()
        return
      }
      // Revalidate after a hidden period because Realtime intentionally was not connected there.
      load()
      startSubscription()
    }

    load()
    startSubscription()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopSubscription()
    }
  }, [lang, port])

  return resolveSiteChromeSnapshot(cache, lang, siteChromeIsMock)
}
