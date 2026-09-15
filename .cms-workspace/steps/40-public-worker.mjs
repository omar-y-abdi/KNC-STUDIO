import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'src/worker.ts')
  let source = readFileSync(path, 'utf8')
  function replace(before, after) {
    if (!source.includes(before)) throw new Error(`Missing public Worker anchor: ${before.slice(0, 80)}`)
    source = source.replace(before, after)
  }
  source = "import { cmsPublicResponse, cmsResponsePolicy } from './cms/publicWorker'\n" + source
  replace('  const cleanPathname = withoutTrailingSlash(pathname)\n', '  const cleanPathname = withoutTrailingSlash(pathname)\n\n  const cms = await cmsPublicResponse(request, env, SITE_URL)\n  if (cms !== null) return cms\n')
  replace('    return fetchPublicContent(request, this.env)', '    return cmsResponsePolicy(await fetchPublicContent(request, this.env), new URL(request.url).pathname, this.env.SUPABASE_URL)')
  replace('    return fetchPublicContent(request, env)', '    return cmsResponsePolicy(await fetchPublicContent(request, env), url.pathname, env.SUPABASE_URL)')
  writeFileSync(path, source)
}
