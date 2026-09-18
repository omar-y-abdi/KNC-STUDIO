import type { CmsPresentation } from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'

export function uploadedFontCss(presentation: CmsPresentation, supabaseUrl: string): string {
  return Object.entries(presentation.fonts ?? {})
    .map(
      ([id, font]) =>
        `@font-face{font-family:"CMSFont-${id}";src:url("${mediaUrl(font.ref, supabaseUrl)}") format("woff2");font-display:swap}`,
    )
    .join('\n')
}
