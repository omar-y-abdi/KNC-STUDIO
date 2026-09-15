import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path,before,after) => { const file=resolve(root,path),value=readFileSync(file,'utf8'); if (!value.includes(before)) throw new Error(`Missing retention anchor ${path}: ${before}`); writeFileSync(file,value.replace(before,after)) }
  const prepend = (path,text) => { const file=resolve(root,path); writeFileSync(file,text+readFileSync(file,'utf8')) }
  prepend('supabase/functions/_shared/externalActions.ts', "import { retainCmsObject } from './cmsRetention.ts'\n")
  edit('supabase/functions/_shared/externalActions.ts', "    case 'storage_object_delete': {\n      const removed", "    case 'storage_object_delete': {\n      if (await retainCmsObject(service, action.bucket, action.path)) return\n      const removed")
  prepend('supabase/functions/upload-image/index.ts', "import { retainCmsObject } from '../_shared/cmsRetention.ts'\n")
  edit('supabase/functions/upload-image/index.ts', '    const { error } = await service.storage.from(bucket).remove([path])', `    try { if (await retainCmsObject(service, bucket, path)) return true }
    catch { return false }
    const { error } = await service.storage.from(bucket).remove([path])`)
}
