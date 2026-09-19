import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
// @deno-types="npm:@types/css-tree@2.3.11"
import { parse, walk, generate } from 'css-tree'
import {
  CmsValidationError,
  validMediaRef,
  type CmsDocument,
  type MediaPlacement,
  type MediaRef,
} from './cms.ts'

type HtmlNode = DefaultTreeAdapterMap['node']
const TAGS = new Set(
  'a abbr address article aside b bdi bdo blockquote br button caption cite code col colgroup dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input ins kbd label legend li main mark nav ol option p pre q rp rt ruby s samp section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc use'
    .toLowerCase()
    .split(' '),
)
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href'])
const BAD_ATTRIBUTES = new Set([
  'srcdoc',
  'srcset',
  'formaction',
  'action',
  'http-equiv',
  'autofocus',
  'contenteditable',
  'is',
  'xmlns:xlink',
])
const ATTRIBUTES = new Set(
  'id class style title role dir lang tabindex href target rel download src alt width height loading decoding datetime colspan rowspan scope open name type value for form method autocomplete checked disabled required readonly selected multiple min max step minlength maxlength pattern inputmode accept placeholder rows cols viewbox preserveaspectratio d x y x1 x2 y1 y2 cx cy r rx ry points fill stroke stroke-width stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity transform offset stop-color stop-opacity gradientunits gradienttransform spreadmethod clip-path clip-rule fill-rule mask'.split(
    ' ',
  ),
)
const hasControlOrSpace = (value: string): boolean =>
  [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\')
const decodeCss = (value: string): string =>
  value.replace(
    /\\([0-9a-f]{1,6})(?:\s)?|\\([^\n\r\f])/gi,
    (_match, hex: string | undefined, char: string | undefined) =>
      hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : (char ?? ''),
  )
const reject = (path: string, message: string): never => {
  throw new CmsValidationError(path, message)
}

export interface MarkupPolicy {
  siteOrigin: string
  storageOrigin: string
  builtAssets?: readonly string[]
}
export interface MarkupFunctionalContract {
  key: string
  tag: string
  attrs: Readonly<Record<string, string>>
}
export interface MarkupValidationOptions {
  native?: boolean
  functionalContracts?: readonly MarkupFunctionalContract[]
}
const LEGACY_UNSUPPORTED_FUNCTIONAL_TAGS = new Set([
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
const CONTRACT_REQUIRED_TAGS = new Set([
  'form',
  'input',
  'select',
  'textarea',
  'label',
  'fieldset',
  'legend',
  'option',
])
export function resourceReference(raw: string, policy: MarkupPolicy): MediaRef | null {
  const value = raw.trim()
  if (hasControlOrSpace(value) || value.startsWith('//')) reject('resource', 'Invalid resource URL')
  let url: URL
  try {
    url = new URL(value, policy.siteOrigin)
  } catch {
    return reject('resource', 'Invalid resource URL')
  }
  if (url.username || url.password || url.hash || url.search)
    reject('resource', 'Resources cannot contain credentials, queries or fragments')
  if (url.origin === policy.siteOrigin && policy.builtAssets?.includes(url.pathname)) return null
  const prefix = '/storage/v1/object/public/'
  if (url.origin !== policy.storageOrigin || !url.pathname.startsWith(prefix))
    reject('resource', 'Select an uploaded or built-in resource from the library')
  const [bucket, ...parts] = url.pathname.slice(prefix.length).split('/')
  let path: string
  try {
    path = parts.map(decodeURIComponent).join('/')
  } catch {
    return reject('resource', 'Invalid encoded resource path')
  }
  const ref = { bucket, path }
  if (!validMediaRef(ref)) reject('resource', 'Invalid storage reference')
  return ref as MediaRef
}
export function safeLink(value: string, base: string): boolean {
  if (!value || hasControlOrSpace(value) || value.startsWith('//')) return false
  if (value.startsWith('#')) return /^#[a-zA-Z0-9_.:-]*$/.test(value)
  if (/^mailto:[^<>"'\s@]+@[^<>"'\s@]+$/i.test(value)) return true
  if (/^tel:\+?[0-9()-]{3,30}$/.test(value)) return true
  try {
    const url = new URL(value, base)
    return (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' || (value.startsWith('/') && url.origin === base))
    )
  } catch {
    return false
  }
}
function checkCss(css: string, policy: MarkupPolicy, inline: boolean): MediaRef[] {
  if (css.includes('</') || css.includes('\0')) reject('css', 'Unsafe stylesheet boundary')
  let tree
  try {
    tree = parse(css, {
      context: inline ? 'declarationList' : 'stylesheet',
      parseCustomProperty: true,
      onParseError: () => reject('css', 'Malformed CSS'),
    })
  } catch (error) {
    if (error instanceof CmsValidationError) throw error
    return reject('css', 'Malformed CSS')
  }
  const refs: MediaRef[] = []
  walk(tree, (node) => {
    if (node.type === 'Raw') reject('css', 'Unparsed CSS is not permitted')
    if (
      node.type === 'Atrule' &&
      ![
        'media',
        'supports',
        'container',
        'font-face',
        'keyframes',
        '-webkit-keyframes',
        'layer',
      ].includes(decodeCss(node.name).toLowerCase())
    )
      reject('css', `Unsupported @${node.name}`)
    if (
      node.type === 'Function' &&
      ['expression', 'image-set', '-webkit-image-set', 'attr'].includes(
        decodeCss(node.name).toLowerCase(),
      )
    )
      reject('css', 'Unsafe CSS function')
    if (node.type === 'Declaration') {
      const property = decodeCss(node.property).toLowerCase()
      if (['behavior', '-moz-binding'].includes(property) || property.startsWith('--cms-internal'))
        reject('css', 'Unsafe CSS property')
      if (/javascript\s*:|vbscript\s*:/i.test(decodeCss(generate(node.value))))
        reject('css', 'Unsafe CSS value')
    }
    if (node.type === 'Url') {
      const value = decodeCss(node.value)
      if (/^#[a-zA-Z][\w:.-]*$/.test(value)) return
      const ref = resourceReference(value, policy)
      if (ref) refs.push(ref)
    }
  })
  return refs
}
export function validateMarkup(
  html: string,
  css: string,
  policy: MarkupPolicy,
  options: MarkupValidationOptions = {},
): { html: string; refs: MediaRef[] } {
  if (html.length > 100000 || css.length > 100000) reject('page', 'Page exceeds its size limit')
  const nativeMode = options.native === true
  const functionalMode = options.functionalContracts !== undefined
  const contractList = options.functionalContracts ?? []
  const contracts = new Map(contractList.map((contract) => [contract.key, contract]))
  if (contracts.size !== contractList.length)
    reject('html', 'Duplicate functional contract identity')
  const refs = checkCss(css, policy, false),
    ids = new Set<string>(),
    anchors: string[] = []
  const fragment = parseFragment(html, {
    onParseError: (error) => {
      if (error.code === 'duplicate-attribute')
        reject('html', 'Duplicate attributes are not permitted')
    },
  })
  let count = 0
  const visit = (node: HtmlNode, depth: number): void => {
    if (++count > 5000 || depth > 40) reject('html', 'Page is too complex')
    if ('tagName' in node) {
      const tag = node.tagName.toLowerCase()
      if (!TAGS.has(tag)) reject('html', `Unsupported element <${tag}>`)
      const contractKey = node.attrs.find(
        (item) => item.name.toLowerCase() === 'data-cms-contract',
      )?.value
      const contract = contractKey === undefined ? undefined : contracts.get(contractKey)
      if (contractKey !== undefined && (!functionalMode || !contract || contract.tag !== tag))
        reject('html', 'Unknown or mismatched functional contract identity')
      if (!functionalMode && !nativeMode && LEGACY_UNSUPPORTED_FUNCTIONAL_TAGS.has(tag))
        reject('html', `Unsupported element <${tag}>`)
      if (functionalMode && CONTRACT_REQUIRED_TAGS.has(tag) && !contract)
        reject('html', `Functional element <${tag}> requires a trusted contract`)
      if (functionalMode && tag === 'button' && !contract) {
        const type = node.attrs.find((item) => item.name.toLowerCase() === 'type')?.value
        if (type !== 'button') reject('html', 'Unbound buttons must use type="button"')
      }
      for (const attr of node.attrs) {
        const name = attr.name.toLowerCase(),
          value = attr.value
        if (
          name.startsWith('on') ||
          BAD_ATTRIBUTES.has(name) ||
          name.startsWith('data-gjs-') ||
          (name.startsWith('data-cms-') && name !== 'data-cms-contract')
        )
          reject('html', `Unsupported attribute ${name}`)
        if (attr.namespace && !(tag === 'use' && name === 'href'))
          reject('html', 'Unsupported namespaced attribute')
        if (name === 'data-cms-contract') {
          if (!functionalMode || !contract || value !== contract.key)
            reject('html', 'Unknown functional contract identity')
          continue
        }
        const runtimeData = name.startsWith('data-') && !name.startsWith('data-cms-')
        const trustedRuntimeData = functionalMode && runtimeData && contract?.attrs[name] === value
        if (functionalMode && runtimeData && !trustedRuntimeData)
          reject('html', 'Functional data hook does not match its trusted contract')
        if (
          !(nativeMode && (name.startsWith('data-knc-') || name === 'inert')) &&
          !ATTRIBUTES.has(name) &&
          !/^aria-[a-z-]+$/.test(name) &&
          !(functionalMode ? trustedRuntimeData : /^data-business-[a-z-]+$/.test(name))
        )
          reject('html', `Unsupported attribute ${name}`)
        if (value.length > 10000 || value.includes('\0')) reject('html', 'Invalid attribute value')
        if (name.startsWith('data-knc-')) {
          if (
            !nativeMode ||
            ![
              'data-knc-native',
              'data-knc-source',
              'data-knc-slot',
              'data-knc-required',
              'data-knc-surface',
              'data-knc-light',
              'data-knc-dark',
              'data-knc-baseline',
              'data-knc-dark-attrs',
            ].includes(name)
          )
            reject('html', 'Unknown native presentation metadata')
          if (name === 'data-knc-light' || name === 'data-knc-dark')
            refs.push(...checkCss(value, policy, true))
          else if (name === 'data-knc-baseline' || name === 'data-knc-dark-attrs') {
            let metadata: unknown
            try {
              metadata = JSON.parse(value)
            } catch {
              reject('html', 'Invalid native metadata')
            }
            if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
              reject('html', 'Invalid native metadata')
            for (const [key, item] of Object.entries(metadata as Record<string, unknown>)) {
              if (
                ![
                  'class',
                  'title',
                  'href',
                  'target',
                  'rel',
                  'src',
                  'alt',
                  'aria-label',
                  'text',
                ].includes(key) ||
                typeof item !== 'string'
              )
                reject('html', 'Invalid native metadata field')
              if (key === 'href' && !safeLink(item as string, policy.siteOrigin))
                reject('html', 'Unsafe native link')
              if (key === 'src') {
                const ref = resourceReference(item as string, policy)
                if (ref) refs.push(ref)
              }
            }
          } else if (!/^[a-zA-Z0-9_-]{1,240}$/.test(value))
            reject('html', 'Invalid native identity')
        }
        if (name === 'id') {
          if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(value) || ids.has(value))
            reject('html', 'Invalid or duplicate element ID')
          ids.add(value)
        }
        if (name === 'style') refs.push(...checkCss(value, policy, true))
        if (URL_ATTRIBUTES.has(name)) {
          if (tag === 'a' && name === 'href') {
            if (!safeLink(value, policy.siteOrigin)) reject('href', 'Unsupported link')
            if (value.length > 1 && value[0] === '#') anchors.push(value.slice(1))
          } else if (tag === 'use' && name === 'href') {
            if (!/^#[a-zA-Z][\w:.-]*$/.test(value))
              reject('svg', 'SVG use must reference this document')
            anchors.push(value.slice(1))
          } else {
            const ref = resourceReference(value, policy)
            if (ref) refs.push(ref)
          }
        }
        if (name === 'tabindex' && value !== '0' && value !== '-1')
          reject('html', 'Only natural or programmatic focus order is supported')
      }
      if (
        tag === 'a' &&
        node.attrs.some((attr) => attr.name === 'target' && attr.value === '_blank')
      ) {
        const rel = node.attrs.find((attr) => attr.name === 'rel')
        if (rel)
          rel.value = [...new Set([...rel.value.split(/\s+/), 'noopener', 'noreferrer'])].join(' ')
        else node.attrs.push({ name: 'rel', value: 'noopener noreferrer' })
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, depth + 1)
  }
  visit(fragment, 0)
  for (const anchor of anchors) if (!ids.has(anchor)) reject('href', `Missing anchor #${anchor}`)
  return { html: serialize(fragment), refs }
}
const RUNTIME_SLOTS: Readonly<Record<string, string>> = {
  '/about': 'knc-about-runtime',
  '/booking': 'knc-booking-runtime',
  '/my-bookings': 'knc-my-bookings-runtime',
}

function validateRuntimeSlot(path: string, lang: 'sv' | 'en', html: string): void {
  const required = RUNTIME_SLOTS[path]
  if (!required) return
  const fragment = parseFragment(html)
  let found = false
  const visit = (node: HtmlNode): void => {
    if (
      'tagName' in node &&
      node.attrs.some((attr) => attr.name === 'id' && attr.value === required)
    )
      found = true
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(fragment)
  if (!found)
    reject(`presentation.${path}.${lang}`, `Required runtime island #${required} is missing`)
}

function validateLegalSlots(path: string, lang: 'sv' | 'en', html: string): void {
  if (path !== '/privacy' && path !== '/terms') return

  const fragment = parseFragment(html)
  const ids = new Set<string>()
  let hasBusinessName = false
  let hasBusinessContact = false
  let hasBusinessController = false

  const visit = (node: HtmlNode): void => {
    if ('tagName' in node) {
      for (const attr of node.attrs) {
        if (attr.name === 'id') ids.add(attr.value)
        if (attr.name === 'data-business-name') hasBusinessName = true
        if (attr.name === 'data-business-contact') hasBusinessContact = true
        if (attr.name === 'data-business-controller' && attr.value === lang)
          hasBusinessController = true
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(fragment)

  const missing: string[] = []
  if (!ids.has(`legal-business-details-${lang}`)) missing.push(`#legal-business-details-${lang}`)
  if (path === '/terms' && !ids.has(`cancellation-policy-${lang}`))
    missing.push(`#cancellation-policy-${lang}`)
  if (path === '/privacy') {
    if (!hasBusinessName) missing.push('[data-business-name]')
    if (!hasBusinessController) missing.push(`[data-business-controller="${lang}"]`)
    if (!hasBusinessContact) missing.push('[data-business-contact]')
  }

  if (missing.length > 0)
    reject(
      `presentation.${path}.${lang}`,
      `Legal page is missing required server-owned slot(s): ${missing.join(', ')}`,
    )
}

function appendPlacements(
  placements: MediaPlacement[],
  refs: readonly MediaRef[],
  base: string,
): void {
  refs.forEach((ref, index) => placements.push({ placement: `${base}:${index}`, ref }))
}

export function validateDocumentMarkupPlacements(
  document: CmsDocument,
  policy: MarkupPolicy,
): MediaPlacement[] {
  const placements: MediaPlacement[] = []

  for (const page of document.presentation.pages) {
    for (const lang of ['sv', 'en'] as const) {
      const variant = page.content[lang]
      const native = variant.html.includes('data-knc-native="1"')
      if (native && !['/', '/about', '/booking', '/my-bookings'].includes(page.path))
        reject('page', 'Native presentation is restricted to the existing site')
      const html = validateMarkup(variant.html, '', policy, { native })
      variant.html = html.html
      appendPlacements(placements, html.refs, `presentation.pages:${page.id}:${lang}:html`)
      for (const mode of ['light', 'dark'] as const) {
        const css = validateMarkup('', variant.css[mode], policy)
        appendPlacements(placements, css.refs, `presentation.pages:${page.id}:${lang}:css:${mode}`)
      }
    }
  }

  for (const [name, content] of Object.entries(document.presentation.regions)) {
    if (!content) continue
    for (const lang of ['sv', 'en'] as const) {
      const variant = content[lang]
      const html = validateMarkup(variant.html, '', policy)
      variant.html = html.html
      appendPlacements(placements, html.refs, `presentation.regions:${name}:${lang}:html`)
      for (const mode of ['light', 'dark'] as const) {
        const css = validateMarkup('', variant.css[mode], policy)
        appendPlacements(placements, css.refs, `presentation.regions:${name}:${lang}:css:${mode}`)
      }
    }
  }

  for (const page of document.presentation.pages)
    for (const lang of ['sv', 'en'] as const) {
      if (!page.content[lang].html.includes('data-knc-native="1"'))
        validateRuntimeSlot(page.path, lang, page.content[lang].html)
      validateLegalSlots(page.path, lang, page.content[lang].html)
    }

  return placements
}
