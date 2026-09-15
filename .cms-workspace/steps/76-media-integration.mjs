import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path, before, after) => { const file=resolve(root,path),source=readFileSync(file,'utf8'); if (!source.includes(before)) throw new Error(`Missing media anchor ${path}: ${before}`); writeFileSync(file,source.replace(before,after)) }
  edit('supabase/functions/upload-image/index.ts', "import { createClient }", "import { handleCmsUpload, CmsMediaUnavailable } from './cmsUpload.ts'\nimport { createClient }")
  edit('supabase/functions/upload-image/index.ts', '  const upload = parseUpload(form)', `  if (form.get('kind') === 'cms_asset') {
    return handleCmsUpload(form, callerData.user.id, service, async (input, profile) => {
      try { await ensureImageMagickReady() }
      catch { throw new CmsMediaUnavailable('Image decoder unavailable') }
      const bytes = processImage(input, profile ? 'barber_photo' : 'gallery')
      const dimensions = ImageMagick.read(bytes, image => ({ width: image.width, height: image.height }))
      return { bytes, ...dimensions }
    }, json)
  }
  const upload = parseUpload(form)`)
  const edge='supabase/functions/cms-studio/index.ts'
  const file=resolve(root,edge),source=readFileSync(file,'utf8')
  const start=source.indexOf("    const inventory = await service.from('cms_assets').select('bucket,path')")
  const end=source.indexOf('    validateDocument(document)',start)
  if (start<0||end<0) throw new Error('Missing exact-reference validation replacement')
  writeFileSync(file,source.slice(0,start)+`    const inventory = await service.rpc('internal_cms_missing_media', { p_actor: actor, p_references: referenceKeys.map(key => ({ bucket: key.slice(0, key.indexOf('/')), path: key.slice(key.indexOf('/') + 1) })) })
    if (inventory.error) throw inventory.error
    if (!Array.isArray(inventory.data)) throw new Error('Invalid media validation result')
    if (inventory.data.length) throw new CmsValidationError('media', 'En refererad fil saknas eller är inte registrerad. Välj filen på nytt i biblioteket.')
`+source.slice(end))
}
