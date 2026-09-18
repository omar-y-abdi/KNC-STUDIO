import { generate, parse, walk } from 'css-tree'
import type { Component, Editor } from 'grapesjs'

const ID_REFERENCE_ATTRIBUTES = new Set([
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-details',
  'aria-errormessage',
  'aria-activedescendant',
  'for',
  'headers',
  'list',
  'form',
])

const CSS_REFERENCE_ATTRIBUTES = new Set(['fill', 'stroke', 'clip-path', 'mask', 'filter'])

let fallbackIdentity = 0

function freshIdentity(): string {
  const bytes = new Uint8Array(12)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return `u-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  fallbackIdentity += 1
  return `u-clone-${fallbackIdentity.toString(36)}`
}

function freshDomId(source: string): string {
  return `${source.slice(0, 96)}-copy-${freshIdentity().slice(2)}`
}

function mappedId(value: string, ids: ReadonlyMap<string, string>): string {
  return ids.get(value) ?? value
}

function mapCss(
  source: string,
  context: 'value' | 'declarationList' | 'selectorList',
  ids: ReadonlyMap<string, string>,
): string {
  if (!source) return source
  try {
    const tree = parse(source, { context })
    walk(tree, (node) => {
      if (node.type === 'Url' && node.value.startsWith('#')) {
        const current = node.value.slice(1)
        node.value = `#${mappedId(current, ids)}`
      }
      if (context === 'selectorList' && node.type === 'IdSelector') {
        node.name = mappedId(node.name, ids)
      }
    })
    return generate(tree)
  } catch {
    return source
  }
}

function selectorIds(source: string): Set<string> {
  const ids = new Set<string>()
  try {
    const tree = parse(source, { context: 'selectorList' })
    walk(tree, (node) => {
      if (node.type === 'IdSelector') ids.add(node.name)
    })
  } catch {
    // Invalid intermediate selectors remain editable and will fail normal Save validation.
  }
  return ids
}

function defaultOrigin(): string {
  return typeof location === 'undefined' ? 'https://cms.invalid' : location.origin
}

function samePageHref(
  value: string,
  ids: ReadonlyMap<string, string>,
  pagePath: string,
  origin: string,
): string {
  const hashIndex = value.indexOf('#')
  if (hashIndex < 0) return value
  const fragment = value.slice(hashIndex + 1)
  const next = ids.get(fragment)
  if (!next) return value
  if (hashIndex === 0) return `#${next}`

  try {
    const current = new URL(pagePath, origin)
    const target = new URL(value, origin)
    if (target.origin !== current.origin || target.pathname !== current.pathname) return value
    return `${value.slice(0, hashIndex + 1)}${next}`
  } catch {
    return value
  }
}

export function remapSelectorIds(selector: string, ids: ReadonlyMap<string, string>): string {
  return mapCss(selector, 'selectorList', ids)
}

export function remapCloneStyle(
  style: Readonly<Record<string, string>>,
  ids: ReadonlyMap<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(style).map(([name, value]) => [name, mapCss(String(value), 'value', ids)]),
  )
}

export function remapCloneAttributes(
  attributes: Readonly<Record<string, string>>,
  ids: ReadonlyMap<string, string>,
  pagePath = '/',
  origin = defaultOrigin(),
): Record<string, string> {
  const next = { ...attributes }

  for (const [name, raw] of Object.entries(next)) {
    const value = String(raw)
    if (ID_REFERENCE_ATTRIBUTES.has(name)) {
      next[name] = value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => mappedId(id, ids))
        .join(' ')
    } else if (name === 'href' || name === 'xlink:href') {
      next[name] = samePageHref(value, ids, pagePath, origin)
    } else if (name === 'style') {
      next[name] = mapCss(value, 'declarationList', ids)
    } else if (CSS_REFERENCE_ATTRIBUTES.has(name)) {
      next[name] = mapCss(value, 'value', ids)
    }
  }

  return next
}

function componentDomId(component: Component): string {
  const explicit = component.getAttributes()['id']
  return typeof explicit === 'string' && explicit ? explicit : component.getId()
}

function clonePairs(original: Component, clone: Component): Array<[Component, Component]> {
  const pairs: Array<[Component, Component]> = []

  const pair = (source: Component, copy: Component): void => {
    pairs.push([source, copy])
    source.components().forEach((child, index) => {
      const copiedChild = copy.components().at(index)
      if (copiedChild) pair(child, copiedChild)
    })
  }

  pair(original, clone)
  return pairs
}

function ensureDistinctExplicitIds(pairs: Array<[Component, Component]>): void {
  for (const [source, copy] of pairs) {
    const sourceId = source.getAttributes()['id']
    const copyAttributes = copy.getAttributes()
    if (typeof sourceId === 'string' && sourceId && copyAttributes['id'] === sourceId) {
      copy.setAttributes({ ...copyAttributes, id: freshDomId(sourceId) })
    }
  }
}

function cssEscape(value: string): string {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
}

function sameStyle(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key])
}

export function remapClone(
  original: Component,
  clone: Component,
  editor: Editor,
  options: { origin?: string } = {},
): void {
  const pairs = clonePairs(original, clone)
  ensureDistinctExplicitIds(pairs)

  const ids = new Map<string, string>()
  for (const [source, copy] of pairs) {
    ids.set(componentDomId(source), componentDomId(copy))
  }

  const copiedIds = new Set(ids.values())
  const pagePath = editor.getWrapper().getAttributes()['data-page'] ?? '/'
  const origin = options.origin ?? defaultOrigin()

  for (const [, copy] of pairs) {
    const attributes = remapCloneAttributes(copy.getAttributes(), ids, pagePath, origin)
    const identity = freshIdentity()
    if (attributes['data-cms-node']) attributes['data-cms-node'] = identity
    copy.setAttributes(attributes)
    copy.set('cmsCloneIdentity', identity)
    copy.setStyle(remapCloneStyle(copy.getStyle(), ids))
  }

  const rules = [...editor.Css.getAll().models]
  for (const rule of rules) {
    const selectors = rule.getSelectorsString()
    const belongsToClone = [...selectorIds(selectors)].some((id) => copiedIds.has(id))
    const mappedSelectors = remapSelectorIds(selectors, ids)
    const originalStyle = rule.getStyle()
    const style = remapCloneStyle(originalStyle, ids)
    const changedStyle = !sameStyle(style, originalStyle)

    if (belongsToClone) {
      if (changedStyle) rule.setStyle(style)
      continue
    }

    if (mappedSelectors === selectors && !changedStyle) continue

    const selector =
      mappedSelectors !== selectors
        ? mappedSelectors
        : `#${cssEscape(componentDomId(clone))}:is(${selectors}),#${cssEscape(componentDomId(clone))} :is(${selectors})`

    const atRuleType = rule.get('atRuleType')
    const mediaText = rule.get('mediaText')
    const ruleOptions = {
      ...(typeof atRuleType === 'string' && atRuleType ? { atRuleType } : {}),
      ...(typeof mediaText === 'string' && mediaText ? { atRuleParams: mediaText } : {}),
    }

    editor.Css.setRule(selector, style, ruleOptions)
  }
}

export function installCloneSafety(editor: Editor): void {
  editor.on('component:create', (component: Component) => {
    component.on('component:clone', (clone: Component) => {
      remapClone(component, clone, editor)
    })
  })
}
