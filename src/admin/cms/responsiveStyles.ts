import { generate, ident, parse, walk, type Atrule, type CssNode } from 'css-tree'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { CmsLang, CmsMode, CmsPage } from '../../../shared/cms'
import { isSitePage, normalizeSitePageContent } from '../../../shared/site-page'
import { isLegacyDesktopMedia } from '../../../shared/cms-device-css'
import type { Editor } from 'grapesjs'

export const editorDevices = [
  { id: 'Desktop', name: 'Desktop', width: '1440px', height: '900px', widthMedia: '769px' },
  {
    id: 'DesktopNarrow',
    name: 'DesktopNarrow',
    width: '820px',
    height: '900px',
    widthMedia: '769px',
  },
  { id: 'Mobile', name: 'Mobile', width: '390px', height: '844px', widthMedia: '768px' },
]

/** Preview width never changes the geometry's saved device scope. */
export function canvasDevice(device: 'Desktop' | 'Mobile', narrow: boolean): string {
  return device === 'Desktop' && narrow ? 'DesktopNarrow' : device
}

// Appearance is theme-specific; geometry is shared by light/dark and scoped by device.
const geometryProperties = new Set(
  'display position top right bottom left z-index translate transform rotate scale zoom width height inline-size block-size aspect-ratio gap row-gap column-gap order box-sizing float clear text-align font-size line-height letter-spacing white-space object-fit object-position'.split(
    ' ',
  ),
)
const geometryPrefixes = [
  'inset',
  'transform',
  'min',
  'max',
  'margin',
  'padding',
  'flex',
  'grid',
  'align',
  'justify',
  'place',
  'overflow',
]
const isGeometry = (property: string): boolean =>
  geometryProperties.has(property) ||
  geometryPrefixes.some((prefix) => property === prefix || property.startsWith(`${prefix}-`))

/** Only a single element selector (or the canonical document root) is an editable layout. */
function layoutSelector(prelude: CssNode): string | undefined {
  if (generate(prelude) === 'html body') return 'html body'
  if (prelude.type !== 'SelectorList' || prelude.children.size !== 1) return
  const selector = prelude.children.first
  if (selector?.type !== 'Selector' || selector.children.size !== 1) return
  const node = selector.children.first
  if (node?.type === 'IdSelector') return `#${ident.encode(ident.decode(node.name))}`
  if (
    node?.type === 'AttributeSelector' &&
    node.name.name === 'id' &&
    node.matcher === '=' &&
    !node.flags &&
    node.value?.type === 'String'
  )
    return `#${ident.encode(node.value.value)}`
  return undefined
}

const mediaKeys = new WeakMap<Atrule, string>()
/** Compare legacy rules in the scope visitors already see, without rewriting untouched CSS. */
function layoutMedia(node: Atrule | null): string {
  if (node?.name !== 'media' || !node.prelude) return ''
  const known = mediaKeys.get(node)
  if (known !== undefined) return known
  const media = isLegacyDesktopMedia(node) ? '(min-width:769px)' : generate(node.prelude)
  mediaKeys.set(node, media)
  return media
}

function declarations(css: string): Map<string, Map<string, CssNode>> {
  const result = new Map<string, Map<string, CssNode>>()
  walk(parse(css), {
    visit: 'Rule',
    enter(rule) {
      const selector = layoutSelector(rule.prelude)
      if (!selector) return
      const media = layoutMedia(this.atrule)
      const key = JSON.stringify([selector, media])
      const values = result.get(key) ?? new Map<string, CssNode>()
      rule.block.children.forEach((declaration) => {
        if (declaration.type === 'Declaration' && isGeometry(declaration.property))
          values.set(declaration.property, declaration)
      })
      result.set(key, values)
    },
  })
  return result
}

interface LayoutTarget {
  readonly selector: string
  readonly text: boolean
}

type Declarations = Map<string, Map<string, CssNode>>
type LayoutChanges = Map<string, Map<string, CssNode | null>>
const textHeight = new Map([
  ['height', parse('height:auto!important', { context: 'declaration' })],
  ['max-height', parse('max-height:none!important', { context: 'declaration' })],
])

function layoutChanges(previous: Declarations, next: Declarations): LayoutChanges {
  const changes: LayoutChanges = new Map()
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(key) ?? new Map()
    const b = next.get(key) ?? new Map()
    const changed = new Map<string, CssNode | null>()
    for (const property of new Set([...a.keys(), ...b.keys()])) {
      const oldValue = a.get(property)
      const newValue = b.get(property)
      if ((oldValue && generate(oldValue)) !== (newValue && generate(newValue)))
        changed.set(property, newValue ?? null)
    }
    if (changed.size) changes.set(key, changed)
  }
  return changes
}

/** Apply one delta to a theme or language. `source` only corrects clipping in the edited sheet. */
function applyLayout(
  changes: LayoutChanges,
  other: string,
  targets?: ReadonlyMap<string, LayoutTarget>,
  source?: Declarations,
): string {
  const mapped: LayoutChanges = new Map()
  for (const [key, values] of changes) {
    const [selector, media] = JSON.parse(key) as [string, string]
    const target = targets?.get(selector)
    if (targets && !target && selector !== 'html body') continue
    const changed = source ? new Map<string, CssNode | null>() : new Map(values)
    if (target?.text && [...values.values()].some((value) => value !== null)) {
      for (const [property, value] of textHeight) {
        const present = source?.get(key)?.get(property)
        if (!source || !present || generate(present) !== generate(value))
          changed.set(property, value)
      }
    }
    if (changed.size) mapped.set(JSON.stringify([target?.selector ?? selector, media]), changed)
  }
  if (!mapped.size) return other
  const tree = parse(other)
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const media = layoutMedia(this.atrule)
      const changed = mapped.get(JSON.stringify([layoutSelector(rule.prelude), media]))
      if (!changed) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type === 'Declaration' && changed.has(declaration.property))
          rule.block.children.remove(item)
      })
    },
  })
  let result = generate(tree)
  for (const [key, values] of mapped) {
    const [selector, media] = JSON.parse(key) as [string, string]
    const body = [...values.values()]
      .filter((v): v is CssNode => v !== null)
      .map((v) => generate(v))
      .join(';')
    if (body) result += media ? `@media ${media}{${selector}{${body}}}` : `${selector}{${body}}`
  }
  return result
}

/** Copy only changed geometry, preserving independent colors and untouched layout drift. */
export function syncLayout(before: string, after: string, other: string): string {
  return applyLayout(layoutChanges(declarations(before), declarations(after)), other)
}

type Node = DefaultTreeAdapterMap['node']
const textTags = new Set(
  'h1 h2 h3 h4 h5 h6 p span a button label li blockquote pre figcaption'.split(' '),
)
const localizedId =
  /^(cms-(?:body|page)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:sv|en)(?=-|$)/i
const layoutKey = (id: string): string => id.replace(localizedId, '$1')

/** Keep the live canvas as well as the saved translation free to grow when text wraps. */
export function connectTextAutoHeight(editor: Editor, disabled: () => boolean): () => void {
  let updating = false
  const change = (model: unknown, property: string): void => {
    if (updating || disabled() || !isGeometry(property)) return
    const component = editor.getSelected()
    const selectedStyle = editor.getSelectedToStyle()
    const element = component?.getEl()
    if (
      model !== selectedStyle ||
      !element ||
      element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      !(
        textTags.has(element.localName) ||
        [...element.childNodes].some((child) => child.nodeType === 3 && child.textContent?.trim())
      ) ||
      !element.textContent?.trim()
    )
      return
    updating = true
    try {
      selectedStyle?.addStyle({ height: 'auto!important', 'max-height': 'none!important' })
    } finally {
      updating = false
    }
  }
  editor.on('styleable:change', change)
  return () => {
    editor.off('styleable:change', change)
  }
}

function layoutElements(html: string): Map<string, LayoutTarget> {
  const result = new Map<string, LayoutTarget>()
  const hasText = (node: Node): boolean =>
    (node.nodeName === '#text' && 'value' in node && Boolean(node.value.trim())) ||
    ('childNodes' in node && node.childNodes.some(hasText))
  const visit = (node: Node): void => {
    if ('tagName' in node) {
      const id = node.attrs.find((attr) => attr.name === 'id')?.value
      if (id) {
        const directText = node.childNodes.some(
          (child) => child.nodeName === '#text' && 'value' in child && child.value.trim(),
        )
        result.set(id, {
          selector: `#${ident.encode(id)}`,
          text:
            node.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
            (directText || (textTags.has(node.tagName) && hasText(node))),
        })
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parseFragment(html))
  return result
}

function layoutTargets(
  source: ReadonlyMap<string, LayoutTarget>,
  target: ReadonlyMap<string, LayoutTarget>,
): Map<string, LayoutTarget> {
  const byKey = new Map<string, LayoutTarget[]>()
  for (const [id, node] of target) {
    const key = layoutKey(id)
    byKey.set(key, [...(byKey.get(key) ?? []), node])
  }
  const result = new Map<string, LayoutTarget>()
  for (const [id, node] of source) {
    const matches = byKey.get(layoutKey(id)) ?? []
    const match = target.get(id) ?? (matches.length === 1 ? matches[0] : undefined)
    if (match) result.set(node.selector, { ...match, text: node.text || match.text })
  }
  return result
}

/** One forward edit, shared by both languages and schemes; never an adoption-time alignment. */
export function syncPageLayout(
  before: CmsPage,
  edited: CmsPage,
  lang: CmsLang,
  mode: CmsMode,
): CmsPage {
  const baseline = isSitePage(before)
    ? normalizeSitePageContent(before.content[lang], `${before.id}-${lang}`)
    : before.content[lang]
  const previous = declarations(baseline.css[mode])
  const next = declarations(edited.content[lang].css[mode])
  // The canvas's legacy breakpoint repair is not an owner edit. With no geometry delta,
  // leave every other stored sheet untouched.
  const changes = layoutChanges(previous, next)
  if (!changes.size) return edited
  const otherLang = lang === 'sv' ? 'en' : 'sv'
  const otherMode = mode === 'light' ? 'dark' : 'light'
  const elements = (language: CmsLang): Map<string, LayoutTarget> => {
    const variant = edited.content[language]
    return layoutElements(
      isSitePage(edited)
        ? normalizeSitePageContent(variant, `${edited.id}-${language}`).html
        : variant.html,
    )
  }
  const source = elements(lang)
  const self = new Map([...source.values()].map((node) => [node.selector, node]))
  const targets = layoutTargets(source, elements(otherLang))
  const content = { ...edited.content }
  content[lang] = {
    ...content[lang],
    css: {
      ...content[lang].css,
      [mode]: applyLayout(changes, content[lang].css[mode], self, next),
      [otherMode]: applyLayout(changes, content[lang].css[otherMode], self),
    },
  }
  content[otherLang] = {
    ...content[otherLang],
    css: {
      light: applyLayout(changes, content[otherLang].css.light, targets),
      dark: applyLayout(changes, content[otherLang].css.dark, targets),
    },
  }
  return { ...edited, content }
}
