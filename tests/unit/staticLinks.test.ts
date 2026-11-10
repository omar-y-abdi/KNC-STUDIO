import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseCss, walk, type CssNode } from 'css-tree'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import worker, { PublicContent } from '../../supabase/worker/index'

// Every reference the shipped files write (checklist items 33 and 82): one on the site's origin
// must reach a deployed file, a bundler input or a real Worker route; a fragment must name an id.

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PUBLIC_DIR = join(ROOT, 'public')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** The origin the Worker serves (SITE_URL in supabase/worker/index.ts); its www host redirects
 * there. A link to either host is a link to the site. */
const SITE = 'https://bladeblendstudio.se'
const SITE_HOSTS: readonly string[] = ['bladeblendstudio.se', 'www.bladeblendstudio.se']

/** One URL as a shipped file writes it, and where. */
interface Reference {
  /** The repository path of the file that holds it. */
  readonly file: string
  readonly line: number
  /** What holds it: `a[href]`, `meta[og:image]`, `url()`, `Sitemap:`, `icons[0].src`, ... */
  readonly holder: string
  /** The URL as written, with HTML character references decoded. */
  readonly value: string
}

/** How a shipped file writes its references. */
type Format = 'html' | 'css' | 'markdown' | 'robots' | 'sitemap' | 'manifest'

interface Shipped {
  readonly file: string
  readonly format: Format
  readonly text: string
}

/** Why a reference reaches nothing a visitor can use. */
type Problem =
  | { readonly kind: 'empty' }
  /** A build placeholder that nothing replaces in this file. */
  | { readonly kind: 'placeholder'; readonly placeholder: string }
  | { readonly kind: 'unparseable' }
  | { readonly kind: 'scheme'; readonly scheme: string }
  /** http: where the link must be https:. */
  | { readonly kind: 'insecure' }
  | { readonly kind: 'mailto' }
  | { readonly kind: 'tel' }
  /** A path under /assets/, where only hashed build output lives. */
  | { readonly kind: 'build-output' }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'redirect'; readonly status: number; readonly location: string | null }
  /** `document` is the shipped file for a fragment of its own, else the path the Worker answered. */
  | { readonly kind: 'fragment'; readonly fragment: string; readonly document: string }
  /** A fragment on an answer that is not markup, so it has no ids. */
  | { readonly kind: 'fragment-target'; readonly contentType: string }

interface Finding {
  readonly reference: Reference
  readonly problem: Problem
}

// --- reading the shipped files -------------------------------------------------------------------

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

/** Every node in document order, the content of each `<template>` included. */
function* nodesOf(node: Node): Generator<Node> {
  yield node
  if ('childNodes' in node) for (const child of node.childNodes) yield* nodesOf(child)
  if ('content' in node) yield* nodesOf(node.content)
}
const isElement = (node: Node): node is Element => 'tagName' in node
const attr = (element: Element, name: string): string | undefined =>
  element.attrs.find((item) => item.name === name)?.value

/** As a browser reads the file: `<noscript>` content is markup to a visitor without scripts. */
const parseMarkup = (markup: string): DefaultTreeAdapterMap['document'] =>
  parse(markup, { sourceCodeLocationInfo: true, scriptingEnabled: false })

function attributeLine(element: Element, name: string): number {
  const location = element.sourceCodeLocation
  return location?.attrs?.[name]?.startLine ?? location?.startLine ?? 0
}

/** Attributes that hold one URL on whichever element carries them. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
])
/** `<meta>` properties and names whose content is a URL: Open Graph and Twitter cards. */
const URL_METAS: ReadonlySet<string> = new Set([
  'og:url',
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'og:audio',
  'og:video',
  'twitter:image',
  'twitter:image:src',
  'twitter:url',
])

/** The URLs of a `srcset`, as the HTML candidate parser splits it: a URL runs to the next white
 * space and its descriptors to the next comma outside parentheses. */
function srcsetUrls(value: string): string[] {
  const urls: string[] = []
  let at = 0
  while (at < value.length) {
    while (at < value.length && /[\s,]/.test(value.charAt(at))) at++
    if (at >= value.length) break
    let end = at
    while (end < value.length && !/\s/.test(value.charAt(end))) end++
    const url = value.slice(at, end)
    if (url.endsWith(',')) {
      urls.push(url.replace(/,+$/, ''))
      at = end
      continue
    }
    urls.push(url)
    let depth = 0
    while (end < value.length && (value.charAt(end) !== ',' || depth > 0)) {
      if (value.charAt(end) === '(') depth++
      else if (value.charAt(end) === ')') depth = Math.max(0, depth - 1)
      end++
    }
    at = end
  }
  return urls
}

function cssReferences(file: string, css: string, line = 1): Reference[] {
  const found: Reference[] = []
  walk(parseCss(css, { positions: true, line }), (node: CssNode) => {
    if (node.type === 'Url')
      found.push({ file, line: node.loc?.start.line ?? line, holder: 'url()', value: node.value })
    else if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
      const first =
        node.prelude?.type === 'AtrulePrelude' ? node.prelude.children.toArray()[0] : null
      if (first?.type === 'String')
        found.push({
          file,
          line: first.loc?.start.line ?? line,
          holder: '@import',
          value: first.value,
        })
    }
  })
  return found
}

function htmlReferences(file: string, markup: string): Reference[] {
  const found: Reference[] = []
  for (const node of nodesOf(parseMarkup(markup))) {
    if (!isElement(node)) continue
    const tag = node.tagName
    for (const attribute of node.attrs) {
      const name = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name
      const line = attributeLine(node, name)
      if (URL_ATTRIBUTES.has(attribute.name))
        found.push({ file, line, holder: `${tag}[${name}]`, value: attribute.value })
      else if (attribute.name === 'srcset')
        for (const value of srcsetUrls(attribute.value))
          found.push({ file, line, holder: `${tag}[srcset]`, value })
    }
    const content = attr(node, 'content')
    const key = (attr(node, 'property') ?? attr(node, 'name'))?.toLowerCase()
    if (tag === 'meta' && content !== undefined && key !== undefined && URL_METAS.has(key))
      found.push({
        file,
        line: attributeLine(node, 'content'),
        holder: `meta[${key}]`,
        value: content,
      })
    if (tag === 'style')
      for (const child of node.childNodes)
        if ('value' in child)
          found.push(...cssReferences(file, child.value, child.sourceCodeLocation?.startLine ?? 1))
  }
  return found
}

/** The `<loc>` of each sitemap entry, at the line its URL starts on, and the alternates' hrefs. */
function sitemapReferences(file: string, xml: string): Reference[] {
  const locations: Reference[] = []
  for (const node of nodesOf(parseMarkup(xml))) {
    if (!isElement(node) || node.tagName !== 'loc') continue
    for (const child of node.childNodes) {
      if (!('value' in child)) continue
      const leading = child.value.slice(0, child.value.search(/\S|$/))
      const start = (child.sourceCodeLocation?.startLine ?? 0) + leading.split('\n').length - 1
      locations.push({ file, line: start, holder: '<loc>', value: child.value.trim() })
    }
  }
  return [...htmlReferences(file, xml), ...locations].sort((a, b) => a.line - b.line)
}

/** Markdown link targets and bare http(s) URLs outside them (llms.txt). */
function markdownReferences(file: string, text: string): Reference[] {
  const found: { readonly offset: number; readonly reference: Reference }[] = []
  const targets: (readonly [number, number])[] = []
  for (const match of text.matchAll(/\]\(([^()\s]+)\)/g)) {
    const value = match[1] ?? ''
    const offset = (match.index ?? 0) + 2
    targets.push([offset, offset + value.length])
    found.push({ offset, reference: { file, line: lineAt(text, offset), holder: 'link', value } })
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>()[\]]+/g)) {
    const offset = match.index ?? 0
    if (targets.some(([from, to]) => offset >= from && offset < to)) continue
    const value = match[0].replace(/[.,;:!?]+$/, '')
    found.push({ offset, reference: { file, line: lineAt(text, offset), holder: 'URL', value } })
  }
  return found.sort((a, b) => a.offset - b.offset).map(({ reference }) => reference)
}

function robotsReferences(file: string, text: string): Reference[] {
  return [...text.matchAll(/^[ \t]*sitemap[ \t]*:[ \t]*(\S+)/gim)].map((match) => ({
    file,
    line: lineAt(text, match.index ?? 0),
    holder: 'Sitemap:',
    value: match[1] ?? '',
  }))
}

/** The manifest members that hold URLs (W3C Web App Manifest): start_url, scope, the src of every
 * icon, screenshot and shortcut icon, and each shortcut's url. */
function manifestReferences(file: string, text: string): Reference[] {
  const found: Reference[] = []
  const holds = (path: readonly (string | number)[]): boolean => {
    const [top] = path
    const key = path[path.length - 1]
    return (
      (path.length === 1 && (key === 'start_url' || key === 'scope')) ||
      (key === 'src' && (top === 'icons' || top === 'screenshots' || top === 'shortcuts')) ||
      (key === 'url' && top === 'shortcuts' && path.length === 3)
    )
  }
  const named = (path: readonly (string | number)[]): string =>
    path
      .map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`))
      .join('')
      .slice(1)
  // Members are visited in the order the file writes them, so each key is found after the last.
  let cursor = 0
  const visit = (value: unknown, path: readonly (string | number)[]): void => {
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => visit(item, [...path, index]))
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, member] of Object.entries(value)) {
      const quoted = JSON.stringify(key)
      const at = text.indexOf(quoted, cursor)
      if (at >= 0) cursor = at + quoted.length
      const memberPath = [...path, key]
      if (typeof member === 'string' && holds(memberPath))
        found.push({ file, line: lineAt(text, cursor), holder: named(memberPath), value: member })
      visit(member, memberPath)
    }
  }
  const manifest: unknown = JSON.parse(text)
  visit(manifest, [])
  return found
}

function referencesOf({ file, format, text }: Shipped): Reference[] {
  switch (format) {
    case 'html':
      return htmlReferences(file, text)
    case 'css':
      return cssReferences(file, text)
    case 'markdown':
      return markdownReferences(file, text)
    case 'robots':
      return robotsReferences(file, text)
    case 'sitemap':
      return sitemapReferences(file, text)
    case 'manifest':
      return manifestReferences(file, text)
  }
}

/** The VITE_ variables of the tracked .env, which the build writes into index.html (`%NAME%`). */
function buildVariables(): ReadonlyMap<string, string> {
  return new Map(
    [...read('.env').matchAll(/^(VITE_[A-Z0-9_]+)=(.*)$/gm)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2'),
    ]),
  )
}

/** index.html as the build writes it: Vite replaces `%VITE_NAME%` there, and only there. */
const withBuildVariables = (html: string): string =>
  html.replace(
    /%(VITE_[A-Z0-9_]+)%/g,
    (placeholder, name: string) => buildVariables().get(name) ?? placeholder,
  )

/** The files the site ships as written: the shell, every page and stylesheet in public/, and the
 * text files crawlers and agents read. */
function shippedFiles(): Shipped[] {
  const listed = readdirSync(PUBLIC_DIR).sort()
  const inPublic = (extension: string, format: Format): Shipped[] =>
    listed
      .filter((name) => name.endsWith(extension))
      .map((name) => ({ file: `public/${name}`, format, text: read(`public/${name}`) }))
  return [
    { file: 'index.html', format: 'html', text: withBuildVariables(read('index.html')) },
    ...inPublic('.html', 'html'),
    ...inPublic('.css', 'css'),
    ...(
      [
        ['public/llms.txt', 'markdown'],
        ['public/robots.txt', 'robots'],
        ['public/sitemap.xml', 'sitemap'],
        ['public/site.webmanifest', 'manifest'],
      ] as const
    ).map(([file, format]) => ({ file, format, text: read(file) })),
  ]
}

/** Where the site serves a shipped file. */
const servedAt = (file: string): URL =>
  new URL(file === 'index.html' ? '/' : `/${file.slice('public/'.length)}`, SITE)

// --- the documents references land on ------------------------------------------------------------

/** The module index.html loads: a document that loads it is the app's own shell. */
function appEntry(): string {
  const entries = [...nodesOf(parseMarkup(read('index.html')))]
    .filter(isElement)
    .filter((element) => element.tagName === 'script' && attr(element, 'type') === 'module')
    .map((element) => attr(element, 'src'))
  const [entry] = entries
  if (entries.length !== 1 || entry === undefined)
    throw new Error(`index.html must load exactly one module script, found ${entries.length}`)
  return entry
}

interface SourceText {
  readonly file: string
  readonly text: string
}

/** An id the app's shell holds only once the app has rendered it, and opens when the address names
 * it. The guard test below reads both sources, so a rename there fails here. */
interface AppFragment {
  readonly id: string
  readonly renders: SourceText
  readonly opens: SourceText
}

const APP_FRAGMENTS: readonly AppFragment[] = [
  {
    id: 'privacy-preferences',
    renders: {
      file: 'modules/public-web/src/site/PrivacyBanner.tsx',
      text: 'id="privacy-preferences"',
    },
    opens: { file: 'modules/public-web/src/app/App.tsx', text: "'#privacy-preferences'" },
  },
]

/** The ids a fragment can name in `markup`: every id and every `<a name>`, and the app's own
 * fragments when the markup is the app's shell. */
function fragmentTargets(markup: string): ReadonlySet<string> {
  const entry = appEntry()
  const ids = new Set<string>()
  let shell = false
  for (const node of nodesOf(parseMarkup(markup))) {
    if (!isElement(node)) continue
    const id = attr(node, 'id')
    if (id) ids.add(id)
    const name = attr(node, 'name')
    if (node.tagName === 'a' && name) ids.add(name)
    if (node.tagName === 'script' && attr(node, 'type') === 'module' && attr(node, 'src') === entry)
      shell = true
  }
  if (shell) for (const fragment of APP_FRAGMENTS) ids.add(fragment.id)
  return ids
}

/** `text` with its percent-encoding decoded; null when that encoding is not UTF-8. */
function percentDecoded(text: string): string | null {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

/** Whether a fragment scrolls somewhere: an empty fragment and `top` need no element (HTML). */
function landsIn(targets: ReadonlySet<string>, fragment: string): boolean {
  if (fragment === '' || fragment.toLowerCase() === 'top' || targets.has(fragment)) return true
  const decoded = percentDecoded(fragment)
  return decoded !== null && targets.has(decoded)
}

// --- the Worker, as deployed ---------------------------------------------------------------------

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
}

/** The deployed files (wrangler.jsonc `assets.directory`): the built index.html and what the build
 * copies from public/. Hashed /assets/ output does not exist before a build, so it answers 404. */
function deployedBody(pathname: string): Uint8Array<ArrayBuffer> | null {
  if (pathname === '/index.html')
    return new TextEncoder().encode(withBuildVariables(read('index.html')))
  const decoded = percentDecoded(pathname)
  if (decoded === null) return null
  const path = normalize(join(PUBLIC_DIR, decoded))
  if (!path.startsWith(PUBLIC_DIR + sep) || !existsSync(path) || !statSync(path).isFile())
    return null
  return new Uint8Array(readFileSync(path))
}

const env = {
  ASSETS: {
    async fetch(input: Request | URL | string): Promise<Response> {
      const { pathname } = new URL(input instanceof Request ? input.url : input)
      const body = deployedBody(pathname)
      if (body === null) return new Response('Not found', { status: 404 })
      const type = CONTENT_TYPES[extname(pathname === '/index.html' ? 'index.html' : pathname)]
      return new Response(body, { headers: { 'Content-Type': type ?? 'application/octet-stream' } })
    },
  },
}
const publicContent = new PublicContent({} as never, env)
const context = {
  exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } },
}

/** The Worker's answer to a GET of a page or file, and the fragment targets of a markup answer. */
interface Answer {
  readonly status: number
  readonly location: string | null
  readonly contentType: string
  /** null when the answer is not markup. */
  readonly targets: ReadonlySet<string> | null
}

const answers = new Map<string, Promise<Answer>>()

/** The Worker's own fetch handler is the oracle; it passes the deployed file through where the
 * asset layer answers. No database: each page answers as when its publication cannot be read. */
function answerOf(url: URL): Promise<Answer> {
  const target = new URL(url.href)
  target.hash = ''
  const cached = answers.get(target.href)
  if (cached !== undefined) return cached
  const answer = (async (): Promise<Answer> => {
    const response = await worker.fetch(
      new Request(target.href, {
        headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      }),
      env,
      context,
    )
    const contentType = response.headers.get('Content-Type') ?? ''
    const body = await response.text()
    return {
      status: response.status,
      location: response.headers.get('Location'),
      contentType,
      targets: /^(?:text\/html|image\/svg\+xml)\b/i.test(contentType)
        ? fragmentTargets(body)
        : null,
    }
  })()
  answers.set(target.href, answer)
  return answer
}

// --- the check -----------------------------------------------------------------------------------

type Classified =
  | { readonly kind: 'site'; readonly url: URL }
  | { readonly kind: 'elsewhere' }
  | { readonly kind: 'refused'; readonly problem: Problem }

const refused = (problem: Problem): Classified => ({ kind: 'refused', problem })

/** One address and nothing else; no white space, no second address. */
function validMailto(value: string): boolean {
  const address = value.slice('mailto:'.length).split('?')[0] ?? ''
  const at = address.indexOf('@')
  const domain = address.slice(at + 1)
  return (
    at > 0 &&
    at === address.lastIndexOf('@') &&
    !/[\s,]/.test(address) &&
    domain.includes('.') &&
    !domain.startsWith('.') &&
    !domain.endsWith('.')
  )
}

/** Digits with an optional leading + and the visual separators of RFC 3966: - . ( ). */
const validTel = (value: string): boolean =>
  /^\+?[0-9().-]+$/.test(value.slice('tel:'.length)) && /[0-9]/.test(value)

/** What `written` names, resolved against the URL of the file that writes it. */
function classify(written: string, base: URL): Classified {
  const value = written.trim()
  if (value === '') return refused({ kind: 'empty' })
  const placeholder = /%VITE_[A-Z0-9_]+%/.exec(value)?.[0]
  if (placeholder !== undefined) return refused({ kind: 'placeholder', placeholder })
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase()
  if (scheme === 'mailto')
    return validMailto(value) ? { kind: 'elsewhere' } : refused({ kind: 'mailto' })
  if (scheme === 'tel') return validTel(value) ? { kind: 'elsewhere' } : refused({ kind: 'tel' })
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https')
    return refused({ kind: 'scheme', scheme })
  if (!URL.canParse(value, base)) return refused({ kind: 'unparseable' })
  const url = new URL(value, base)
  if (url.protocol !== 'https:') return refused({ kind: 'insecure' })
  return SITE_HOSTS.includes(url.hostname) ? { kind: 'site', url } : { kind: 'elsewhere' }
}

/** A path that exists in the repository but not in public/: an input the bundler replaces with its
 * hashed output (index.html loads /src/main.tsx). Only index.html, the bundler's entry, has any. */
function isBuildInput(url: URL): boolean {
  if (url.search !== '' || url.hash !== '' || deployedBody(url.pathname) !== null) return false
  const decoded = percentDecoded(url.pathname)
  if (decoded === null) return false
  const path = normalize(join(ROOT, decoded))
  return path.startsWith(ROOT) && existsSync(path) && statSync(path).isFile()
}

async function problemOf(
  reference: Reference,
  base: URL,
  own: ReadonlySet<string>,
): Promise<Problem | null> {
  const classified = classify(reference.value, base)
  if (classified.kind === 'refused') return classified.problem
  if (classified.kind === 'elsewhere') return null
  const { url } = classified
  const fragment = url.hash.slice(1)
  if (reference.value.trim().startsWith('#'))
    return landsIn(own, fragment) ? null : { kind: 'fragment', fragment, document: reference.file }
  if (url.pathname.startsWith('/assets/')) return { kind: 'build-output' }
  if (reference.file === 'index.html' && isBuildInput(url)) return null
  const answer = await answerOf(url)
  if (answer.status >= 300 && answer.status < 400)
    return { kind: 'redirect', status: answer.status, location: answer.location }
  if (answer.status < 200 || answer.status >= 300) return { kind: 'status', status: answer.status }
  if (fragment === '') return null
  if (answer.targets === null) return { kind: 'fragment-target', contentType: answer.contentType }
  return landsIn(answer.targets, fragment)
    ? null
    : { kind: 'fragment', fragment, document: `${url.pathname}${url.search}` }
}

async function findingsOf(shipped: Shipped): Promise<Finding[]> {
  const base = servedAt(shipped.file)
  const own = shipped.format === 'html' ? fragmentTargets(shipped.text) : new Set<string>()
  const findings: Finding[] = []
  for (const reference of referencesOf(shipped)) {
    const problem = await problemOf(reference, base, own)
    if (problem !== null) findings.push({ reference, problem })
  }
  return findings
}

function why(problem: Problem): string {
  switch (problem.kind) {
    case 'empty':
      return 'is empty'
    case 'placeholder':
      return `keeps the build placeholder ${problem.placeholder} (the build fills it in index.html only, from .env)`
    case 'unparseable':
      return 'is not a URL'
    case 'scheme':
      return `uses the ${problem.scheme}: scheme, which no shipped link may use`
    case 'insecure':
      return 'uses http:, not https:'
    case 'mailto':
      return 'is a mailto: link without exactly one valid address'
    case 'tel':
      return 'is a tel: link with characters other than digits, a leading + and - . ( )'
    case 'build-output':
      return 'names /assets/, which holds only hashed build output a static file cannot know'
    case 'status':
      return `answers ${problem.status} from the Worker`
    case 'redirect':
      return `answers ${problem.status} from the Worker, to ${problem.location ?? '(no Location)'}: link that URL`
    case 'fragment':
      return `names #${problem.fragment}, but ${problem.document} has no element with that id`
    case 'fragment-target':
      return `has a fragment, but the Worker answers ${problem.contentType || 'without a type'}, which has no ids`
  }
}

const describeFinding = ({ reference, problem }: Finding): string =>
  `${reference.file}:${reference.line} ${reference.holder} ${JSON.stringify(reference.value)} ${why(problem)}`

const located = (findings: readonly Finding[]): { line: number; problem: Problem }[] =>
  findings.map(({ reference, problem }) => ({ line: reference.line, problem }))

// --- tests ---------------------------------------------------------------------------------------

/** Every call the Worker makes past its own asset binding; none is expected. */
const upstream: string[] = []
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    upstream.push(input instanceof Request ? input.url : String(input))
    throw new Error('The link check must not reach the network')
  })
})
afterAll(() => {
  vi.restoreAllMocks()
})

describe('shipped links', () => {
  const shipped = shippedFiles()

  it('resolve: every reference reaches a file, a bundler input or a Worker route, and every fragment an id', async () => {
    const findings = (await Promise.all(shipped.map(findingsOf))).flat()
    expect(findings.map(describeFinding)).toEqual([])
    expect(upstream, 'requests past the Worker’s asset binding').toEqual([])
  })

  it('are read from every document that carries links', () => {
    const counts = new Map(shipped.map((file) => [file.file, referencesOf(file).length]))
    const documents = [
      'index.html',
      'public/404.html',
      'public/500.html',
      'public/maintenance.html',
      'public/contact.html',
      'public/privacy.html',
      'public/terms.html',
      'public/google-calendar.html',
      'public/tokens.css',
      'public/llms.txt',
      'public/robots.txt',
      'public/sitemap.xml',
      'public/site.webmanifest',
    ]
    expect(documents.filter((file) => !((counts.get(file) ?? 0) > 0))).toEqual([])
  })

  it('take the site origin from the .env the build reads', () => {
    expect(buildVariables().get('VITE_SITE_URL')).toBe(SITE)
  })

  it('may name an app fragment only while the app still renders it and opens it from the address', () => {
    for (const fragment of APP_FRAGMENTS)
      for (const { file, text } of [fragment.renders, fragment.opens])
        expect(read(file), `${file} must contain ${text} for #${fragment.id}`).toContain(text)
  })
})

describe('the link check', () => {
  it('asks the Worker, which answers as production does', async () => {
    const answer = async (path: string): Promise<[number, string | null]> => {
      const { status, location } = await answerOf(new URL(path, SITE))
      return [status, location]
    }
    expect(await answer('/booking')).toEqual([200, null])
    expect(await answer('/contact')).toEqual([200, null])
    expect(await answer('/og-image.png')).toEqual([200, null])
    expect(await answer('/no-such-page')).toEqual([404, null])
    expect(await answer('/privacy.html')).toEqual([308, `${SITE}/privacy`])
    expect(await answer('https://www.bladeblendstudio.se/')).toEqual([308, `${SITE}/`])
  })

  it('reports each kind of broken reference at its line', async () => {
    const text = [
      '<!doctype html><html><head><title>Fixture</title></head><body>',
      '<a href="/booking">resolves</a>',
      '<a href="/no-such-page">missing</a>',
      '<a href="/privacy.html">file name of a route</a>',
      '<a href="https://www.bladeblendstudio.se/">www host</a>',
      '<a href="http://bladeblendstudio.se/">http to the site</a>',
      '<a href="http://example.com/">http elsewhere</a>',
      '<a href="https://example.com/never-fetched">elsewhere</a>',
      '<p id="here"><a href="#here">own id</a><a href="#nowhere">missing own id</a></p>',
      '<a href="/privacy#nowhere">missing id in a route</a>',
      '<a href="/#privacy-preferences">app fragment</a><a href="/#nowhere">missing app fragment</a>',
      '<a href="/og-image.png#part">fragment on an image</a>',
      '<script type="module" src="/assets/app.js"></script>',
      '<script type="module" src="/src/main.tsx"></script>',
      '<a href="javascript:void(0)">script</a>',
      '<a href="mailto:nobody">no address</a><a href="mailto:a@mail.bladeblendstudio.se?subject=Hej">mail</a>',
      '<a href="tel:+46 79">space</a><a href="tel:0793043671">phone</a>',
      '<img alt="" src="">',
      '<img alt="" srcset="/og-image.png 1x, /missing.png 2x">',
      '<a href="%VITE_SITE_URL%/">placeholder outside index.html</a>',
      '<a href="https://bladeblendstudio.se/google-calendar#main">id in a route</a>',
      '</body></html>',
    ].join('\n')
    const findings = await findingsOf({ file: 'public/fixture.html', format: 'html', text })
    expect(located(findings)).toEqual([
      { line: 3, problem: { kind: 'status', status: 404 } },
      { line: 4, problem: { kind: 'redirect', status: 308, location: `${SITE}/privacy` } },
      { line: 5, problem: { kind: 'redirect', status: 308, location: `${SITE}/` } },
      { line: 6, problem: { kind: 'insecure' } },
      { line: 7, problem: { kind: 'insecure' } },
      {
        line: 9,
        problem: { kind: 'fragment', fragment: 'nowhere', document: 'public/fixture.html' },
      },
      { line: 10, problem: { kind: 'fragment', fragment: 'nowhere', document: '/privacy' } },
      { line: 11, problem: { kind: 'fragment', fragment: 'nowhere', document: '/' } },
      { line: 12, problem: { kind: 'fragment-target', contentType: 'image/png' } },
      { line: 13, problem: { kind: 'build-output' } },
      { line: 14, problem: { kind: 'status', status: 404 } },
      { line: 15, problem: { kind: 'scheme', scheme: 'javascript' } },
      { line: 16, problem: { kind: 'mailto' } },
      { line: 17, problem: { kind: 'tel' } },
      { line: 18, problem: { kind: 'empty' } },
      { line: 19, problem: { kind: 'status', status: 404 } },
      { line: 20, problem: { kind: 'placeholder', placeholder: '%VITE_SITE_URL%' } },
    ])
    expect(findings.map(describeFinding)[0]).toBe(
      'public/fixture.html:3 a[href] "/no-such-page" answers 404 from the Worker',
    )
  })

  it('accepts a bundler input only where the bundler reads it: index.html', async () => {
    const text = [
      '<!doctype html><html><head></head><body>',
      '<script type="module" src="/src/main.tsx"></script>',
      '<script type="module" src="/src/no-such-entry.tsx"></script>',
      '</body></html>',
    ].join('\n')
    expect(located(await findingsOf({ file: 'index.html', format: 'html', text }))).toEqual([
      { line: 3, problem: { kind: 'status', status: 404 } },
    ])
  })

  it('reads markup as a browser does: not comments, script or textarea text; noscript and template content, every quoting', () => {
    const text = [
      '<!doctype html><html><head>',
      '<!-- <a href="/commented-out">x</a> -->',
      `<script>document.write('<a href="/in-script">x</a>')</script>`,
      '<style>/* url(/in-css-comment.png) */ .x { background: url("/in-style.png") }</style>',
      '<meta property="og:image" content="/og.png"><meta name="description" content="/not-a-url">',
      '<noscript><link rel="stylesheet" href="/in-noscript.css"></noscript>',
      '</head><body>',
      `<a href='/single-quoted'>x</a>`,
      '<a href=/unquoted>x</a>',
      '<A HREF="/upper-case">x</A>',
      '<a href="/first" href="/second">x</a>',
      '<a href="/query?a=1&amp;b=2">x</a>',
      '<a',
      '  href="/next-line">x</a>',
      '<img alt="" srcset="/one.png 1x, /two.png 2x" src="/fallback.png">',
      '<template><a href="/in-template">x</a></template>',
      '<textarea><a href="/in-textarea">x</a></textarea>',
      '<svg><use href="/icons.svg#a"></use><use xlink:href="/icons.svg#b"></use></svg>',
      '</body></html>',
    ].join('\n')
    const read = referencesOf({ file: 'public/fixture.html', format: 'html', text }).map(
      ({ line, holder, value }) => [line, holder, value],
    )
    expect(read).toEqual([
      [4, 'url()', '/in-style.png'],
      [5, 'meta[og:image]', '/og.png'],
      [6, 'link[href]', '/in-noscript.css'],
      [8, 'a[href]', '/single-quoted'],
      [9, 'a[href]', '/unquoted'],
      [10, 'a[href]', '/upper-case'],
      [11, 'a[href]', '/first'],
      [12, 'a[href]', '/query?a=1&b=2'],
      [14, 'a[href]', '/next-line'],
      [15, 'img[srcset]', '/one.png'],
      [15, 'img[srcset]', '/two.png'],
      [15, 'img[src]', '/fallback.png'],
      [16, 'a[href]', '/in-template'],
      [18, 'use[href]', '/icons.svg#a'],
      [18, 'use[xlink:href]', '/icons.svg#b'],
    ])
  })

  it('splits srcset candidates on commas outside the URL', () => {
    expect(srcsetUrls(' /a.png 1x,/b,c.png 2x , /d.png')).toEqual(['/a.png', '/b,c.png', '/d.png'])
    expect(srcsetUrls('/e.png,/f.png')).toEqual(['/e.png,/f.png'])
  })

  it('reads the text formats at the line each URL is on', () => {
    const lines = (shipped: Shipped): [number, string, string][] =>
      referencesOf(shipped).map(({ line, holder, value }) => [line, holder, value])
    expect(
      lines({
        file: 'public/llms.txt',
        format: 'markdown',
        text: '# Site\n\n- [Boka](https://bladeblendstudio.se/booking): book\nSee https://example.com/a. or <https://example.com/b>\n[About](/about)',
      }),
    ).toEqual([
      [3, 'link', 'https://bladeblendstudio.se/booking'],
      [4, 'URL', 'https://example.com/a'],
      [4, 'URL', 'https://example.com/b'],
      [5, 'link', '/about'],
    ])
    expect(
      lines({
        file: 'public/robots.txt',
        format: 'robots',
        text: 'User-agent: *\nSitemap: https://bladeblendstudio.se/sitemap.xml\n  sitemap:/other.xml\n# Sitemap: /commented.xml',
      }),
    ).toEqual([
      [2, 'Sitemap:', 'https://bladeblendstudio.se/sitemap.xml'],
      [3, 'Sitemap:', '/other.xml'],
    ])
    expect(
      lines({
        file: 'public/sitemap.xml',
        format: 'sitemap',
        text: '<?xml version="1.0"?>\n<urlset>\n<url><loc>\n  https://bladeblendstudio.se/\n</loc>\n<xhtml:link rel="alternate" href="https://bladeblendstudio.se/?lang=en"/></url>\n</urlset>',
      }),
    ).toEqual([
      [4, '<loc>', 'https://bladeblendstudio.se/'],
      [6, 'xhtml:link[href]', 'https://bladeblendstudio.se/?lang=en'],
    ])
    expect(
      lines({
        file: 'public/site.webmanifest',
        format: 'manifest',
        text: '{\n  "name": "/not-a-url",\n  "start_url": "/",\n  "icons": [\n    { "src": "/a.png" },\n    { "src": "/b.png" }\n  ],\n  "scope": "/"\n}',
      }),
    ).toEqual([
      [3, 'start_url', '/'],
      [5, 'icons[0].src', '/a.png'],
      [6, 'icons[1].src', '/b.png'],
      [8, 'scope', '/'],
    ])
    expect(
      lines({
        file: 'public/fixture.css',
        format: 'css',
        text: '@import "/x.css";\n/* url(/commented.png) */\n.b { background: url(/y.png) }',
      }),
    ).toEqual([
      [1, '@import', '/x.css'],
      [3, 'url()', '/y.png'],
    ])
  })
})
