import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import {
  CmsValidationError,
  isPagePath,
  type CmsLang,
  type Localized,
  type MediaPlacement,
} from './cms.ts'
import {
  validateMarkup,
  type MarkupFunctionalContract,
  type MarkupPolicy,
} from './cms-markup.ts'

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

const SOURCE_FUNCTION_TAGS = new Set([
  'form',
  'input',
  'select',
  'textarea',
  'button',
  'label',
  'fieldset',
  'legend',
  'option',
])
const REFERENCE_ATTRIBUTES = new Set([
  'for',
  'form',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'aria-activedescendant',
])
const FIXED_ATTRIBUTES = new Set([
  'id',
  'name',
  'type',
  'value',
  'for',
  'form',
  'role',
  'method',
  'tabindex',
  'autocomplete',
  'checked',
  'disabled',
  'required',
  'readonly',
  'selected',
  'multiple',
  'min',
  'max',
  'step',
  'minlength',
  'maxlength',
  'pattern',
  'inputmode',
  'accept',
])
const SOURCE_ONLY_DATA = new Set(['data-testid', 'data-scroll-progress'])
const LEGAL_SLOT_ID = /^(?:legal-business-details|cancellation-policy)-(?:sv|en)$/
const CONTRACT_KEY = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/
const PAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/

export type CmsCanonicalPageKind = 'page' | 'privacy' | 'terms'

export interface CmsCanonicalPageVariant {
  html: string
  css: string
}

export interface CmsCanonicalPage {
  id: string
  kind: CmsCanonicalPageKind
  path: string
  name: Localized
  title: Localized
  description: Localized
  content: Record<CmsLang, CmsCanonicalPageVariant>
  inMenu: boolean
}

export interface CmsCanonicalProject {
  schema: 1
  pages: CmsCanonicalPage[]
}

export interface CmsFunctionalContract extends MarkupFunctionalContract {
  parent: string | null
}

export interface CmsProjectSeedPage {
  id: string
  kind: CmsCanonicalPageKind
  path: string
  required: boolean
  pathLocked: boolean
  contracts: Record<CmsLang, readonly CmsFunctionalContract[]>
}

export interface CmsProjectSeed {
  pages: readonly CmsProjectSeedPage[]
}

export interface CmsCanonicalSourcePage extends CmsCanonicalPage {
  required: boolean
  pathLocked: boolean
}

export interface CmsCanonicalSource {
  schema: 1
  pages: CmsCanonicalSourcePage[]
}

export interface CmsProjectValidationResult {
  project: CmsCanonicalProject
  placements: MediaPlacement[]
}

function fail(path: string, message: string): never {
  throw new CmsValidationError(path, message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail(path, 'Expected an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'Unsupported field')
}

function stringValue(value: unknown, path: string, max: number, min = 0): string {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    value.includes('\0')
  )
    fail(path, `Expected ${min}–${max} characters`)
  return value
}

function localized(value: unknown, path: string, max: number, min = 0): Localized {
  const source = record(value, path)
  exactKeys(source, ['sv', 'en'], path)
  return {
    sv: stringValue(source['sv'], `${path}.sv`, max, min),
    en: stringValue(source['en'], `${path}.en`, max, min),
  }
}

function attribute(node: HtmlElement, name: string): string | undefined {
  return node.attrs.find((item) => item.name.toLowerCase() === name)?.value
}

function elements(root: HtmlNode): HtmlElement[] {
  const found: HtmlElement[] = []
  const visit = (node: HtmlNode): void => {
    if ('tagName' in node) found.push(node)
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(root)
  return found
}

function isRuntimeData(name: string): boolean {
  return (
    name.startsWith('data-') &&
    !name.startsWith('data-cms-') &&
    !SOURCE_ONLY_DATA.has(name)
  )
}

function fixedAttribute(name: string, value: string): boolean {
  return (
    FIXED_ATTRIBUTES.has(name) ||
    isRuntimeData(name) ||
    (name.startsWith('aria-') && name !== 'aria-label' && name !== 'aria-description') ||
    (name === 'href' && value.startsWith('#'))
  )
}

function referenceTargets(name: string, value: string): string[] {
  if (name === 'href' && value.startsWith('#') && value.length > 1) return [value.slice(1)]
  if (!REFERENCE_ATTRIBUTES.has(name)) return []
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function candidateKey(node: HtmlElement, legacy: string | undefined, index: number): string {
  const id = attribute(node, 'id')
  for (const value of [id ? `f-${id}` : undefined, legacy, `f${index}`])
    if (value && CONTRACT_KEY.test(value)) return value
  return `f${index}`
}

export function prepareFunctionalMarkup(html: string): {
  html: string
  contracts: CmsFunctionalContract[]
} {
  if (typeof html !== 'string' || html.length > 500000) fail('html', 'Invalid trusted page source')
  const fragment = parseFragment(html, { scriptingEnabled: false })
  const nodes = elements(fragment)
  const legacyKeys = new Map<HtmlElement, string | undefined>()
  const byId = new Map<string, HtmlElement>()

  for (const node of nodes) {
    legacyKeys.set(node, attribute(node, 'data-cms-node'))
    node.attrs = node.attrs.filter(
      (item) => !item.name.startsWith('data-cms-') && !SOURCE_ONLY_DATA.has(item.name),
    )
    const id = attribute(node, 'id')
    if (id && !byId.has(id)) byId.set(id, node)
  }

  const protectedNodes = new Set<HtmlElement>()
  for (const node of nodes) {
    const id = attribute(node, 'id')
    if (
      SOURCE_FUNCTION_TAGS.has(node.tagName.toLowerCase()) ||
      attribute(node, 'role') !== undefined ||
      node.attrs.some((item) => isRuntimeData(item.name)) ||
      (id !== undefined && LEGAL_SLOT_ID.test(id))
    )
      protectedNodes.add(node)
  }

  for (const node of [...protectedNodes])
    for (const item of node.attrs)
      for (const target of referenceTargets(item.name.toLowerCase(), item.value)) {
        const targetNode = byId.get(target)
        if (targetNode) protectedNodes.add(targetNode)
      }

  const keys = new Map<HtmlElement, string>()
  const used = new Set<string>()
  let sequence = 0
  for (const node of nodes) {
    if (!protectedNodes.has(node)) continue
    let key = candidateKey(node, legacyKeys.get(node), sequence++)
    while (used.has(key)) key = `f${sequence++}`
    used.add(key)
    keys.set(node, key)
    node.attrs.push({ name: 'data-cms-contract', value: key })
  }

  const contracts: CmsFunctionalContract[] = []
  for (const node of nodes) {
    const key = keys.get(node)
    if (!key) continue
    const attrs: Record<string, string> = {}
    for (const item of node.attrs) {
      const name = item.name.toLowerCase()
      if (name !== 'data-cms-contract' && fixedAttribute(name, item.value)) attrs[name] = item.value
    }

    let parent = node.parentNode
    let protectedParent: string | null = null
    while (parent) {
      if ('tagName' in parent) {
        const parentKey = keys.get(parent)
        if (parentKey) {
          protectedParent = parentKey
          break
        }
      }
      parent = 'parentNode' in parent ? parent.parentNode : null
    }
    contracts.push({ key, tag: node.tagName.toLowerCase(), attrs, parent: protectedParent })
  }

  return { html: serialize(fragment), contracts }
}

function validateFunctionalMarkup(html: string, contracts: readonly CmsFunctionalContract[]): void {
  const fragment = parseFragment(html, { scriptingEnabled: true })
  const nodes = elements(fragment)
  const expected = new Map(contracts.map((contract) => [contract.key, contract]))
  if (expected.size !== contracts.length) fail('contracts', 'Duplicate trusted contract identity')

  const found = new Map<string, HtmlElement>()
  const ids = new Set<string>()
  for (const node of nodes) {
    const id = attribute(node, 'id')
    if (id) ids.add(id)
    const key = attribute(node, 'data-cms-contract')
    if (!key) continue
    const contract = expected.get(key)
    if (!contract) fail('html', 'Unknown functional contract identity')
    if (found.has(key)) fail('html', 'A protected functional element was duplicated')
    found.set(key, node)
    if (node.tagName.toLowerCase() !== contract.tag)
      fail('html', 'A protected functional element changed element type')
    for (const [name, value] of Object.entries(contract.attrs))
      if (attribute(node, name) !== value)
        fail('html', `Protected functional attribute ${name} was changed`)
    for (const item of node.attrs) {
      const name = item.name.toLowerCase()
      if (
        name !== 'data-cms-contract' &&
        fixedAttribute(name, item.value) &&
        !Object.hasOwn(contract.attrs, name)
      )
        fail('html', `Protected functional attribute ${name} was introduced`)
    }
  }

  for (const contract of contracts) {
    const node = found.get(contract.key)
    if (!node) fail('html', 'A required functional element is missing')
    let parent = node.parentNode
    let protectedParent: string | null = null
    while (parent) {
      if ('tagName' in parent) {
        const key = attribute(parent, 'data-cms-contract')
        if (key && expected.has(key)) {
          protectedParent = key
          break
        }
      }
      parent = 'parentNode' in parent ? parent.parentNode : null
    }
    if (protectedParent !== contract.parent)
      fail('html', 'A protected functional element was moved outside its functional island')

    for (const [name, value] of Object.entries(contract.attrs))
      for (const target of referenceTargets(name, value))
        if (!ids.has(target))
          fail('html', `Protected accessibility reference ${name} lost target #${target}`)
  }
}

function validCustomPath(path: string): boolean {
  if (path === '/') return false
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  return normalized.length > 0 && isPagePath(normalized)
}

function appendPlacements(
  placements: MediaPlacement[],
  refs: readonly MediaPlacement['ref'][],
  base: string,
): void {
  refs.forEach((ref, index) => placements.push({ placement: `${base}:${index}`, ref }))
}

export function prepareCanonicalSource(source: CmsCanonicalSource): {
  project: CmsCanonicalProject
  seed: CmsProjectSeed
} {
  const pages: CmsCanonicalPage[] = []
  const seedPages: CmsProjectSeedPage[] = []

  for (const page of source.pages) {
    const contracts = {} as Record<CmsLang, readonly CmsFunctionalContract[]>
    const content = {} as Record<CmsLang, CmsCanonicalPageVariant>
    for (const lang of ['sv', 'en'] as const) {
      const prepared = prepareFunctionalMarkup(page.content[lang].html)
      contracts[lang] = prepared.contracts
      content[lang] = { html: prepared.html, css: page.content[lang].css }
    }
    pages.push({
      id: page.id,
      kind: page.kind,
      path: page.path,
      name: { ...page.name },
      title: { ...page.title },
      description: { ...page.description },
      content,
      inMenu: page.inMenu,
    })
    seedPages.push({
      id: page.id,
      kind: page.kind,
      path: page.path,
      required: page.required,
      pathLocked: page.pathLocked,
      contracts,
    })
  }

  return { project: { schema: 1, pages }, seed: { pages: seedPages } }
}

export function validateCanonicalProject(
  value: unknown,
  seed: CmsProjectSeed,
  policy: MarkupPolicy,
): CmsProjectValidationResult {
  const root = record(value, 'project')
  exactKeys(root, ['schema', 'pages'], 'project')
  if (root['schema'] !== 1) fail('project.schema', 'Unsupported schema version')
  if (!Array.isArray(root['pages']) || root['pages'].length < 1 || root['pages'].length > 64)
    fail('project.pages', 'Expected 1–64 pages')

  const seedById = new Map(seed.pages.map((page) => [page.id, page]))
  if (seedById.size !== seed.pages.length) fail('seed.pages', 'Duplicate trusted page identity')
  const ids = new Set<string>()
  const paths = new Set<string>()
  const placements: MediaPlacement[] = []
  const pages: CmsCanonicalPage[] = []

  for (const rawPage of root['pages']) {
    const page = record(rawPage, 'page')
    exactKeys(
      page,
      ['id', 'kind', 'path', 'name', 'title', 'description', 'content', 'inMenu'],
      'page',
    )
    const id = stringValue(page['id'], 'page.id', 128, 1)
    if (!PAGE_ID.test(id) || ids.has(id)) fail('page.id', 'Invalid or duplicate page identity')
    ids.add(id)

    const trusted = seedById.get(id)
    const kind = page['kind']
    if (!['page', 'privacy', 'terms'].includes(String(kind))) fail(`page.${id}.kind`, 'Invalid page kind')
    if (trusted && kind !== trusted.kind) fail(`page.${id}.kind`, 'Protected page kind cannot change')
    if (!trusted && kind !== 'page') fail(`page.${id}.kind`, 'Only ordinary custom pages may be created')

    const path = stringValue(page['path'], `page.${id}.path`, 100, 1)
    if (trusted?.pathLocked && path !== trusted.path)
      fail(`page.${id}.path`, 'Protected page path cannot change')
    if ((!trusted || path !== trusted.path) && !validCustomPath(path))
      fail(`page.${id}.path`, 'Reserved or invalid custom page path')
    if (paths.has(path)) fail(`page.${id}.path`, 'Duplicate page path')
    paths.add(path)

    const contentRecord = record(page['content'], `page.${id}.content`)
    exactKeys(contentRecord, ['sv', 'en'], `page.${id}.content`)
    const content = {} as Record<CmsLang, CmsCanonicalPageVariant>
    for (const lang of ['sv', 'en'] as const) {
      const variant = record(contentRecord[lang], `page.${id}.content.${lang}`)
      exactKeys(variant, ['html', 'css'], `page.${id}.content.${lang}`)
      const html = stringValue(variant['html'], `page.${id}.content.${lang}.html`, 100000)
      const css = stringValue(variant['css'], `page.${id}.content.${lang}.css`, 100000)
      const contracts = trusted?.contracts[lang] ?? []
      const checkedHtml = validateMarkup(html, '', policy, { functionalContracts: contracts })
      validateFunctionalMarkup(checkedHtml.html, contracts)
      const checkedCss = validateMarkup('', css, policy, { functionalContracts: [] })
      appendPlacements(placements, checkedHtml.refs, `project.pages:${id}:${lang}:html`)
      appendPlacements(placements, checkedCss.refs, `project.pages:${id}:${lang}:css`)
      content[lang] = { html: checkedHtml.html, css }
    }

    if (typeof page['inMenu'] !== 'boolean') fail(`page.${id}.inMenu`, 'Invalid menu state')
    pages.push({
      id,
      kind: kind as CmsCanonicalPageKind,
      path,
      name: localized(page['name'], `page.${id}.name`, 80, 1),
      title: localized(page['title'], `page.${id}.title`, 160, 1),
      description: localized(page['description'], `page.${id}.description`, 500),
      content,
      inMenu: page['inMenu'],
    })
  }

  for (const trusted of seed.pages)
    if (trusted.required && !ids.has(trusted.id))
      fail(`project.pages.${trusted.id}`, 'Required system page is missing')

  return { project: { schema: 1, pages }, placements }
}
