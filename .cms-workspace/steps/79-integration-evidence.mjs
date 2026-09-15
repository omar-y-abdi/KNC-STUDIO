import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path,before,after) => { const file=resolve(root,path),source=readFileSync(file,'utf8'); if (!source.includes(before)) throw new Error(`Missing diagnostic anchor ${path}: ${before}`); writeFileSync(file,source.replace(before,after)) }
  edit('tests/integration/cmsStudio.test.ts', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNDsAAAAASUVORK5CYII=', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=')
  edit('tests/integration/cmsStudio.test.ts', '    const replies = await Promise.all([call(first), call(second)])', `    const replies = await Promise.all([call(first), call(second)])
    if (replies.some(reply => reply.status === 503)) {
      const missing = await service.rpc('internal_cms_missing_media', { p_actor: ownerId, p_references: [] })
      console.error('CMS_PUBLICATION_DIAGNOSTIC', JSON.stringify({ missingMediaCode: missing.error?.code, missingMediaMessage: missing.error?.message, missingMediaData: missing.data }))
      await withClient(env.dbUrl, async db => {
        await db.query('begin')
        try {
          await db.query('set local role service_role')
          await db.query('select public.internal_cms_publish($1,$2::jsonb,$3,$4,$5)', [ownerId, JSON.stringify(first.document), first.baseRevision, first.baseFingerprint, first.requestId])
          console.error('CMS_SQL_ROLLBACK_PROBE succeeded')
        } catch (reason) {
          const error = reason as { code?: string; message?: string; where?: string }
          console.error('CMS_SQL_ROLLBACK_PROBE', JSON.stringify({ code: error.code, message: error.message, where: error.where }))
        } finally { await db.query('rollback') }
      })
    }`)
}
