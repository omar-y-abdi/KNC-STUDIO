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
    }
  }
  return next
}
