import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'tests/integration/cmsStudio.test.ts')
  const source = readFileSync(path, 'utf8')
  const anchor = "  expect(result.status, await result.clone().text()).toBe(200)"
  if (!source.includes(anchor)) throw new Error('Missing real CMS state diagnostic point')
  writeFileSync(path, source.replace(anchor, `  if (result.status !== 200) {
    const profile = await withClient(env.dbUrl, db => db.query('select role,account_enabled,must_change_password from public.profiles where id=$1', [ownerId]))
    const identity = await service.auth.getUser(ownerToken)
    const rpc = await service.rpc('internal_cms_state', { p_actor: ownerId })
    console.error('CMS_STATE_DIAGNOSTIC', JSON.stringify({ profile: profile.rows[0], identityMatches: identity.data.user?.id === ownerId, rpcCode: rpc.error?.code, rpcMessage: rpc.error?.message }))
  }
${anchor}`))
}
