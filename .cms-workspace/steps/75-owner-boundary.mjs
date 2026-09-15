import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'supabase/functions/cms-studio/index.ts')
  const source = readFileSync(path, 'utf8')
  const start = "    const profile = await service.from('profiles').select('role,account_enabled,must_change_password').eq('id', actor).maybeSingle()"
  const end = "    const body = await readBody(request)"
  const a = source.indexOf(start), b = source.indexOf(end, a)
  if (a < 0 || b < 0) throw new Error('Missing reproduced CMS owner gate')
  writeFileSync(path, source.slice(0, a) + `    // The database checks the current role, account status and forced-password gate.
    // No extra table/column privileges are needed by the service credential.
    const authorization = await service.rpc('internal_cms_assert_owner', { p_actor: actor })
    if (authorization.error) throw authorization.error
` + source.slice(b))
}
