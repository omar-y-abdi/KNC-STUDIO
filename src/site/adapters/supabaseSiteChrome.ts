// The real (Supabase) SiteChromePort adapter. `load` reads `site_content` (this language's editable
// homepage + booking-popup strings) + `site_settings` (font sizes, business identity, SEO) and
// assembles a `SiteChrome`. Anon may select both (public-read RLS). Only known text keys are picked
// up; unknown/malformed rows are ignored. Any transport error resolves to `DEFAULT_CHROME`, so the
// site falls back to shipped defaults rather than crashing.
//
// Boundary discipline: every row Zod-parsed; the scale tokens narrowed via `parseScale` (unknown →
// 'md'), never trusted raw.

import { getSupabase } from '../../backend/supabaseClient'
import { parseWith, siteContentRow, siteSettingRow } from '../../backend/rpcSchemas'
import type { Lang } from '../../i18n/index'
import type { SiteChromePort } from '../port'
import {
  ABOUT_SCALE_KEY,
  DEFAULT_CHROME,
  HOMEPAGE_SCALE_KEY,
  SITE_TEXT_KEYS,
  parseScale,
  resolveBusinessSettings,
  type SiteChrome,
  type SiteTextKey,
} from '../siteChrome'

const TEXT_KEYS: ReadonlySet<string> = new Set(SITE_TEXT_KEYS)

export const supabaseSiteChromeAdapter: SiteChromePort = {
  async load(lang: Lang): Promise<SiteChrome> {
    try {
      const supabase = getSupabase()
      const [contentRes, settingsRes] = await Promise.all([
        supabase.from('site_content').select('key,lang,value').eq('lang', lang),
        supabase.from('site_settings').select('key,value'),
      ])
      if (contentRes.error !== null || settingsRes.error !== null) return DEFAULT_CHROME

      // Collect only the known text keys — the result is a valid SiteText (present-or-absent keys).
      const text: Partial<Record<SiteTextKey, string>> = {}
      for (const raw of contentRes.data ?? []) {
        const parsed = parseWith(siteContentRow, raw)
        if (parsed.ok && TEXT_KEYS.has(parsed.value.key)) {
          text[parsed.value.key as SiteTextKey] = parsed.value.value
        }
      }

      const settings: Record<string, string> = {}
      for (const raw of settingsRes.data ?? []) {
        const parsed = parseWith(siteSettingRow, raw)
        if (parsed.ok) settings[parsed.value.key] = parsed.value.value
      }

      return {
        text,
        business: resolveBusinessSettings(new Map(Object.entries(settings))),
        homepageScale: parseScale(settings[HOMEPAGE_SCALE_KEY]),
        aboutScale: parseScale(settings[ABOUT_SCALE_KEY]),
      }
    } catch {
      return DEFAULT_CHROME
    }
  },

  subscribe(lang: Lang, onChange: (chrome: SiteChrome) => void): () => void {
    const supabase = getSupabase()
    const reload = (): void => {
      void supabaseSiteChromeAdapter.load(lang).then(onChange)
    }
    const channel = supabase
      .channel(`site-chrome:${lang}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'site_content', filter: `lang=eq.${lang}` },
        reload,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, reload)
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  },
}
