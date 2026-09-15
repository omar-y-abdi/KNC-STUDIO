import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path, before, after) => {
    const file = resolve(root,path), source = readFileSync(file,'utf8')
    if (!source.includes(before)) throw new Error(`Missing font integration anchor ${path}: ${before}`)
    writeFileSync(file,source.replace(before,after))
  }
  edit('shared/cms.ts', 'export interface CmsPresentation {', 'export interface CmsPresentation {\n  fonts?: Record<string, { ref: MediaRef; name: string }>')
  edit('shared/cms.ts', "keys(p, ['copy', 'styles', 'images', 'themes', 'pages', 'regions'], 'presentation')", `keys(p, ['copy', 'styles', 'images', 'themes', 'pages', 'regions', 'fonts'], 'presentation')
  const fonts = p.fonts === undefined ? {} : object(p.fonts, 'fonts')
  if (Object.keys(fonts).length > 30) fail('fonts', 'At most 30 uploaded fonts may be registered')
  for (const [id, raw] of Object.entries(fonts)) {
    if (!UUID.test(id)) fail('fonts', 'Invalid font identity')
    const font = object(raw, 'font'); keys(font, ['ref', 'name'], 'font')
    if (!validMediaRef(font.ref) || font.ref.bucket !== 'cms-library' || !font.ref.path.endsWith('.woff2')) fail('font', 'Choose a registered WOFF2 font')
    text(font.name, 'font.name', 160, 1)
  }
  const registeredFont = (value: unknown): boolean => typeof value === 'string' && value.startsWith('CMSFont-') && Object.hasOwn(fonts, value.slice(8))`)
  edit('shared/cms.ts', "if (!['Inter Variable, sans-serif', 'Playfair Display, serif', 'Arial, sans-serif', 'Georgia, serif', 'system-ui, sans-serif'].includes(String(cell)))", "if (!['Inter Variable, sans-serif', 'Playfair Display, serif', 'Arial, sans-serif', 'Georgia, serif', 'system-ui, sans-serif'].includes(String(cell)) && !registeredFont(cell))")
  edit('shared/cms.ts', "const variants = object(raw, id); keys(variants, ['base', 'light', 'dark', 'mobile', 'desktop'], id)", `const variants = object(raw, id); keys(variants, ['base', 'light', 'dark', 'mobile', 'desktop'], id)
    for (const rawValues of Object.values(variants)) {
      const family = object(rawValues, id).fontFamily
      if (typeof family === 'string' && family.startsWith('CMSFont-') && !registeredFont(family)) fail(id, 'Font family is not registered')
    }`)
  edit('shared/cms.ts', '  const logo = document.settings.homepage_logo_path', '  refs.push(...Object.values(document.presentation.fonts ?? {}).map(font => font.ref))\n  const logo = document.settings.homepage_logo_path')
  edit('shared/cms-resources.ts', '  for (const email of document.emails)', "  for (const font of Object.values(document.presentation.fonts ?? {})) if (mediaKey(font.ref) === key) places.push(`Typsnitt: ${font.name}`)\n  for (const email of document.emails)")
  edit('shared/cms-resources.ts', '  const oldKey = mediaKey(previous)', `  const oldKey = mediaKey(previous)
  if (previous.path.endsWith('.woff2') !== next.path.endsWith('.woff2')) throw new Error('Ersätt ett typsnitt med ett typsnitt och en bild med en bild.')
  for (const font of Object.values(document.presentation.fonts ?? {})) if (mediaKey(font.ref) === oldKey) font.ref = { ...next }`)
}
