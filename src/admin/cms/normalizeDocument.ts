import { generate, ident, parse, walk, type CssNode, type Rule } from 'css-tree'
import type { CmsDocument } from '../../../shared/cms'
import { marqueeCardWidth } from './hierarchicalResize'

/** The mobile barber strip in one stored About variant: the Embla container and its slides. */
export interface MarqueeIds {
  readonly group: string
  readonly cards: readonly string[]
}

interface ZoomDeclaration {
  readonly id: string
  /** NaN when the value is not a number, a percentage or calc() over numbers. */
  readonly scale: number
  readonly value: string
  readonly important: boolean
  readonly rule: Rule
  readonly remove: () => void
}

const MOBILE_MEDIA = '(max-width:768px)'

function bareId(rule: Rule): string | undefined {
  if (rule.prelude.type !== 'SelectorList' || rule.prelude.children.size !== 1) return undefined
  const selector = rule.prelude.children.first
  if (selector?.type !== 'Selector' || selector.children.size !== 1) return undefined
  const id = selector.children.first
  return id?.type === 'IdSelector' ? ident.decode(id.name) : undefined
}

/** calc() arithmetic over plain numbers; NaN for units, percentages, var() and anything else. */
function calcValue(nodes: readonly CssNode[]): number {
  let index = 0
  const operator = (): string | undefined => {
    const node = nodes[index]
    return node?.type === 'Operator' ? node.value.trim() : undefined
  }
  const factor = (): number => {
    const node = nodes[index++]
    if (node?.type === 'Number') return Number(node.value)
    if (node?.type === 'Parentheses') return calcValue(node.children.toArray())
    if (node?.type === 'Function' && node.name.toLowerCase() === 'calc')
      return calcValue(node.children.toArray())
    return Number.NaN
  }
  const term = (): number => {
    let value = factor()
    for (let op = operator(); op === '*' || op === '/'; op = operator()) {
      index++
      const next = factor()
      value = op === '*' ? value * next : value / next
    }
    return value
  }
  let value = term()
  for (let op = operator(); op === '+' || op === '-'; op = operator()) {
    index++
    const next = term()
    value = op === '+' ? value + next : value - next
  }
  return index === nodes.length ? value : Number.NaN
}

/** A zoom factor, 1 for its identity keywords; NaN when the value cannot be read. */
function zoomScale(value: CssNode): number {
  const nodes = value.type === 'Value' ? value.children.toArray() : []
  const only = nodes.length === 1 ? nodes[0] : undefined
  const scale =
    only?.type === 'Identifier'
      ? ['normal', 'reset'].includes(only.name.toLowerCase())
        ? 1
        : Number.NaN
      : only?.type === 'Percentage'
        ? Number(only.value) / 100
        : only?.type === 'Number' ||
            (only?.type === 'Function' && only.name.toLowerCase() === 'calc')
          ? calcValue([only])
          : Number.NaN
  return Number.isFinite(scale) && scale > 0 ? scale : Number.NaN
}

/** Every Mobile zoom declaration on the strip and its cards, in source order. */
function mobileZoom(tree: CssNode, ids: ReadonlySet<string>): ZoomDeclaration[] {
  const found: ZoomDeclaration[] = []
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
        found.push({
          id,
          scale: zoomScale(declaration.value),
          value: generate(declaration.value),
          important: Boolean(declaration.important),
          rule,
          remove: () => rule.block.children.remove(item),
        })
      })
    },
  })
  return found
}

/** The declaration that applies to each id: an !important one first, then the later one. */
function effectiveZoom(declarations: readonly ZoomDeclaration[]): Map<string, ZoomDeclaration> {
  const zooms = new Map<string, ZoomDeclaration>()
  for (const declaration of declarations) {
    const current = zooms.get(declaration.id)
    if (!current || declaration.important || !current.important)
      zooms.set(declaration.id, declaration)
  }
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
  const declarations = mobileZoom(tree, new Set([ids.group, ...ids.cards]))
  const zooms = effectiveZoom(declarations)
  // An unreadable zoom keeps the stored CSS as it is: guessing would change the owner's geometry.
  // unresolvedMarqueeZoom reports it so the owner can remove it.
  if (!zooms.size || [...zooms.values()].some((zoom) => Number.isNaN(zoom.scale))) return css
  for (const declaration of declarations) declaration.remove()
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

/** Strip and card zoom that normalizeMarqueeZoom had to keep because its value is not a number,
 * a percentage or calc() over numbers (for example var(--scale)). The owner removes it by hand. */
export function unresolvedMarqueeZoom(
  document: CmsDocument,
  read: (html: string) => MarqueeIds | null = readMarqueeIds,
): readonly string[] {
  const values = new Set<string>()
  for (const page of document.presentation.pages) {
    if (page.path !== '/about') continue
    for (const variant of Object.values(page.content)) {
      const sheets = [variant.css.light, variant.css.dark].filter((css) => css.includes('zoom'))
      const ids = sheets.length ? read(variant.html) : null
      if (!ids) continue
      for (const css of sheets)
        for (const zoom of effectiveZoom(
          mobileZoom(parse(css), new Set([ids.group, ...ids.cards])),
        ).values())
          if (Number.isNaN(zoom.scale)) values.add(zoom.value)
    }
  }
  return [...values]
}
