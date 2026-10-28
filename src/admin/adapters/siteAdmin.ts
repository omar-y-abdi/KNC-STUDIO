// Site-settings admin adapter (owner-only writes). Reads and upserts rows of `site_settings` (PK
// key) that are not part of the reversible CMS document, such as the cancellation window. Anon can
// read; only the owner may write (site_*_owner RLS).
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { parseWith, siteSettingRows } from '../adminSchemas'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa inställningarna.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

/** Read every site setting as a `key -> value` map. */
export async function listSiteSettings(): Promise<AdminResult<ReadonlyMap<string, string>>> {
  try {
    const { data, error } = await getAdminClient().from('site_settings').select('key,value')
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(siteSettingRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    const map = new Map<string, string>()
    for (const row of parsed.value) map.set(row.key, row.value)
    return ok(map)
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Upsert one site setting (owner-only). */
export async function saveSiteSetting(key: string, value: string): Promise<AdminResult<string>> {
  try {
    const { data, error } = await getAdminClient()
      .from('site_settings')
      .upsert({ key, value }, { onConflict: 'key' })
      .select('key,value')
      .single()
    if (error !== null || data === null) return mapWriteError(error)
    return data.key === key && typeof data.value === 'string'
      ? ok(data.value)
      : err('malformed', WRITE_ERROR)
  } catch {
    return err('network', WRITE_ERROR)
  }
}

function mapWriteError(error: { code?: string } | null): AdminResult<never> {
  if (error?.code === '42501') return err('forbidden', 'Endast ägaren kan ändra inställningen.')
  if (error?.code === '23514' || error?.code === '22023') {
    return err('validation', 'Kontrollera att inställningen har ett giltigt format.')
  }
  return err('network', WRITE_ERROR)
}
