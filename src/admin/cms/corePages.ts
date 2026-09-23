import type { CmsDocument, CmsPage } from '../../../shared/cms'
import { pageScenes } from '../../cms/Scene'

export const CORE_PAGE_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
] as const

/** Stored layouts are already editable. Missing optional scenes/motion metadata
 * are an upgrade, not a prerequisite for opening the owner's document. */
export function hasCorePageLayouts(document: CmsDocument): boolean {
  return ['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms'].every((path) => {
    const page = document.presentation.pages.find((item) => item.path === path)
    return (
      page &&
      ['sv', 'en'].every((lang) => {
        const html = page.content[lang as 'sv' | 'en'].html
        return (
          html.trim() &&
          (path === '/privacy' || path === '/terms' || html.includes('data-knc-native="1"'))
        )
      })
    )
  })
}

let sourcePages: readonly CmsPage[] = []
let loading: Promise<void> | undefined

/** A published complete document already contains the source layout. Capture only missing/legacy
 * templates instead of replaying every live scene on each visit to Studio. */
export function needsCorePageSource(document: CmsDocument): boolean {
  for (const path of ['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms']) {
    const page = document.presentation.pages.find((item) => item.path === path)
    if (!page) return true
    if (path === '/privacy' || path === '/terms') continue
    for (const variant of Object.values(page.content)) {
      if (!variant.html.includes('data-knc-native="1"')) return true
      const tree = new DOMParser().parseFromString(variant.html, 'text/html')
      if (
        pageScenes(path).some(
          ({ id }) => id !== 'default' && !tree.querySelector(`[data-knc-surface="${id}"]`),
        )
      )
        return true
      if (path === '/' && !tree.querySelector('[data-knc-fold="panel"]')) return true
      for (const slot of tree.querySelectorAll('[data-knc-slot]'))
        if (
          slot.children.length &&
          !slot.querySelector('[data-knc-source],[data-knc-slot],[data-knc-baseline]')
        )
          return true
    }
  }
  return false
}

/** Keep authoritative layouts available for old backups/imports even when optional
 * source capture is deferred or unavailable. Never seed unrelated authored pages. */
export function retainCorePageLayouts(existing: CmsDocument): void {
  sourcePages = existing.presentation.pages.filter((page) =>
    CORE_PAGE_IDS.includes(page.id as (typeof CORE_PAGE_IDS)[number]),
  )
}

export function prepareCorePageSource(existing?: CmsDocument): Promise<void> {
  if (existing && !needsCorePageSource(existing)) {
    retainCorePageLayouts(existing)
    return Promise.resolve()
  }
  loading ??= import('./nativePages')
    .then(({ readCorePageSource }) => readCorePageSource())
    .then((pages) => {
      sourcePages = pages
    })
    .catch((error: unknown) => {
      loading = undefined
      throw error
    })
  return loading
}

export function isInventedSite(document: CmsDocument): boolean {
  return document.presentation.pages.some((page) =>
    Object.values(page.content).some((variant) => /class=["']knc-cms-page["']/.test(variant.html)),
  )
}

/** Upgrade old opaque previews whose inline styles were erased by the editor import order.
 * These descendants were never editable. Native identities and owner-authored content stay intact.
 */
function repairReadOnlyPreviews(html: string, source: string): string {
  if (typeof DOMParser === 'undefined' || !html.includes('data-knc-native="1"')) return html
  const current = new DOMParser().parseFromString(html, 'text/html')
  const original = new DOMParser().parseFromString(source, 'text/html')
  const slots = new Map(
    [...original.querySelectorAll('[data-knc-slot]')].map((node) => [
      node.getAttribute('data-knc-slot'),
      node,
    ]),
  )
  let changed = false
  for (const slot of current.querySelectorAll('[data-knc-slot]')) {
    if (slot.querySelector('[data-knc-source],[data-knc-slot],[data-knc-baseline]')) continue
    const replacement = slots.get(slot.getAttribute('data-knc-slot'))
    if (!replacement?.querySelector('[data-knc-baseline]')) continue
    slot.replaceChildren(...[...replacement.childNodes].map((node) => node.cloneNode(true)))
    changed = true
  }
  return changed ? current.body.innerHTML : html
}

/** Missing pages may come only from the rendered production components or existing legal files. */
export function ensureCorePages(
  document: CmsDocument,
  source: readonly CmsPage[] = sourcePages,
): CmsDocument {
  const next = structuredClone(document)
  const paths = new Set(next.presentation.pages.map((page) => page.path))
  for (const page of source) {
    if (!paths.has(page.path)) {
      next.presentation.pages.push(structuredClone(page))
      paths.add(page.path)
    } else {
      const existing = next.presentation.pages.find((item) => item.path === page.path)
      if (existing)
        for (const lang of ['sv', 'en'] as const) {
          existing.content[lang].html = repairReadOnlyPreviews(
            existing.content[lang].html,
            page.content[lang].html,
          )
          if (typeof DOMParser === 'undefined') continue
          const current = new DOMParser().parseFromString(existing.content[lang].html, 'text/html')
          const fresh = new DOMParser().parseFromString(page.content[lang].html, 'text/html')
          let added = false
          for (const { id } of pageScenes(page.path)) {
            if (id === 'default' || current.querySelector(`[data-knc-surface="${id}"]`)) continue
            const region = fresh.querySelector(`[data-knc-surface="${id}"]`)
            if (region) {
              ;(current.querySelector('[data-knc-native]') ?? current.body).appendChild(
                region.cloneNode(true),
              )
              added = true
            }
          }
          // Add motion hooks by stable source identity without replacing authored text/styles.
          for (const node of fresh.querySelectorAll('[data-knc-fold]')) {
            const target = current.getElementById(node.id)
            if (target)
              target.setAttribute('data-knc-fold', node.getAttribute('data-knc-fold') ?? '')
          }
          existing.content[lang].html = current.body.innerHTML
          if (added)
            for (const mode of ['light', 'dark'] as const)
              existing.content[lang].css[mode] =
                page.content[lang].css[mode] + '\n' + existing.content[lang].css[mode]
        }
    }
  }
  return next
}
