import type { JSX } from 'preact'
import type { CmsLang, CmsMode } from '../../shared/cms'
import { useCmsPageLinks } from './NativeSurface'

export function SitePageLinks({
  lang,
  mode,
}: {
  lang: CmsLang
  mode: CmsMode
}): JSX.Element | null {
  const pages = useCmsPageLinks()
  if (!pages.length) return null
  return (
    <nav
      aria-label={lang === 'sv' ? 'Fler sidor' : 'More pages'}
      style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;width:100%;font-size:12px"
    >
      {pages.map((page) => (
        <a
          href={`${page.path}?lang=${lang}&mode=${mode}`}
          style="color:inherit;text-underline-offset:3px"
        >
          {page.name[lang]}
        </a>
      ))}
    </nav>
  )
}
