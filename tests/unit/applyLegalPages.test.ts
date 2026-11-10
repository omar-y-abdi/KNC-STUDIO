import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CMS_HTML_LIMIT,
  CmsValidationError,
  emptyDocument,
  validateDocument,
  type CmsDocument,
  type CmsPage,
} from '../../packages/content-contracts/src/cms'
import { validateDocumentMarkupPlacements } from '../../packages/content-contracts/src/cms-markup'
import {
  applyLegalPages,
  contractProblem,
  LEGAL_PAGES,
  shippedPage,
} from '../../tools/cms/apply-legal-pages.mjs'

type LegalPath = (typeof LEGAL_PAGES)[number]['path']

// A Studio export (downloadDraft in Studio.tsx) of the tools/e2e/fixtures publication: its /privacy
// and /terms still hold the first import, one bilingual body and the old sheet in every field.
const exported: CmsDocument = {
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
    ).toString(),
  ).presentation,
}
const EXPORT = JSON.stringify(exported, null, 2)
const draft = (): CmsDocument => JSON.parse(EXPORT)

const FILES: Readonly<Record<LegalPath, string>> = {
  '/privacy': readFileSync('public/privacy.html', 'utf8'),
  '/terms': readFileSync('public/terms.html', 'utf8'),
}
const CONTRACT = { CmsValidationError, validateDocument, validateDocumentMarkupPlacements }
const LANGS = ['sv', 'en'] as const

const ONE_SENTENCE = /^[^\n]+\.$/

function refusal(
  outcome: { readonly ok: true } | { readonly ok: false; readonly problem: string },
): string {
  if (outcome.ok) throw new Error('Expected a refusal')
  expect(outcome.problem).toMatch(ONE_SENTENCE)
  return outcome.problem
}

function apply(input: unknown = draft()) {
  const outcome = applyLegalPages(input, FILES)
  if (!outcome.ok) throw new Error(outcome.problem)
  return outcome.value
}

function applied(input: unknown = draft()): CmsDocument {
  const document: unknown = apply(input).document
  validateDocument(document)
  return document
}

function legal(document: CmsDocument, path: LegalPath): CmsPage {
  const page = document.presentation.pages.find((item) => item.path === path)
  if (!page) throw new Error(`The draft has no ${path}`)
  return page
}

function shipped(path: LegalPath) {
  const page = LEGAL_PAGES.find((item) => item.path === path)
  const outcome = page === undefined ? undefined : shippedPage(page.file, FILES[path])
  if (!outcome?.ok) throw new Error(`The shipped file of ${path} was refused`)
  return outcome.value
}

const visible = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('a shipped legal file as a stored page takes it', () => {
  it.each(LEGAL_PAGES)('reads the body and the style of $file', ({ path }) => {
    const text = FILES[path]
    const { html, css, updated } = shipped(path)
    expect(html.trim().startsWith('<main class="bb-doc">')).toBe(true)
    expect(html.trim().endsWith('</main>')).toBe(true)
    expect(html.match(/<main\b/g)).toHaveLength(1)
    expect(html).not.toMatch(/<(?:script|style|link|meta|body|html|head)\b/)
    const body = /<body>([\s\S]*)<\/body>/.exec(text)?.[1] ?? ''
    expect(visible(body)).not.toBe('')
    expect(visible(html) === visible(body)).toBe(true)
    expect(css).toBe(/<style>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? '')
    expect(css === '').toBe(!text.includes('<style'))
    expect(updated).toHaveLength(2)
    expect(updated[0]).toMatch(/^(?:Senast uppdaterad|Uppdaterad) \d{1,2} [a-zåäö]+ \d{4}$/)
    expect(updated[1]).toMatch(/^(?:Last updated|Updated) \d{1,2} [A-Z][a-z]+ \d{4}$/)
    for (const date of updated) expect(visible(body)).toContain(date)
  })

  it('finds body, style and date by the structure of the file, wherever its lines fall', () => {
    const file =
      '<!doctype html><html><head><link rel="stylesheet" href="/tokens.css"><style>a{}</style>' +
      '<style>b{}</style></head><body><main>Uppdaterad\n 1 maj 2026</main></body></html>'
    expect(shippedPage('public/one-line.html', file)).toEqual({
      ok: true,
      value: {
        html: '<main>Uppdaterad\n 1 maj 2026</main>',
        css: 'a{}\nb{}',
        updated: ['Uppdaterad 1 maj 2026'],
      },
    })
  })

  it.each([
    [
      'a body with an element beside its main',
      '<body><main>Uppdaterad 1 maj 2026</main><div></div></body>',
      'does not have a <main> element as the only element of its <body>',
    ],
    [
      'a body without a main',
      'Uppdaterad 1 maj 2026',
      'does not have a <main> element as the only element of its <body>',
    ],
    [
      'a stylesheet the Worker does not add to a CMS page',
      '<head><link rel="stylesheet" href="/extra.css"></head><body><main>Uppdaterad 1 maj 2026</main></body>',
      'links the stylesheet "/extra.css"',
    ],
    ['no date of its last update', '<body><main>Text</main></body>', 'states no date'],
  ])('refuses a file with %s', (_case, text, problem) => {
    const sentence = refusal(shippedPage('public/other.html', text))
    expect(sentence.startsWith('public/other.html ')).toBe(true)
    expect(sentence).toContain(problem)
  })
})

describe('the shipped legal pages applied to an exported draft', () => {
  it('puts the shipped body and style into all six fields of both pages', () => {
    const document = applied()
    for (const { path } of LEGAL_PAGES) {
      const { html, css } = shipped(path)
      for (const lang of LANGS) {
        // The export held another text: the replacement is what put this one there.
        expect(legal(draft(), path).content[lang].html).not.toBe(html)
        expect(legal(draft(), path).content[lang].css.light).not.toBe(css)
        expect(legal(document, path).content[lang]).toEqual({
          html,
          css: { light: css, dark: css },
        })
      }
    }
  })

  it('names the pages it replaced, their files and the dates the files state', () => {
    expect(apply().replaced).toEqual([
      {
        path: '/privacy',
        file: 'public/privacy.html',
        updated: [
          expect.stringMatching(/^Senast uppdaterad /),
          expect.stringMatching(/^Last updated /),
        ],
      },
      {
        path: '/terms',
        file: 'public/terms.html',
        updated: [expect.stringMatching(/^Uppdaterad /), expect.stringMatching(/^Updated /)],
      },
    ])
  })

  // The Worker fills these on every request, and the import refuses a language field without the
  // ones of its language, so each field holds them all.
  it.each([
    [
      '/privacy',
      [
        'id="legal-business-details-sv"',
        'id="legal-business-details-en"',
        'data-business-name=""',
        'data-business-controller="sv"',
        'data-business-controller="en"',
        'data-business-contact=""',
      ],
    ],
    [
      '/terms',
      [
        'id="legal-business-details-sv"',
        'id="legal-business-details-en"',
        'id="cancellation-policy-sv"',
        'id="cancellation-policy-en"',
        'data-business-name=""',
        'data-business-contact=""',
      ],
    ],
  ] as const)('keeps every business slot of %s in both language fields', (path, slots) => {
    const { content } = legal(applied(), path)
    for (const lang of LANGS)
      for (const slot of slots) expect(content[lang].html, `${lang} ${slot}`).toContain(slot)
  })

  it('gives a draft the contract of the import accepts', () => {
    expect(contractProblem(applied(), CONTRACT)).toBeNull()
  })

  it('writes back everything else as it was read', () => {
    const output = JSON.stringify(apply().document, null, 2)
    expect(output === EXPORT).toBe(false)
    const restored: CmsDocument = JSON.parse(output)
    expect(Object.keys(restored)).toEqual(Object.keys(exported))
    expect(restored.presentation.pages.map((page) => Object.keys(page))).toEqual(
      exported.presentation.pages.map((page) => Object.keys(page)),
    )
    // With the replaced html and css put back, the output is the export byte for byte.
    for (const { path } of LEGAL_PAGES)
      for (const lang of LANGS) {
        const stored = legal(exported, path).content[lang]
        const variant = legal(restored, path).content[lang]
        variant.html = stored.html
        variant.css.light = stored.css.light
        variant.css.dark = stored.css.dark
      }
    expect(JSON.stringify(restored, null, 2) === EXPORT).toBe(true)
  })

  it('does not change the draft it is given', () => {
    const input = draft()
    apply(input)
    expect(JSON.stringify(input, null, 2) === EXPORT).toBe(true)
  })

  it('gives the same draft when it is applied to its own result', () => {
    const once = apply()
    const text = JSON.stringify(once.document, null, 2)
    const twice = apply(JSON.parse(text))
    expect(JSON.stringify(twice.document, null, 2) === text).toBe(true)
    expect(twice.replaced).toEqual(once.replaced)
  })

  const pagesOf =
    (change: (pages: readonly CmsPage[]) => readonly unknown[]) =>
    (document: CmsDocument): unknown => ({
      ...document,
      presentation: { ...document.presentation, pages: change(document.presentation.pages) },
    })
  const pageAt = (path: LegalPath, change: (page: CmsPage) => unknown) =>
    pagesOf((pages) => pages.map((item) => (item.path === path ? change(item) : item)))

  it.each<[string, (document: CmsDocument) => unknown, string]>([
    ['a draft that is no object', () => null, 'has no presentation.pages list'],
    ['a draft that is a list', () => [], 'has no presentation.pages list'],
    [
      'a draft without a presentation',
      (document) => ({ ...document, presentation: undefined }),
      'has no presentation.pages list',
    ],
    [
      'pages that are not a list',
      (document) => ({ ...document, presentation: { ...document.presentation, pages: {} } }),
      'has no presentation.pages list',
    ],
    [
      'a draft without /privacy',
      pagesOf((pages) => pages.filter((item) => item.path !== '/privacy')),
      'has no page with the path /privacy',
    ],
    [
      'a draft without /terms',
      pagesOf((pages) => pages.filter((item) => item.path !== '/terms')),
      'has no page with the path /terms',
    ],
    [
      'two pages at /terms',
      pagesOf((pages) => [...pages, ...pages.filter((item) => item.path === '/terms')]),
      'has more than one page with the path /terms',
    ],
    [
      'a /privacy that is an ordinary page',
      pageAt('/privacy', (item) => ({ ...item, kind: 'page' })),
      'page /privacy is not of the kind "privacy"',
    ],
    [
      'a page without content',
      pageAt('/terms', (item) => ({ ...item, content: undefined })),
      'page /terms has no text at content.sv.html',
    ],
    [
      'a page without its English variant',
      pageAt('/privacy', (item) => ({ ...item, content: { sv: item.content.sv } })),
      'page /privacy has no text at content.en.html',
    ],
    [
      'a body that is not text',
      pageAt('/privacy', (item) => ({
        ...item,
        content: { ...item.content, sv: { ...item.content.sv, html: 5 } },
      })),
      'page /privacy has no text at content.sv.html',
    ],
    [
      'a variant whose css is not its two sheets',
      pageAt('/terms', (item) => ({
        ...item,
        content: { ...item.content, en: { ...item.content.en, css: 'main{}' } },
      })),
      'page /terms has no text at content.en.css.light',
    ],
    [
      'a variant without its dark sheet',
      pageAt('/terms', (item) => ({
        ...item,
        content: { ...item.content, sv: { ...item.content.sv, css: { light: '' } } },
      })),
      'page /terms has no text at content.sv.css.dark',
    ],
  ])('refuses %s', (_case, change, problem) => {
    expect(refusal(applyLegalPages(change(draft()), FILES))).toContain(problem)
  })

  it('refuses a shipped file it cannot take, by the name of the file', () => {
    const files = { ...FILES, '/terms': '<body><main>Text</main></body>' }
    expect(refusal(applyLegalPages(draft(), files))).toContain('public/terms.html states no date')
  })
})

describe('the contract of the import, asked before anything is written', () => {
  it('answers with the sentence of the refusal for a page without a slot of its language', () => {
    const document = applied()
    const swedish = legal(document, '/terms').content.sv
    swedish.html = swedish.html.replace('id="cancellation-policy-sv"', 'id="other"')
    expect(contractProblem(document, CONTRACT)).toBe(
      'presentation./terms.sv: Legal page is missing required server-owned slot(s): #cancellation-policy-sv',
    )
  })

  it('answers with the size limit for a body over it', () => {
    const document = applied()
    legal(document, '/privacy').content.en.html += 'x'.repeat(CMS_HTML_LIMIT)
    expect(contractProblem(document, CONTRACT)).toBe(
      `/privacy.en.html: Ange högst ${CMS_HTML_LIMIT} tecken.`,
    )
  })

  it('answers for the rest of the draft too', () => {
    expect(contractProblem({ ...applied(), schema: 2 }, CONTRACT)).toBe(
      'document.schema: Unsupported schema version',
    )
  })

  it('lets an error that is no answer of the contract through', () => {
    function broken(value: unknown): asserts value is CmsDocument {
      throw new TypeError(`Not an answer about ${typeof value}`)
    }
    expect(() => contractProblem(applied(), { ...CONTRACT, validateDocument: broken })).toThrow(
      TypeError,
    )
  })
})

describe('node tools/cms/apply-legal-pages.mjs', () => {
  const created: string[] = []

  function directory(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'apply-legal-pages-'))
    created.push(dir)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    return dir
  }

  function tool(args: readonly string[]) {
    const run = spawnSync(process.execPath, ['tools/cms/apply-legal-pages.mjs', ...args], {
      encoding: 'utf8',
    })
    // Node may add warnings of its own to stderr; the tool's lines carry its name.
    const said = run.stderr.split('\n').filter((line) => line.startsWith('apply-legal-pages: '))
    return { code: run.status, out: run.stdout, said }
  }

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('writes the applied draft to the output path and says what went in', () => {
    const dir = directory({ 'in.json': EXPORT })
    const output = join(dir, 'out.json')
    const result = tool([join(dir, 'in.json'), output])
    expect(result.said).toEqual([])
    expect(result.code).toBe(0)
    const { document, replaced } = apply()
    expect(readFileSync(output, 'utf8') === JSON.stringify(document, null, 2)).toBe(true)
    expect(readFileSync(join(dir, 'in.json'), 'utf8') === EXPORT).toBe(true)
    expect(readdirSync(dir).sort()).toEqual(['in.json', 'out.json'])
    const lines = result.out.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(
      /^Replaced \/privacy with the body and style of public\/privacy\.html: /,
    )
    expect(lines[1]).toMatch(/^Replaced \/terms with the body and style of public\/terms\.html: /)
    expect(lines[2]).toBe(`Wrote ${output}.`)
    for (const [index, { updated }] of replaced.entries())
      for (const date of updated) expect(lines[index]).toContain(date)
  })

  const input = (dir: string): string => join(dir, 'in.json')
  const output = (dir: string): string => join(dir, 'out.json')
  const withoutTerms = JSON.stringify(
    {
      ...exported,
      presentation: {
        ...exported.presentation,
        pages: exported.presentation.pages.filter((item) => item.path !== '/terms'),
      },
    },
    null,
    2,
  )

  it.each<[string, Readonly<Record<string, string>>, (dir: string) => readonly string[], string]>([
    ['no argument', {}, () => [], 'Expected two arguments'],
    ['one argument', { 'in.json': EXPORT }, (dir) => [input(dir)], 'Expected two arguments'],
    [
      'three arguments',
      { 'in.json': EXPORT },
      (dir) => [input(dir), output(dir), join(dir, 'more.json')],
      'Expected two arguments',
    ],
    [
      'an output path that is the input',
      { 'in.json': EXPORT },
      (dir) => [input(dir), input(dir)],
      'is the input file, which is never overwritten',
    ],
    [
      'an output path that is the input under another spelling',
      { 'in.json': EXPORT },
      (dir) => [input(dir), `${dir}/other/../in.json`],
      'is the input file, which is never overwritten',
    ],
    [
      'an output file that exists',
      { 'in.json': EXPORT, 'out.json': 'kept' },
      (dir) => [input(dir), output(dir)],
      'already exists and is not overwritten',
    ],
    ['an input that does not exist', {}, (dir) => [input(dir), output(dir)], 'Cannot read'],
    [
      'an input that is not JSON',
      { 'in.json': '{ "presentation": ' },
      (dir) => [input(dir), output(dir)],
      'is not JSON',
    ],
    [
      'a draft without one of the two pages',
      { 'in.json': withoutTerms },
      (dir) => [input(dir), output(dir)],
      'The draft has no page with the path /terms',
    ],
    [
      'a draft the import would refuse',
      { 'in.json': JSON.stringify({ ...exported, schema: 2 }, null, 2) },
      (dir) => [input(dir), output(dir)],
      'The CMS would refuse the result on import (document.schema: Unsupported schema version)',
    ],
  ])('refuses %s with one sentence and writes nothing', (_case, files, args, problem) => {
    const dir = directory(files)
    const result = tool(args(dir))
    expect(result.said).toHaveLength(1)
    expect(result.said[0]).toMatch(ONE_SENTENCE)
    expect(result.said[0]).toContain(problem)
    expect(result.code).toBe(1)
    expect(result.out).toBe('')
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort())
    for (const [name, text] of Object.entries(files))
      expect(readFileSync(join(dir, name), 'utf8') === text).toBe(true)
  })
})
