import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'supabase/migrations/20260915030000_unified_cms.sql')
  const source = readFileSync(path, 'utf8')
  const invalid = "row_data->>'contact_lead)"
  if (!source.includes(invalid)) throw new Error('Missing reproduced CMS SQL syntax defect')
  writeFileSync(path, source.replace(invalid, "row_data->>'contact_lead')"))
}
