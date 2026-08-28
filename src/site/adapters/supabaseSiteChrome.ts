// Public SiteChrome adapter. Initial anonymous reads use the lightweight Data API directly so
// rendering owner-edited copy does not pull the full Supabase JS client into the critical path.
// Realtime remains an opt-in dynamic import, started by useSiteChrome during idle time.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../backend/config'
import {
  parseWith,
  publicBusinessDiscoveryResponse,
  siteContentRow,
} from '../../backend/rpcSchemas'
import type { Lang } from '../../i18n/index'
import type { SiteChromePort } from '../port'
import {
  ABOUT_SCALE_KEY,
  HOMEPAGE_LOGO_PATH_KEY,
  HOMEPAGE_LOGO_SCALE_KEY,
  HOMEPAGE_LOGO_STYLE_KEY,
  HOMEPAGE_SCALE_KEY,
  SITE_TEXT_KEYS,
  parseScale,
  parseHomepageLogoPath,
  parseHomepageLogoStyle,
  resolveBusinessSettings,
  type SiteChrome,
  type SiteTextKey,
} from '../siteChrome'

const TEXT_KEYS: ReadonlySet<string> = new Set(SITE_TEXT_KEYS)

function apiHeaders(json = false): Headers | null {
  if (SUPABASE_ANON_KEY === undefined) return null
  const headers = new Headers({ apikey: SUPABASE_ANON_KEY })
  // Legacy anon keys are JWTs. PostgREST applies RLS from Authorization, not the apikey header.
  // New publishable keys are opaque and must not be sent as bearer tokens.
  if (SUPABASE_ANON_KEY.split('.').length === 3) {
    headers.set('Authorization', `Bearer ${SUPABASE_ANON_KEY}`)
  }
  if (json) headers.set('Content-Type', 'application/json')
  return headers
}

async function publicJson(url: URL, init?: RequestInit): Promise<unknown | null> {
  const headers = apiHeaders(init?.body !== undefined)
  if (headers === null) return null
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) return null
  return response.json()
}

function publicObjectUrl(bucket: string, path: string): string | null {
  if (SUPABASE_URL === undefined) return null
  return new URL(`/storage/v1/object/public/${bucket}/${path}`, SUPABASE_URL).toString()
}

async function loadSiteChrome(lang: Lang): Promise<SiteChrome | null> {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) return null

  try {
    const contentUrl = new URL('/rest/v1/site_content', SUPABASE_URL)
    contentUrl.searchParams.set('select', 'key,lang,value')
    contentUrl.searchParams.set('lang', `eq.${lang}`)
    const discoveryUrl = new URL('/rest/v1/rpc/public_business_discovery', SUPABASE_URL)

    const [contentData, discoveryData] = await Promise.all([
      publicJson(contentUrl),
      publicJson(discoveryUrl, { method: 'POST', body: '{}' }),
    ])
    if (!Array.isArray(contentData) || discoveryData === null) return null

    const discovery = parseWith(publicBusinessDiscoveryResponse, discoveryData)
    if (!discovery.ok) return null

    const text: Partial<Record<SiteTextKey, string>> = {}
    for (const raw of contentData) {
      const parsed = parseWith(siteContentRow, raw)
      if (parsed.ok && TEXT_KEYS.has(parsed.value.key)) {
        text[parsed.value.key as SiteTextKey] = parsed.value.value
      }
    }

    const settings = discovery.value.settings
    const logoPath = parseHomepageLogoPath(settings[HOMEPAGE_LOGO_PATH_KEY])

    return {
      text,
      business: resolveBusinessSettings(new Map(Object.entries(settings))),
      facts: {
        barbers: discovery.value.barbers,
        services: discovery.value.services.map((service) => ({
          id: service.id,
          barberId: service.barber_id,
          price: service.price,
        })),
        schedules: discovery.value.schedules.map((schedule) => ({
          barberId: schedule.barber_id,
          weekday: schedule.weekday,
          startMin: schedule.start_min,
          endMin: schedule.end_min,
        })),
      },
      homepageScale: parseScale(settings[HOMEPAGE_SCALE_KEY]),
      homepageLogo: {
        path: logoPath,
        url: logoPath === null ? null : publicObjectUrl('gallery', logoPath),
        scale: parseScale(settings[HOMEPAGE_LOGO_SCALE_KEY]),
        style: parseHomepageLogoStyle(settings[HOMEPAGE_LOGO_STYLE_KEY]),
      },
      aboutScale: parseScale(settings[ABOUT_SCALE_KEY]),
    }
  } catch {
    return null
  }
}

export const supabaseSiteChromeAdapter: SiteChromePort = {
  load: loadSiteChrome,

  subscribe(lang: Lang, onChange: (chrome: SiteChrome) => void): () => void {
    let closed = false
    let stop = (): void => undefined

    void import('../../backend/supabaseClient')
      .then(({ getSupabase }) => {
        if (closed) return
        const supabase = getSupabase()
        const reload = (): void => {
          void loadSiteChrome(lang).then((next) => {
            if (!closed && next !== null) onChange(next)
          })
        }
        const channel = supabase
          .channel(`site-chrome:${lang}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'site_content', filter: `lang=eq.${lang}` },
            reload,
          )
          .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, reload)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'barbers' }, reload)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, reload)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'barber_schedules' },
            reload,
          )
          .subscribe()

        stop = (): void => {
          void supabase.removeChannel(channel)
        }
      })
      .catch(() => undefined)

    return () => {
      closed = true
      stop()
    }
  },
}
