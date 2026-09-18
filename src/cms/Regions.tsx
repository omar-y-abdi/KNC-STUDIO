import type { JSX } from 'preact'
import type { CmsLang, CmsMode, CmsRegion as RegionName } from '../../shared/cms'
import { useCms } from './context'
import { lazy, Suspense } from 'preact/compat'
const CmsMarkup = lazy(() => import('./Markup').then((module) => ({ default: module.CmsMarkup })))

export function CmsRegion({
  name,
  lang,
  mode,
}: {
  name: RegionName
  lang: CmsLang
  mode: CmsMode
}): JSX.Element | null {
  const variant = useCms().presentation.regions[name]?.[lang]
  if (!variant || !variant.html.trim()) return null
  return (
    <div data-cms-node={`region-${name}`}>
      <Suspense fallback={<p role="status">Läser innehåll…</p>}>
        <CmsMarkup html={variant.html} css={variant.css[mode]} label={name} />
      </Suspense>
    </div>
  )
}

export function CmsPageMenu({ lang, mode }: { lang: CmsLang; mode: CmsMode }): JSX.Element | null {
  const pages = useCms().presentation.pages.filter((page) => page.inMenu)
  if (!pages.length) return null
  return (
    <nav
      data-cms-node="published-page-menu"
      aria-label={lang === 'sv' ? 'Fler sidor' : 'More pages'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '12px 16px',
        color: 'inherit',
        fontSize: '14px',
      }}
    >
      {pages.map((page) => (
        <a
          key={page.id}
          data-cms-node={`page-link-${page.id}`}
          href={`${page.path}?lang=${lang}&mode=${mode}`}
          style={{ color: 'inherit', overflowWrap: 'anywhere' }}
        >
          {page.name[lang] || page.path}
        </a>
      ))}
    </nav>
  )
}
