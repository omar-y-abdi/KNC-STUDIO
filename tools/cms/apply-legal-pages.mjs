// Puts the shipped legal texts into an exported Studio draft. The Worker serves a published CMS
// page for /privacy and /terms before the static file, and Studio keeps a stored legal page as it
// is, so the way in is the draft: Utkast & backup, Export; this tool; Import; Publicera.
//
// Usage: node tools/cms/apply-legal-pages.mjs <exported knc-cms-draft.json> <output.json>
// Needs Node 22.18 or later, which loads the TypeScript CMS contract the result is checked against.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, serialize } from 'parse5'

const root = new URL('../../', import.meta.url)

export const LEGAL_PAGES = /** @type {const} */ ([
  { path: '/privacy', kind: 'privacy', file: 'public/privacy.html' },
  { path: '/terms', kind: 'terms', file: 'public/terms.html' },
])

/** @typedef {(typeof LEGAL_PAGES)[number]} LegalPage */

/**
 * A value, or the one sentence that says why there is none.
 * @template T
 * @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly problem: string }} Outcome
 */

/**
 * What a stored legal page takes from its shipped file.
 * @typedef {object} ShippedPage
 * @property {string} html the inside of the file's <body>
 * @property {string} css the text of the file's <style> elements
 * @property {readonly string[]} updated each date of last update the body states, with its label
 */

/**
 * @typedef {object} Applied
 * @property {Record<string, unknown>} document the draft with the two pages replaced
 * @property {readonly { readonly path: LegalPage['path'], readonly file: string, readonly updated: readonly string[] }[]} replaced
 */

/**
 * What the CMS applies to a draft on import, from packages/content-contracts.
 * @typedef {Pick<typeof import('../../packages/content-contracts/src/cms.ts'), 'CmsValidationError' | 'validateDocument'> &
 *   Pick<typeof import('../../packages/content-contracts/src/cms-markup.ts'), 'validateDocumentMarkupPlacements'>} Contract
 */

/** @typedef {import('parse5').DefaultTreeAdapterMap} Tree */

/** @type {(problem: string) => { readonly ok: false, readonly problem: string }} */
const refuse = (problem) => ({ ok: false, problem })

/** @type {(value: unknown) => value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** @type {(node: Tree['childNode']) => node is Tree['element']} */
const isElement = (node) => 'tagName' in node

/** @type {(node: Tree['parentNode']) => Tree['element'][]} */
const elements = (node) => node.childNodes.filter(isElement)

/**
 * Every element with this tag name below a node, in document order.
 * @param {Tree['parentNode']} node
 * @param {string} tag
 * @returns {Tree['element'][]}
 */
function descendants(node, tag) {
  return elements(node).flatMap((child) => [
    ...(child.tagName === tag ? [child] : []),
    ...descendants(child, tag),
  ])
}

/** @type {(element: Tree['element'], name: string) => string | undefined} */
const attribute = (element, name) => element.attrs.find((item) => item.name === name)?.value

/** The sheets the Worker inlines in front of a stored information page's own CSS. */
const BASE_SHEETS = ['/tokens.css', '/info.css']

/** A date of last update as both pages state it, in Swedish and in English. */
const UPDATED =
  /(Senast uppdaterad|Uppdaterad|Last updated|Updated)\s+(\d{1,2})\s+([A-Za-zåäöÅÄÖ]+)\s+(\d{4})/g

/**
 * Refuses a stylesheet the Worker does not inline for a CMS page, and a file without a date, which
 * would hide from the owner which text went in.
 * @param {string} file the file's name, for the sentence of a refusal
 * @param {string} text
 * @returns {Outcome<ShippedPage>}
 */
export function shippedPage(file, text) {
  const document = parse(text)
  const [body] = descendants(document, 'body')
  const content = body === undefined ? [] : elements(body)
  if (body === undefined || content.length !== 1 || content[0]?.tagName !== 'main')
    return refuse(`${file} does not have a <main> element as the only element of its <body>.`)
  const [foreign] = descendants(document, 'link')
    .filter((link) => attribute(link, 'rel') === 'stylesheet')
    .map((link) => attribute(link, 'href') ?? '')
    .filter((href) => !BASE_SHEETS.includes(href))
  if (foreign !== undefined)
    return refuse(
      `${file} links the stylesheet "${foreign}", which the Worker does not add to a CMS page.`,
    )
  const html = serialize(body)
  const updated = [...html.matchAll(UPDATED)].map((match) => match.slice(1).join(' '))
  if (updated.length === 0) return refuse(`${file} states no date of its last update.`)
  const css = descendants(document, 'style')
    .map((style) => style.childNodes.map((child) => ('value' in child ? child.value : '')).join(''))
    .join('\n')
  return { ok: true, value: { html, css, updated } }
}

const LANGS = /** @type {const} */ (['sv', 'en'])
const MODES = /** @type {const} */ (['light', 'dark'])

/**
 * Both languages get the whole bilingual document, as Studio seeds a missing page
 * (modules/studio/src/nativePages.ts).
 * @param {Record<string, unknown>} page
 * @param {LegalPage} legal
 * @param {ShippedPage} shipped
 * @returns {Outcome<Record<string, unknown>>}
 */
function pageWith(page, legal, shipped) {
  const where = `The draft's page ${legal.path}`
  if (page['kind'] !== legal.kind) return refuse(`${where} is not of the kind "${legal.kind}".`)
  const stored = isRecord(page['content']) ? page['content'] : {}
  /** @type {Record<string, unknown>} */
  const content = { ...stored }
  for (const lang of LANGS) {
    const variant = stored[lang]
    if (!isRecord(variant) || typeof variant['html'] !== 'string')
      return refuse(`${where} has no text at content.${lang}.html.`)
    const css = isRecord(variant['css']) ? variant['css'] : {}
    const absent = MODES.find((mode) => typeof css[mode] !== 'string')
    if (absent !== undefined)
      return refuse(`${where} has no text at content.${lang}.css.${absent}.`)
    content[lang] = {
      ...variant,
      html: shipped.html,
      css: { ...css, light: shipped.css, dark: shipped.css },
    }
  }
  return { ok: true, value: { ...page, content } }
}

/**
 * Pure; the draft given is not changed.
 * @param {unknown} draft the parsed export
 * @param {Readonly<Record<LegalPage['path'], string>>} files the text of each page's shipped file
 * @returns {Outcome<Applied>}
 */
export function applyLegalPages(draft, files) {
  const presentation = isRecord(draft) ? draft['presentation'] : undefined
  const stored = isRecord(presentation) ? presentation['pages'] : undefined
  if (!isRecord(draft) || !isRecord(presentation) || !Array.isArray(stored))
    return refuse('The draft has no presentation.pages list, so it is not a Studio export.')
  /** @type {readonly unknown[]} */
  let pages = stored
  /** @type {Applied['replaced'][number][]} */
  const replaced = []
  for (const legal of LEGAL_PAGES) {
    const shipped = shippedPage(legal.file, files[legal.path])
    if (!shipped.ok) return shipped
    const found = pages.flatMap((page, index) =>
      isRecord(page) && page['path'] === legal.path ? [{ page, index }] : [],
    )
    const [only] = found
    if (only === undefined || found.length > 1)
      return refuse(
        `The draft has ${only === undefined ? 'no' : 'more than one'} page with the path ${legal.path}.`,
      )
    const page = pageWith(only.page, legal, shipped.value)
    if (!page.ok) return page
    pages = pages.with(only.index, page.value)
    replaced.push({ path: legal.path, file: legal.file, updated: shipped.value.updated })
  }
  return {
    ok: true,
    value: { document: { ...draft, presentation: { ...presentation, pages } }, replaced },
  }
}

// The site origin is cms-studio's fallback; neither page links a library file, so the storage
// origin is a host that cannot exist.
const POLICY = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://storage.invalid',
}

/**
 * The sentence the CMS would refuse this draft with on import, or null. Markup is checked on the
 * two legal pages only: the others' library links need a storage origin this tool does not know.
 * The markup check rewrites the pages it is given, so pass a copy, not the text written out.
 * @param {unknown} document
 * @param {Contract} contract
 * @returns {string | null}
 */
export function contractProblem(document, contract) {
  try {
    contract.validateDocument(document)
    const pages = document.presentation.pages.filter((page) =>
      LEGAL_PAGES.some((legal) => legal.path === page.path),
    )
    contract.validateDocumentMarkupPlacements(
      { ...document, presentation: { ...document.presentation, pages, regions: {} } },
      POLICY,
    )
    return null
  } catch (error) {
    if (error instanceof contract.CmsValidationError) return error.message
    throw error
  }
}

/**
 * @param {string | URL} path
 * @param {string} name the file as a refusal names it
 * @returns {Outcome<string>}
 */
function readText(path, name) {
  try {
    return { ok: true, value: readFileSync(path, 'utf8') }
  } catch {
    return refuse(`Cannot read ${name}.`)
  }
}

/** @returns {Promise<Outcome<Contract>>} */
async function loadContract() {
  try {
    const [{ CmsValidationError, validateDocument }, { validateDocumentMarkupPlacements }] =
      await Promise.all([
        import('../../packages/content-contracts/src/cms.ts'),
        import('../../packages/content-contracts/src/cms-markup.ts'),
      ])
    return {
      ok: true,
      value: { CmsValidationError, validateDocument, validateDocumentMarkupPlacements },
    }
  } catch (error) {
    return refuse(
      `Cannot load the CMS contract from packages/content-contracts with Node ${process.versions.node}, which loads TypeScript from version 22.18 (${error instanceof Error ? error.message : String(error)}).`,
    )
  }
}

/**
 * Every effect of the tool is here.
 * @param {readonly string[]} args the command line after the script
 * @returns {Promise<Outcome<readonly string[]>>} the lines to print
 */
async function run(args) {
  const [input, output] = args
  if (input === undefined || output === undefined || args.length !== 2)
    return refuse(
      'Expected two arguments: node tools/cms/apply-legal-pages.mjs <exported knc-cms-draft.json> <output.json>.',
    )
  if (resolve(input) === resolve(output))
    return refuse(`The output path ${output} is the input file, which is never overwritten.`)
  const exported = readText(input, input)
  if (!exported.ok) return exported
  /** @type {unknown} */
  let draft
  try {
    draft = JSON.parse(exported.value)
  } catch {
    return refuse(`${input} is not JSON.`)
  }
  const [privacyPage, termsPage] = LEGAL_PAGES
  const privacy = readText(new URL(privacyPage.file, root), privacyPage.file)
  if (!privacy.ok) return privacy
  const terms = readText(new URL(termsPage.file, root), termsPage.file)
  if (!terms.ok) return terms
  const applied = applyLegalPages(draft, { '/privacy': privacy.value, '/terms': terms.value })
  if (!applied.ok) return applied
  // Studio's export is JSON with two spaces and no final line break (downloadDraft in Studio.tsx).
  const text = JSON.stringify(applied.value.document, null, 2)
  const contract = await loadContract()
  if (!contract.ok) return contract
  const problem = contractProblem(JSON.parse(text), contract.value)
  if (problem !== null) return refuse(`The CMS would refuse the result on import (${problem}).`)
  try {
    // 'wx' refuses any existing path, a link to the input included.
    writeFileSync(output, text, { flag: 'wx' })
  } catch (error) {
    return refuse(
      error instanceof Error && 'code' in error && error.code === 'EEXIST'
        ? `${output} already exists and is not overwritten.`
        : `Cannot write ${output}.`,
    )
  }
  return {
    ok: true,
    value: [
      ...applied.value.replaced.map(
        ({ path, file, updated }) =>
          `Replaced ${path} with the body and style of ${file}: ${updated.join(', ')}.`,
      ),
      `Wrote ${output}.`,
    ],
  }
}

// Node resolves symlinks in the entry module's URL, so the started path is resolved too: a mismatch
// would do nothing and still exit 0.
function startedModuleUrl() {
  try {
    return pathToFileURL(realpathSync(process.argv[1] ?? '')).href
  } catch {
    return null
  }
}

if (import.meta.url === startedModuleUrl()) {
  const outcome = await run(process.argv.slice(2))
  if (outcome.ok) for (const line of outcome.value) console.log(line)
  else {
    console.error(`apply-legal-pages: ${outcome.problem}`)
    process.exitCode = 1
  }
}
