import type { CmsLang, CmsMode, CmsPage } from '../../../shared/cms'
import { CORE_PAGE_IDS } from './corePages'

const attrs = ['class', 'title', 'href', 'target', 'rel', 'src', 'alt', 'aria-label']
const responsive =
  '@media(max-width:768px){[data-knc-surface^="desktop-"]{display:none!important}}@media(min-width:769px){[data-knc-surface^="mobile-"]{display:none!important}}'

interface Capture {
  html: string
  css: string
  title: string
}
type PageSources = Record<CmsLang, Record<CmsMode, Capture[]>>

export function snapshotNative(root: Element, prefix: string): string {
  const copy = root.cloneNode(true) as Element
  for (const node of copy.querySelectorAll('script,style,iframe,object,embed,noscript'))
    node.remove()
  const nodes = [copy, ...copy.querySelectorAll('*')]
  const ids = new Map<string, string>()
  for (const [index, node] of nodes.entries()) {
    const opaque = node.parentElement?.closest('[data-knc-slot]')
    if (opaque) {
      for (const attr of [...node.attributes])
        if (attr.name.startsWith('data-knc-')) node.removeAttribute(attr.name)
      const id = `preview-${prefix}-${index}`
      if (node.id) ids.set(node.id, id)
      node.id = id
    } else if (!node.id) node.id = `preview-${prefix}-${index}`
    for (const attr of [...node.attributes]) {
      if (
        attr.name.startsWith('on') ||
        ['contenteditable', 'autofocus'].includes(attr.name) ||
        (attr.name.startsWith('data-') &&
          !attr.name.startsWith('data-knc-') &&
          !attr.name.startsWith('data-business-'))
      )
        node.removeAttribute(attr.name)
    }
  }
  const localIds = new Set(nodes.map((node) => node.id))
  for (const node of nodes) {
    for (const attr of [...node.attributes]) {
      if (['href', 'xlink:href'].includes(attr.name) && attr.value.startsWith('#')) {
        const target = ids.get(attr.value.slice(1))
        if (target) node.setAttribute(attr.name, `#${target}`)
        else if (
          attr.name === 'href' &&
          node.localName === 'a' &&
          attr.value.length > 1 &&
          !localIds.has(attr.value.slice(1))
        )
          node.setAttribute('href', `/${attr.value}`)
      } else if (
        ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls'].includes(attr.name)
      ) {
        node.setAttribute(
          attr.name,
          attr.value
            .split(/\s+/)
            .map((id) => ids.get(id) ?? id)
            .join(' '),
        )
      } else if (attr.value.includes('url(')) {
        node.setAttribute(
          attr.name,
          attr.value.replace(/url\(["']?#([^\s)"']+)["']?\)/g, (match, id: string) =>
            ids.has(id) ? `url(#${ids.get(id)})` : match,
          ),
        )
      }
    }
    const baseline: Record<string, string> = Object.fromEntries(
      attrs.flatMap((name) =>
        node.hasAttribute(name) ? [[name, node.getAttribute(name) ?? '']] : [],
      ),
    )
    if (node.children.length === 0) baseline['text'] = node.textContent ?? ''
    node.setAttribute('data-knc-baseline', JSON.stringify(baseline))
    node.setAttribute('data-knc-light', node.getAttribute('style') ?? '')
  }
  return copy.outerHTML
}

export function mergeModes(light: string, dark: string): string {
  const doc = new DOMParser().parseFromString(light, 'text/html')
  const other = new DOMParser().parseFromString(dark, 'text/html')
  const byId = new Map([...other.querySelectorAll('[id]')].map((node) => [node.id, node]))
  for (const node of doc.querySelectorAll('[data-knc-baseline]')) {
    const variant = byId.get(node.id)
    const style = (variant ?? node).getAttribute('style') ?? ''
    if (style !== (node.getAttribute('data-knc-light') ?? ''))
      node.setAttribute('data-knc-dark', style)
    const baseline = variant?.getAttribute('data-knc-baseline')
    if (typeof baseline === 'string' && baseline !== node.getAttribute('data-knc-baseline'))
      node.setAttribute('data-knc-dark-attrs', baseline)
  }
  return `<div data-knc-native="1" style="display:contents">${doc.body.innerHTML}</div>`
}

async function waitFor(
  frame: HTMLIFrameElement,
  predicate: (doc: Document) => boolean,
): Promise<Document> {
  const deadline = performance.now() + 20000
  while (performance.now() < deadline) {
    const doc = frame.contentDocument
    if (doc && predicate(doc)) return doc
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Den befintliga webbplatsen kunde inte läsas. Inga mallsidor skapades.')
}

export async function readCorePageSource(): Promise<CmsPage[]> {
  const frame = document.createElement('iframe')
  frame.title = 'Läser den befintliga webbplatsen'
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:1440px;height:900px;opacity:0;pointer-events:none;z-index:-1;border:0'
  frame.src = '/cms-public/source'
  document.body.appendChild(frame)
  const paths = ['/', '/about', '/booking', '/my-bookings'] as const
  const data = new Map<string, PageSources>(
    paths.map((path) => [
      path,
      {
        sv: { light: [], dark: [] },
        en: { light: [], dark: [] },
      },
    ]),
  )
  try {
    await waitFor(frame, (doc) => doc.documentElement.dataset['kncSourceListening'] === '1')
    for (const lang of ['sv', 'en'] as const)
      for (const mode of ['light', 'dark'] as const)
        for (const device of ['Desktop', 'Mobile'] as const)
          for (const scene of ['home', 'booking', 'my-bookings'] as const) {
            frame.style.width = device === 'Desktop' ? '1440px' : '390px'
            frame.style.height = device === 'Desktop' ? '900px' : '844px'
            const id = crypto.randomUUID()
            frame.contentWindow?.postMessage(
              { type: 'knc-source-context', id, lang, mode, device, scene },
              location.origin,
            )
            const doc = await waitFor(frame, (document) => {
              if (document.documentElement.dataset['kncSourceError'] === id)
                throw new Error(
                  'Källan kunde inte läsas: ' +
                    document.documentElement.dataset['kncSourceFailure'],
                )
              return document.documentElement.dataset['kncSourceReady'] === id
            })
            const css = [...doc.styleSheets]
              .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
              .join('\n')
            const add = (path: string, surface: string): void => {
              const root = doc.querySelector(`[data-knc-surface="${surface}"]`)
              if (!root) throw new Error(`Originalytan ${surface} saknas`)
              data
                .get(path)
                ?.[lang][mode].push({ html: snapshotNative(root, surface), css, title: doc.title })
            }
            if (scene === 'home') {
              add('/', `${device.toLowerCase()}-home`)
              if (device === 'Desktop') add('/about', 'about')
            } else if (scene === 'booking') add('/booking', `${device.toLowerCase()}-booking`)
            else if (device === 'Desktop') add('/my-bookings', 'my-bookings')
          }
  } finally {
    frame.remove()
  }
  const names = [
    ['Startsida', 'Home'],
    ['Om oss', 'About'],
    ['Bokning', 'Booking'],
    ['Mina bokningar', 'My bookings'],
    ['Integritetspolicy', 'Privacy policy'],
    ['Bokningsvillkor', 'Booking terms'],
  ] as const
  const pages: CmsPage[] = []
  for (const [index, path] of paths.entries()) {
    const variants = data.get(path)
    if (!variants) throw new Error('Källsidorna saknas')
    const content = Object.fromEntries(
      (['sv', 'en'] as const).map((lang) => [
        lang,
        {
          html: mergeModes(
            variants[lang].light.map((item) => item.html).join(''),
            variants[lang].dark.map((item) => item.html).join(''),
          ),
          css: {
            light:
              responsive + [...new Set(variants[lang].light.map((item) => item.css))].join('\n'),
            dark: responsive + [...new Set(variants[lang].dark.map((item) => item.css))].join('\n'),
          },
        },
      ]),
    ) as CmsPage['content']
    const name = names[index]
    const id = CORE_PAGE_IDS[index]
    if (!name || !id) throw new Error('Källsidans identitet saknas')
    pages.push({
      id,
      path,
      kind: 'page',
      name: { sv: name[0], en: name[1] },
      title: {
        sv: variants.sv.light[0]?.title ?? name[0],
        en: variants.en.light[0]?.title ?? name[1],
      },
      description: { sv: '', en: '' },
      inMenu: path !== '/my-bookings',
      content,
    })
  }
  for (const [index, kind] of ['privacy', 'terms'].entries()) {
    const response = await fetch(`/${kind}.html`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Den befintliga juridiska sidan kunde inte läsas.')
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
    const styles: string[] = []
    for (const style of doc.querySelectorAll('style,link[rel="stylesheet"]')) {
      if (style.tagName === 'STYLE') styles.push(style.textContent ?? '')
      else {
        const url = new URL(style.getAttribute('href') ?? '', location.origin)
        if (url.origin !== location.origin) throw new Error('Extern källstil stöds inte.')
        const stylesheet = await fetch(url, { cache: 'no-store' })
        if (!stylesheet.ok) throw new Error('Den befintliga sidans stil kunde inte läsas.')
        styles.push(await stylesheet.text())
      }
    }
    const css = styles.join('\n')
    for (const script of doc.querySelectorAll('script')) script.remove()
    const name = names[index + 4]
    const id = CORE_PAGE_IDS[index + 4]
    if (!name || !id) throw new Error('Den juridiska sidans identitet saknas')
    const variant = { html: doc.body.innerHTML, css: { light: css, dark: css } }
    pages.push({
      id,
      path: `/${kind}`,
      kind: kind as 'privacy' | 'terms',
      name: { sv: name[0], en: name[1] },
      title: { sv: name[0], en: name[1] },
      description: { sv: '', en: '' },
      inMenu: false,
      content: { sv: structuredClone(variant), en: structuredClone(variant) },
    })
  }
  return pages
}
