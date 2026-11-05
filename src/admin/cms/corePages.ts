import type { CmsDocument, CmsPage } from '../../../shared/cms'
import {
  CORE_PAGE_PATHS,
  CmsValidationError,
  INFORMATION_PAGE_PATHS,
  validateDocument,
} from '../../../shared/cms'
import { generate, ident, parse, walk } from 'css-tree'
import { pageScenes } from '../../cms/Scene'

export const CORE_PAGE_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007',
] as const

/** Stored layouts are already editable. Missing optional scenes/motion metadata
 * are an upgrade, not a prerequisite for opening the owner's document. */
function hasPageLayout(document: CmsDocument, path: string): boolean {
  const page = document.presentation.pages.find((item) => item.path === path)
  return Boolean(
    page &&
    ['sv', 'en'].every((lang) => {
      const html = page.content[lang as 'sv' | 'en'].html
      return (
        html.trim() &&
        (INFORMATION_PAGE_PATHS.includes(path) || html.includes('data-knc-native="1"'))
      )
    }),
  )
}

export function hasCorePageLayouts(document: CmsDocument): boolean {
  return CORE_PAGE_PATHS.every((path) => hasPageLayout(document, path))
}

/** Pre-Contact publications already have editable layouts. Add Contact, or fill its empty
 * historical variants, with the optional source upgrade; neither may make those stored pages
 * depend on source availability. */
export function canOpenStoredPages(document: CmsDocument): boolean {
  return CORE_PAGE_PATHS.every((path) => path === '/contact' || hasPageLayout(document, path))
}

/** Publication's structural validation: validateDocument, the first step of the
 * validateCompleteDocument cms-studio runs on every validation and publication. It holds the page
 * budget, the byte budget, unique identities and the node budget. */
function publishable(document: CmsDocument): boolean {
  try {
    validateDocument(document)
    return true
  } catch (error) {
    if (error instanceof CmsValidationError) return false
    throw error
  }
}

/** `id`, or, when another page already holds it, the first identity after the reserved core
 * identities that no page uses. It depends only on the identities in use, so every snapshot of
 * one draft gives a page the same identity. */
function freeIdentity(document: CmsDocument, id: string): string {
  const used = new Set(document.presentation.pages.map((page) => page.id))
  if (!used.has(id)) return id
  for (let index = CORE_PAGE_IDS.length + 1; ; index++) {
    const candidate = `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    if (!used.has(candidate)) return candidate
  }
}

const blankVariant = (page: CmsPage): boolean =>
  Object.values(page.content).some((variant) => !variant.html.trim())

/** Contact became mandatory after documents could already fill the publication budget. The
 * least its upgrade adds is an empty Contact page: when publication would reject even that, a
 * source capture cannot add Contact. A document publication already rejects keeps asking. */
function contactFits(document: CmsDocument): boolean {
  const empty = { html: '', css: { light: '', dark: '' } }
  const contact: CmsPage = {
    id: freeIdentity(document, CORE_PAGE_IDS[6]),
    path: '/contact',
    kind: 'page',
    inMenu: false,
    name: { sv: '', en: '' },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    content: { sv: structuredClone(empty), en: structuredClone(empty) },
  }
  const candidate = {
    ...document,
    presentation: {
      ...document.presentation,
      pages: [...document.presentation.pages, contact],
    },
  }
  return publishable(candidate) || !publishable(document)
}

let sourcePages: readonly CmsPage[] = []
let loading: Promise<CmsPage[]> | undefined

/** A published complete document already contains the source layout. Capture only missing/legacy
 * templates instead of replaying every live scene on each visit to Studio. */
export function needsCorePageSource(document: CmsDocument): boolean {
  for (const path of CORE_PAGE_PATHS) {
    const page = document.presentation.pages.find((item) => item.path === path)
    if (path === '/contact') {
      if (page ? blankVariant(page) : contactFits(document)) return true
      continue
    }
    if (!page) return true
    if (INFORMATION_PAGE_PATHS.includes(path)) continue
    for (const variant of Object.values(page.content)) {
      if (!variant.html.includes('data-knc-native="1"')) return true
      const tree = new DOMParser().parseFromString(variant.html, 'text/html')
      if (
        path === '/booking' &&
        ['desktop-booking', 'mobile-booking'].some((surface) => {
          const shell = tree.querySelector(`[data-knc-surface="${surface}"]`)
          return !shell?.querySelector('[data-knc-fold="booking-flow"]')
        })
      )
        return true
      if (path === '/about' && !tree.querySelector('[data-knc-fold="barber-marquee"]')) return true
      // Gallery tiles captured before their markers existed cannot be locked in the editor.
      if (
        path === '/about' &&
        tree.querySelector('[role="button"][aria-pressed]') &&
        !tree.querySelector('[data-knc-fold="gallery-tile"]')
      )
        return true
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
 * source capture is deferred or unavailable. A fixed route is its path, whatever identity an
 * earlier Studio gave it. Never seed unrelated authored pages, whatever identity they hold. */
export function retainCorePageLayouts(existing: CmsDocument): void {
  sourcePages = existing.presentation.pages.filter((page) => CORE_PAGE_PATHS.includes(page.path))
}

export function prepareCorePageSource(existing?: CmsDocument): Promise<void> {
  if (existing && !needsCorePageSource(existing)) {
    retainCorePageLayouts(existing)
    return Promise.resolve()
  }
  loading ??= import('./nativePages')
    .then(({ readCorePageSource }) => readCorePageSource())
    .catch((error: unknown) => {
      loading = undefined
      throw error
    })
  return loading.then((pages) => {
    // A later Studio mount may retain an older published layout. Reuse the captured source,
    // not that retained layout, whenever another snapshot still needs the automatic upgrade.
    sourcePages = pages
  })
}

export function isInventedSite(document: CmsDocument): boolean {
  return document.presentation.pages.some((page) =>
    Object.values(page.content).some((variant) => /class=["']knc-cms-page["']/.test(variant.html)),
  )
}

function mobileBarberCss(css: string, ids: ReadonlyMap<string, string>): string {
  const tree = parse(css)
  let result = ''
  walk(tree, {
    visit: 'Atrule',
    enter(atrule) {
      if (atrule.name !== 'media' || !atrule.block) return
      const barberRule = atrule.block.children.some(
        (child) => child.type === 'Rule' && generate(child.prelude).includes('barber-marquee'),
      )
      if (barberRule) {
        const scoped = parse(generate(atrule))
        walk(scoped, {
          visit: 'IdSelector',
          enter(selector) {
            const next = ids.get(ident.decode(selector.name))
            if (next) selector.name = ident.encode(next)
          },
        })
        result = generate(scoped)
      }
    },
  })
  return result
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

/** Preserve identity for callers comparing next.document === recovered. */
export function withCorePages(document: CmsDocument): CmsDocument {
  return hasCorePageLayouts(document) ? document : ensureCorePages(document)
}

/** Contact content whose empty historical variants take the source's, or null when the source
 * fills none. The owner's sheet for an empty variant, if any, follows the template's. Authored
 * variants keep every byte. */
function filledContent(contact: CmsPage, source: CmsPage): CmsPage['content'] | null {
  const blank = (['sv', 'en'] as const).filter(
    (lang) => !contact.content[lang].html.trim() && source.content[lang].html.trim(),
  )
  if (!blank.length) return null
  const content = { ...contact.content }
  for (const lang of blank) {
    const variant = contact.content[lang]
    const template = source.content[lang]
    const sheet = (mode: 'light' | 'dark'): string =>
      variant.css[mode] ? `${template.css[mode]}\n${variant.css[mode]}` : template.css[mode]
    content[lang] = { html: template.html, css: { light: sheet('light'), dark: sheet('dark') } }
  }
  return content
}

/** Missing pages may come only from rendered production components or existing information files.
 * A page whose identity another page already holds is added under a free identity. */
export function ensureCorePages(
  document: CmsDocument,
  source: readonly CmsPage[] = sourcePages,
): CmsDocument {
  const next = structuredClone(document)
  const paths = new Set(next.presentation.pages.map((page) => page.path))
  // The Contact upgrade applies only when publication would accept the result, or when it
  // already rejects the stored document, so it never makes a publishable document unpublishable.
  let storedPublishable: boolean | undefined
  const admits = (): boolean => publishable(next) || !(storedPublishable ??= publishable(document))
  for (const page of source) {
    if (!paths.has(page.path)) {
      next.presentation.pages.push({ ...structuredClone(page), id: freeIdentity(next, page.id) })
      if (page.path === '/contact' && !admits()) next.presentation.pages.pop()
      else paths.add(page.path)
    } else {
      // Information pages are authored bodies, not native scenes. Keep their bytes intact;
      // normalizeDocument separately handles the recognized legacy legal upgrade. Only an empty
      // historical Contact variant takes the source, under the same publication rule.
      if (INFORMATION_PAGE_PATHS.includes(page.path)) {
        const contact =
          page.path === '/contact'
            ? next.presentation.pages.find((item) => item.path === page.path)
            : undefined
        const filled = contact ? filledContent(contact, page) : null
        if (!contact || !filled) continue
        const authored = contact.content
        contact.content = filled
        if (!admits()) contact.content = authored
        continue
      }
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
          const hadMobileBarbers = Boolean(
            current.querySelector('[data-knc-fold="barber-marquee"]'),
          )
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
          const sourceNodes = new Map(
            [...current.querySelectorAll('[data-knc-source]')].map(
              (node) => [node.getAttribute('data-knc-source'), node] as const,
            ),
          )
          const ids = new Map<string, string>()
          for (const node of fresh.querySelectorAll('[data-knc-source]')) {
            const sourceId = node.getAttribute('data-knc-source')
            const target = sourceId ? sourceNodes.get(sourceId) : undefined
            if (node.id && target?.id) ids.set(node.id, target.id)
          }
          for (const node of fresh.querySelectorAll('[data-knc-fold]')) {
            const fold = node.getAttribute('data-knc-fold')
            const bySource =
              fold === 'booking-flow' ||
              fold === 'barber-marquee' ||
              Boolean(fold?.startsWith('gallery-'))
            const sourceId = node.getAttribute('data-knc-source')
            const target = bySource
              ? sourceId
                ? sourceNodes.get(sourceId)
                : undefined
              : current.getElementById(node.id)
            if (target)
              target.setAttribute('data-knc-fold', node.getAttribute('data-knc-fold') ?? '')
          }
          if (
            page.path === '/about' &&
            !hadMobileBarbers &&
            current.querySelector('[data-knc-fold="barber-marquee"]')
          )
            for (const mode of ['light', 'dark'] as const) {
              const baseline = mobileBarberCss(page.content[lang].css[mode], ids)
              if (!baseline) throw new Error('Mobilens barberarstilar saknas i källan.')
              existing.content[lang].css[mode] = baseline + '\n' + existing.content[lang].css[mode]
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
