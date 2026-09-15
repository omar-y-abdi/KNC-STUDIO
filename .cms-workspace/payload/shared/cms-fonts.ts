import { mediaUrl, validMediaRef, type CmsPresentation } from './cms.ts'

export const SYSTEM_FONTS: [string, string][] = [['', 'Original'], ['Inter Variable, sans-serif', 'Inter'], ['Arial, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'], ['system-ui, sans-serif', 'System']]
export function fontOptions(presentation: CmsPresentation): [string, string][] {
  return [...SYSTEM_FONTS, ...Object.entries(presentation.fonts ?? {}).map(([id, font]): [string, string] => [`CMSFont-${id}`, font.name])]
}
export function fontFaceCss(presentation: CmsPresentation, storageOrigin: string): string {
  const origin = new URL(storageOrigin).origin
  if (origin === 'null') return ''
  const rules: string[] = []
  for (const [id, font] of Object.entries(presentation.fonts ?? {})) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !validMediaRef(font.ref) || font.ref.bucket !== 'cms-library' || !font.ref.path.endsWith('.woff2')) continue
    const url = mediaUrl(font.ref, origin)
    rules.push(`@font-face{font-family:CMSFont-${id};src:url("${url}") format("woff2");font-display:swap;font-weight:100 900;font-style:normal}`)
  }
  return rules.join('\n')
}
