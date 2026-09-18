import { mediaUrl, type CmsPresentation } from './cms.ts'

export function fontFaceCss(presentation: CmsPresentation, storageOrigin: string): string {
  return Object.entries(presentation.fonts ?? {})
    .map(
      ([id, font]) =>
        `@font-face{font-family:"CMSFont-${id}";src:url("${mediaUrl(font.ref, storageOrigin)}") format("woff2");font-display:swap}`,
    )
    .join('\n')
}
