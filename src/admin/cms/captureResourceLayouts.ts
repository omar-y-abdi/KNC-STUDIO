import { generate, parse, walk } from 'css-tree'
import type { CmsDocument, CmsLang, CmsMode, CmsPage } from '../../../shared/cms'
import { mergeModes, mobileBarberCss, snapshotNative } from './nativePages'

function preserveOverrides(html: string, previous: string): string {
  const next = new DOMParser().parseFromString(html, 'text/html')
  const old = new DOMParser().parseFromString(previous, 'text/html')
  const identity = (node: Element): string | null =>
    node.getAttribute('data-knc-source') ?? node.getAttribute('data-knc-slot')
  const originals = new Map(
    [...old.querySelectorAll('[data-knc-baseline]')].map((node) => [identity(node), node]),
  )
  for (const node of next.querySelectorAll('[data-knc-baseline]')) {
    const prior = originals.get(identity(node))
    if (!prior || prior.tagName !== node.tagName) continue
    const before = JSON.parse(prior.getAttribute('data-knc-baseline') ?? '{}') as Record<
      string,
      string
    >
    const fresh = JSON.parse(node.getAttribute('data-knc-baseline') ?? '{}') as Record<
      string,
      string
    >
    for (const key of [
      'class',
      'title',
      'href',
      'target',
      'rel',
      'src',
      'alt',
      'aria-label',
      'placeholder',
    ]) {
      if (prior.getAttribute(key) === (before[key] ?? null)) continue
      if (before[key] === undefined) Reflect.deleteProperty(fresh, key)
      else fresh[key] = before[key]
    }
    const text = [...prior.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent ?? '')
      .join('')
    if (text !== before['text'] && before['text'] !== undefined) fresh['text'] = before['text']
    // Retain removal history; otherwise a resource refresh resurrects deleted authored children.
    const children: string[] = JSON.parse(fresh['children'] ?? '[]')
    const retained: string[] = JSON.parse(before['children'] ?? '[]')
    fresh['children'] = JSON.stringify([...new Set([...retained, ...children])])
    node.setAttribute('data-knc-baseline', JSON.stringify(fresh))
  }
  return next.body.innerHTML
}

/** Refresh only Home/About after domain-resource edits, never all booking scenes.
 * Existing templates are projected by the real components; original owner edits remain marked. */
export async function captureResourceLayouts(
  draft: CmsDocument,
  signal: AbortSignal,
): Promise<CmsPage[]> {
  const frame = document.createElement('iframe')
  frame.title = 'Uppdaterar resurser i utkastet'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:1440px;height:900px;opacity:0;pointer-events:none;z-index:-1;border:0'
  frame.src = '/cms-public/source?preview=1'
  document.body.appendChild(frame)
  const wait = async (test: (doc: Document) => boolean): Promise<Document> => {
    const end = performance.now() + 20000
    while (performance.now() < end) {
      signal.throwIfAborted()
      if (frame.contentDocument && test(frame.contentDocument)) return frame.contentDocument
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('Resurserna finns i utkastet men sidans förhandsvisning kunde inte uppdateras.')
  }
  const captures = new Map<string, { html: string }>()
  try {
    await wait((doc) => doc.documentElement.dataset['kncSourceListening'] === '1')
    for (const lang of ['sv', 'en'] as const)
      for (const mode of ['light', 'dark'] as const)
        for (const device of ['Desktop', 'Mobile'] as const) {
          frame.style.width = device === 'Desktop' ? '1440px' : '390px'
          frame.style.height = device === 'Desktop' ? '900px' : '844px'
          const id = crypto.randomUUID()
          frame.contentWindow?.postMessage(
            {
              type: 'knc-source-context',
              id,
              lang,
              mode,
              device,
              scene: 'home',
              path: '/',
              draft,
              presentation: draft.presentation,
              capture: true,
            },
            location.origin,
          )
          const doc = await wait((doc) => {
            if (doc.documentElement.dataset['kncSourceError'] === id)
              throw new Error('Utkastets resursvy kunde inte renderas.')
            return doc.documentElement.dataset['kncSourceReady'] === id
          })
          for (const [path, surface] of [
            ['/', `${device.toLowerCase()}-home`],
            ['/about', 'about'],
          ] as const) {
            const root = doc.querySelector(`[data-knc-surface="${surface}"]`)
            const previous = draft.presentation.pages.find((page) => page.path === path)?.content[
              lang
            ].html
            if (!root || previous === undefined) throw new Error('Utkastets originalyta saknas.')
            captures.set(`${path}:${lang}:${mode}:${device}`, {
              html: preserveOverrides(snapshotNative(root, surface), previous),
            })
          }
        }
  } finally {
    frame.remove()
  }
  const get = (path: string, lang: CmsLang, mode: CmsMode, device: string) => {
    const value = captures.get(`${path}:${lang}:${mode}:${device}`)
    if (!value) throw new Error('Resursvyn blev inte fullständig.')
    return value
  }
  return draft.presentation.pages
    .filter((page) => ['/', '/about'].includes(page.path))
    .map((page) => {
      const next = structuredClone(page)
      for (const lang of ['sv', 'en'] as const) {
        const html = (mode: CmsMode) =>
          get(page.path, lang, mode, 'Desktop').html +
          (page.path === '/' ? get(page.path, lang, mode, 'Mobile').html : '')
        next.content[lang].html = mergeModes(html('light'), html('dark'))
        for (const mode of ['light', 'dark'] as const)
          next.content[lang].css[mode] =
            page.path === '/about'
              ? replaceBarberBaseline(
                  page.content[lang].css[mode],
                  mobileBarberCss(
                    get(page.path, lang, mode, 'Desktop').html,
                    get(page.path, lang, mode, 'Mobile').html,
                  ),
                )
              : page.content[lang].css[mode]
      }
      return next
    })
}

/** Do not recapture CSSOM: it contains all pages, inherited styles and prior snapshots.
 * Retain authored CSS once; replace only the source-owned mobile barber baseline. */
function replaceBarberBaseline(css: string, baseline: string): string {
  const tree = parse(css)
  walk(tree, {
    visit: 'Rule',
    enter(rule, item, list) {
      if (
        item &&
        list &&
        /:where\(\[data-knc-fold=["']?barber-marquee/.test(generate(rule.prelude))
      )
        list.remove(item)
    },
  })
  return generate(tree) + '\n' + baseline
}

export function resourceLayoutsChanged(before: CmsDocument, after: CmsDocument): boolean {
  return (
    JSON.stringify([before.gallery, before.photos, visualSettings(before)]) !==
    JSON.stringify([after.gallery, after.photos, visualSettings(after)])
  )
}

function visualSettings(document: CmsDocument): [string, string][] {
  return Object.entries(document.settings)
    .filter(([key]) => key === 'homepage_logo_path' || key.startsWith('business_'))
    .sort(([a], [b]) => a.localeCompare(b))
}
