// Site-chrome admin adapter (owner-only writes). Reads/upserts the editable homepage text
// (`site_content`, PK key+lang) and public business/SEO/font-size settings (`site_settings`, PK
// key). Mirrors aboutAdmin exactly. Anon can read; only the owner may write (site_*_owner RLS).
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { parseWith, siteContentRows, siteSettingRows } from '../adminSchemas'
import type { Lang } from '../../i18n/index'
import type { AdminResult, AdminSiteContentCell, AdminSiteSetting } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa startsidan.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

/** Read every editable homepage cell (both languages). */
export async function listSiteContent(): Promise<AdminResult<readonly AdminSiteContentCell[]>> {
  try {
    const { data, error } = await getAdminClient().from('site_content').select('key,lang,value')
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(siteContentRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map((r) => ({ key: r.key, lang: r.lang, value: r.value })))
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Read every site setting as a `key -> value` map. */
export async function listSiteSettings(): Promise<AdminResult<ReadonlyMap<string, string>>> {
  try {
    const { data, error } = await getAdminClient().from('site_settings').select('key,value')
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(siteSettingRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    const settings: readonly AdminSiteSetting[] = parsed.value.map((r) => ({
      key: r.key,
      value: r.value,
    }))
    const map = new Map<string, string>()
    for (const setting of settings) map.set(setting.key, setting.value)
    return ok(map)
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Upsert one homepage text cell (owner-only). */
export async function saveSiteContent(
  key: string,
  lang: Lang,
  value: string,
): Promise<AdminResult<AdminSiteContentCell>> {
  try {
    const { data, error } = await getAdminClient()
      .from('site_content')
      .upsert({ key, lang, value }, { onConflict: 'key,lang' })
      .select('key,lang,value')
      .single()
    if (error !== null || data === null) return mapWriteError(error)
    return ok({ key, lang, value: typeof data.value === 'string' ? data.value : value })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Upsert one site setting (owner-only). */
export async function saveSiteSetting(key: string, value: string): Promise<AdminResult<null>> {
  try {
    const { error } = await getAdminClient()
      .from('site_settings')
      .upsert({ key, value }, { onConflict: 'key' })
    if (error !== null) return mapWriteError(error)
    return ok(null)
  } catch {
    return err('network', WRITE_ERROR)
  }
}

function mapWriteError(error: { code?: string } | null): AdminResult<never> {
  if (error?.code === '42501') return err('forbidden', 'Endast ägaren kan ändra startsidan.')
  if (error?.code === '23514') return err('validation', 'Texten är för lång.')
  return err('network', WRITE_ERROR)
}
