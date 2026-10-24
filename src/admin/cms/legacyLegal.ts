import type { CmsDocument, CmsPage, PageVariant } from '../../../shared/cms'
import legacyPrivacyCss from './legacy-legal-privacy.txt?raw'
import legacyTermsCss from './legacy-legal-terms.txt?raw'

/** The CSS the first legal import stored for every language and mode (c202df2): public/info.css for
 * /terms and the inline style of public/privacy.html for /privacy. The Worker now inlines
 * /tokens.css and /info.css as the legal base instead (STY-7). */
export const LEGACY_LEGAL_CSS: Readonly<Record<'/terms' | '/privacy', string>> = {
  '/terms': legacyTermsCss,
  '/privacy': legacyPrivacyCss,
}

const LEGACY_MAIN = /^(\s*)<main>([\s\S]*)<\/main>(\s*)$/

/** The importer's token shape around the stored main, or null when the page has another shape. */
function tokenShape(html: string): string | null {
  const parts = LEGACY_MAIN.exec(html)
  if (!parts || parts[2]?.includes('<main')) return null
  return `${parts[1]}<div class="bb-page"><main class="bb-doc">${parts[2]}</main></div>${parts[3]}`
}

function upgradedPage(page: CmsPage, legacy: string): CmsPage | null {
  const { sv, en } = page.content
  const sheets = [sv.css.light, sv.css.dark, en.css.light, en.css.dark]
  if (!sheets.every((css) => css.includes(legacy))) return null
  const svHtml = tokenShape(sv.html)
  const enHtml = tokenShape(en.html)
  if (svHtml === null || enHtml === null) return null
  const strip = (variant: PageVariant, html: string): PageVariant => ({
    html,
    css: {
      light: variant.css.light.replace(legacy, ''),
      dark: variant.css.dark.replace(legacy, ''),
    },
  })
  return { ...page, content: { sv: strip(sv, svHtml), en: strip(en, enHtml) } }
}

/** A legal page whose four stored sheets still hold exactly the imported legacy CSS loses that block
 * and gets the importer's token shape; its other CSS and its inner HTML stay byte for byte. Any
 * other page, or a legal page of another shape, is returned untouched, so a second run is a no-op. */
export function upgradeLegacyLegalPages(document: CmsDocument): CmsDocument {
  let changed = false
  const pages = document.presentation.pages.map((page) => {
    const legacy = LEGACY_LEGAL_CSS[page.path as keyof typeof LEGACY_LEGAL_CSS]
    const upgraded = legacy === undefined ? null : upgradedPage(page, legacy)
    if (upgraded === null) return page
    changed = true
    return upgraded
  })
  return changed ? { ...document, presentation: { ...document.presentation, pages } } : document
}
