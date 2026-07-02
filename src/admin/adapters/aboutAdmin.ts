// About-content admin adapter (owner-only writes). Reads every (key,lang) cell and upserts edits
// (PK key+lang). Anon can read; only the owner may write (about_*_owner RLS policies). The public
// site does NOT consume this yet (that's §5) — this adapter only powers the admin "Om oss" editor.
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { aboutRow, aboutRows, parseWith } from '../adminSchemas'
import type { Lang } from '../../i18n/index'
import type { AboutKey, AboutRow, AdminResult } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa innehållet.'
const WRITE_ERROR = 'Kunde inte spara texten. Försök igen.'

/** Read every about-content cell (both languages, all keys). */
export async function listAbout(): Promise<AdminResult<readonly AboutRow[]>> {
  try {
    const { data, error } = await getAdminClient().from('about_content').select('key,lang,value')
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(aboutRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map((r) => ({ key: r.key, lang: r.lang, value: r.value })))
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Upsert one cell's value (owner-only). Returns the saved row. */
export async function saveAbout(
  key: AboutKey,
  lang: Lang,
  value: string,
): Promise<AdminResult<AboutRow>> {
  try {
    const { data, error } = await getAdminClient()
      .from('about_content')
      .upsert({ key, lang, value }, { onConflict: 'key,lang' })
      .select('key,lang,value')
      .single()
    if (error !== null || data === null) {
      if (error?.code === '42501') return err('forbidden', 'Endast ägaren kan ändra texten.')
      return err('network', WRITE_ERROR)
    }
    const parsed = parseWith(aboutRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok({ key: parsed.value.key, lang: parsed.value.lang, value: parsed.value.value })
  } catch {
    return err('network', WRITE_ERROR)
  }
}
