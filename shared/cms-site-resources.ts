import { html, parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import { mediaUrl, type CmsAsset, type CmsDocument, type CmsLang } from './cms'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
export interface SiteResourceTarget {
  pageId: string
  id: string
  source?: string
}
export interface SiteResource extends SiteResourceTarget {
  key: string
  pageName: string
  label: string
  tag: string
  description: string
  src: string
  svg: string
  texts: string[]
  replaceable: boolean
}
const attr = (node: Element, name: string): string =>
  node.attrs.find((a) => a.name === name)?.value ?? ''
const all = (node: Node): Element[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(all) : []),
]
const text = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
const setAttr = (node: Element, name: string, value: string): void => {
  node.attrs = [...node.attrs.filter((a) => a.name !== name), { name, value }]
}
const textLeaves = (node: Element): Element[] =>
  all(node).filter((n) => n.tagName === 'text' && n.childNodes.every((c) => c.nodeName === '#text'))

function replaceable(node: Element): boolean {
  return (
    ['img', 'svg'].includes(node.tagName) &&
    !all(node).some(
      (child) =>
        attr(child, 'data-knc-required') === 'true' || Boolean(attr(child, 'data-knc-slot')),
    )
  )
}
function originalLabel(node: Element): string {
  try {
    const baseline: unknown = JSON.parse(attr(node, 'data-knc-baseline') || '{}')
    return baseline &&
      typeof baseline === 'object' &&
      'aria-label' in baseline &&
      typeof baseline['aria-label'] === 'string'
      ? baseline['aria-label']
      : ''
  } catch {
    return ''
  }
}

/** Inventory actual editable components, not just uploaded Storage objects.
 * Opaque previews of another page are excluded; their canonical page owns editing. */
export function siteResources(document: CmsDocument, lang: CmsLang): SiteResource[] {
  return document.presentation.pages.flatMap((page) => {
    const tree = parseFragment(page.content[lang].html)
    const native = page.content[lang].html.includes('data-knc-native="1"')
    return all(tree).flatMap((node) => {
      const id = attr(node, 'id')
      if (!id || (native && !attr(node, 'data-knc-source'))) return []
      const graphic = node.tagName === 'img' || node.tagName === 'svg'
      const description = attr(node, node.tagName === 'img' ? 'alt' : 'aria-label')
      const href = attr(node, 'href')
      const control =
        (node.tagName === 'button' &&
          /språk|language|theme|ljust|dark|telefon|phone/i.test(
            `${description} ${originalLabel(node)}`,
          )) ||
        (node.tagName === 'a' && (/^tel:/.test(href) || /maps\.|\/maps(?:\/|\?)/.test(href)))
      if (!graphic && !control) return []
      const label =
        description ||
        attr(node, 'alt') ||
        attr(node, 'title') ||
        (control ? text(node).trim() : '') ||
        (node.tagName === 'svg' ? 'SVG-grafik' : 'Bild')
      return [
        {
          pageId: page.id,
          id,
          ...(attr(node, 'data-knc-source') ? { source: attr(node, 'data-knc-source') } : {}),
          key: JSON.stringify([page.id, id]),
          pageName:
            page.path === '/about'
              ? `${lang === 'sv' ? 'Startsida' : 'Home'} · Om oss`
              : page.name[lang],
          label,
          tag: node.tagName,
          description,
          src: node.tagName === 'img' ? attr(node, 'src') : '',
          svg: node.tagName === 'svg' ? serializeOuter(node) : '',
          texts: node.tagName === 'svg' ? textLeaves(node).map(text) : [],
          replaceable: replaceable(node),
        },
      ]
    })
  })
}

function mutate(
  document: CmsDocument,
  target: SiteResourceTarget,
  langs: readonly CmsLang[],
  apply: (node: Element) => void,
): CmsDocument {
  const next = structuredClone(document)
  const page = next.presentation.pages.find((page) => page.id === target.pageId)
  if (!page) throw new Error('Sidan finns inte längre i utkastet.')
  for (const lang of langs) {
    const tree = parseFragment(page.content[lang].html)
    const matches = all(tree).filter((node) =>
      target.source
        ? attr(node, 'data-knc-source') === target.source
        : attr(node, 'id') === target.id,
    )
    if (matches.length !== 1 || !matches[0])
      throw new Error(`Komponenten kunde inte identifieras entydigt för ${lang}. Välj den igen.`)
    apply(matches[0])
    page.content[lang].html = serialize(tree)
  }
  return next
}

export function editSiteResource(
  document: CmsDocument,
  target: SiteResourceTarget,
  lang: CmsLang,
  description: string,
  texts: readonly string[],
): CmsDocument {
  if (description.length > 160 || texts.some((value) => value.length > 400))
    throw new Error('Beskrivning eller logotyptext är för lång.')
  return mutate(document, target, [lang], (node) => {
    setAttr(node, node.tagName === 'img' ? 'alt' : 'aria-label', description)
    const leaves = textLeaves(node)
    if (leaves.length !== texts.length)
      throw new Error('Logotypens struktur har ändrats. Välj den igen.')
    leaves.forEach((leaf, i) => {
      leaf.childNodes = [{ nodeName: '#text', value: texts[i] ?? '', parentNode: leaf }]
    })
  })
}

/** Replace presentation on both locales, retaining the original native identity.
 * Actions remain on their existing parents; a functional graphic cannot be replaced. */
export function replaceSiteResource(
  document: CmsDocument,
  target: SiteResourceTarget,
  asset: CmsAsset,
  storageOrigin: string,
): CmsDocument {
  if (asset.archived || asset.trashed_at || asset.mime !== 'image/webp')
    throw new Error('Välj en aktiv behandlad bild från biblioteket.')
  const src = mediaUrl(asset, storageOrigin)
  return mutate(document, target, ['sv', 'en'], (node) => {
    if (!replaceable(node)) throw new Error('Komponentens funktion får inte ersättas med en bild.')
    node.attrs = node.attrs.filter(
      (a) =>
        [
          'id',
          'class',
          'style',
          'title',
          'role',
          'aria-label',
          'aria-hidden',
          'width',
          'height',
        ].includes(a.name) || a.name.startsWith('data-knc-'),
    )
    node.tagName = 'img'
    node.nodeName = 'img'
    node.namespaceURI = html.NS.HTML
    node.childNodes = []
    setAttr(node, 'src', src)
    setAttr(node, 'alt', asset.alt || attr(node, 'aria-label'))
  })
}
