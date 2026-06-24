// The real (Supabase) AboutContentPort adapter. `overlay` reads `about_content` for one language
// (anon may select all — the `about_content` public-select RLS policy) and builds a partial overlay
// of the 7 editable keys. Only rows that parse are included; any malformed row is DROPPED (the
// component keeps the i18n default for that key). A transport error resolves to an EMPTY overlay, so
// the section falls back entirely to i18n rather than crashing.
//
// Boundary discipline: every row is Zod-parsed (the `key` is guarded into the closed set), never
// trusted raw.

import { getSupabase } from '../../backend/supabaseClient'
import { aboutContentRow, parseWith } from '../../backend/rpcSchemas'
import type { Lang } from '../../i18n/index'
import type { AboutContentPort, AboutOverlay } from './port'

export const supabaseAboutContentAdapter: AboutContentPort = {
  async overlay(lang: Lang): Promise<AboutOverlay> {
    try {
      const { data, error } = await getSupabase()
        .from('about_content')
        .select('key,lang,value')
        .eq('lang', lang)
      if (error !== null || data === null) return {}

      // Build the overlay key-by-key; a malformed row is skipped (i18n default stays for that key).
      const overlay: Record<string, string> = {}
      for (const raw of data) {
        const parsed = parseWith(aboutContentRow, raw)
        if (parsed.ok) overlay[parsed.value.key] = parsed.value.value
      }
      return overlay
    } catch {
      return {}
    }
  },
}
