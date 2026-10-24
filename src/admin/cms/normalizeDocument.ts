import { generate, ident, parse, walk, type CssNode, type Rule } from 'css-tree'
import type { CmsDocument } from '../../../shared/cms'
import { marqueeCardWidth } from './hierarchicalResize'

/** The mobile barber strip in one stored About variant: the Embla container and its slides. */
export interface MarqueeIds {
  readonly group: string
  readonly cards: readonly string[]
}

interface StoredZoom {
  readonly scale: number
  readonly important: boolean
  readonly rule: Rule
}

const MOBILE_MEDIA = '(max-width:768px)'

function bareId(rule: Rule): string | undefined {
  if (rule.prelude.type !== 'SelectorList' || rule.prelude.children.size !== 1) return undefined
  const selector = rule.prelude.children.first
  if (selector?.type !== 'Selector' || selector.children.size !== 1) return undefined
  const id = selector.children.first
  return id?.type === 'IdSelector' ? ident.decode(id.name) : undefined
}

/** A zoom factor, 1 for its identity keywords; NaN when the value cannot be read. */
function zoomScale(value: CssNode): number {
  const text = generate(value).trim().toLowerCase()
  if (text === 'normal' || text === 'reset') return 1
  const percent = text.endsWith('%')
  const number = Number(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(number) || number <= 0) return Number.NaN
  return percent ? number / 100 : number
}

/** Remove every Mobile zoom on the strip and its cards; the last one of each id applies. */
function takeMobileZoom(tree: CssNode, ids: ReadonlySet<string>): Map<string, StoredZoom> {
  const zooms = new Map<string, StoredZoom>()
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const media = this.atrule
      if (media?.name !== 'media' || !media.prelude || generate(media.prelude) !== MOBILE_MEDIA)
        return
      const id = bareId(rule)
      if (id === undefined || !ids.has(id)) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type !== 'Declaration' || declaration.property.toLowerCase() !== 'zoom')
          return
        const important = Boolean(declaration.important)
        zooms.set(id, { scale: zoomScale(declaration.value), important, rule })
        rule.block.children.remove(item)
      })
    },
  })
  return zooms
}

function appendMobileRule(tree: CssNode, id: string): Rule {
  const sheet = parse(`@media ${MOBILE_MEDIA}{#${ident.encode(id)}{}}`)
  let rule: Rule | undefined
  walk(sheet, {
    visit: 'Rule',
    enter(node) {
      rule = node
    },
  })
  if (tree.type !== 'StyleSheet' || sheet.type !== 'StyleSheet' || !rule)
    throw new Error('Barberarkortets mobilregel kunde inte skapas.')
  sheet.children.forEach((node) => tree.children.appendData(node))
  return rule
}

function writeCardWidth(rule: Rule, scale: number, important: boolean): void {
  rule.block.children.forEach((declaration, item) => {
    if (
      declaration.type === 'Declaration' &&
      ['width', 'flex-basis'].includes(declaration.property.toLowerCase())
    )
      rule.block.children.remove(item)
  })
  const value = marqueeCardWidth(scale) + (important ? '!important' : '')
  const declarations = parse(`width:${value};flex-basis:${value}`, { context: 'declarationList' })
  if (declarations.type !== 'DeclarationList')
    throw new Error('Barberarkortets bredd kunde inte skrivas.')
  declarations.children.forEach((declaration) => rule.block.children.appendData(declaration))
}

/** History revisions 33-43 sized the mobile strip with zoom, which Embla does not measure.
 * Convert each card's effective zoom (strip zoom times card zoom) into the width form the
 * editor writes today; Desktop zoom, photo zoom and every other rule keep their meaning. */
export function normalizeMarqueeCardZoom(css: string, ids: MarqueeIds): string {
  if (!css.includes('zoom')) return css
  const tree = parse(css)
  const zooms = takeMobileZoom(tree, new Set([ids.group, ...ids.cards]))
  if (!zooms.size) return css
  const strip = zooms.get(ids.group)
  for (const card of ids.cards) {
    const own = zooms.get(card)
    const scale = Number(((strip?.scale ?? 1) * (own?.scale ?? 1)).toFixed(6))
    if (!Number.isFinite(scale) || scale === 1) continue
    const important = (own ?? strip)?.important ?? false
    writeCardWidth(own?.rule ?? appendMobileRule(tree, card), scale, important)
  }
  return generate(tree)
}

/** The barber strip's identities in stored About HTML. */
export function readMarqueeIds(html: string): MarqueeIds | null {
  const strip = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('[data-knc-fold="barber-marquee"][data-knc-source]')
  if (!strip?.id) return null
  const cards = [...strip.children].filter((card) => card.hasAttribute('data-knc-source'))
  return { group: strip.id, cards: cards.map((card) => card.id).filter(Boolean) }
}

/** Every document the Studio adopts (load, backups, history, imports, merges) passes here, so
 * no restoration path can bring strip zoom back. Stored history originals stay untouched. */
export function normalizeMarqueeZoom(
  document: CmsDocument,
  read: (html: string) => MarqueeIds | null = readMarqueeIds,
): CmsDocument {
  const zoomed = (variant: CmsDocument['presentation']['pages'][number]['content']['sv']) =>
    variant.css.light.includes('zoom') || variant.css.dark.includes('zoom')
  if (
    !document.presentation.pages.some(
      (page) => page.path === '/about' && Object.values(page.content).some(zoomed),
    )
  )
    return document
  const next = structuredClone(document)
  for (const page of next.presentation.pages) {
    if (page.path !== '/about') continue
    for (const variant of Object.values(page.content)) {
      const ids = zoomed(variant) ? read(variant.html) : null
      if (!ids) continue
      variant.css.light = normalizeMarqueeCardZoom(variant.css.light, ids)
      variant.css.dark = normalizeMarqueeCardZoom(variant.css.dark, ids)
    }
  }
  return JSON.stringify(next) === JSON.stringify(document) ? document : next
}
