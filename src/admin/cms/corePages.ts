import type { CmsDocument, CmsPage } from '../../../shared/cms'

export const CORE_PAGE_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
] as const

let sourcePages: readonly CmsPage[] = []
let loading: Promise<void> | undefined

export function prepareCorePageSource(): Promise<void> {
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
        for (const lang of ['sv', 'en'] as const)
          existing.content[lang].html = repairReadOnlyPreviews(
            existing.content[lang].html,
            page.content[lang].html,
          )
    }
  }
  return next
}
