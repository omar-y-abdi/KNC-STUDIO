import { readFileSync } from 'node:fs'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptyDocument,
  validateCompleteDocument,
  validateDocumentMedia,
  type CmsPage,
  type CmsPresentation,
} from '../../shared/cms'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup'
import { createSitePage } from '../../shared/site-page'
import worker, { PublicContent } from '../../src/worker'

// G01 and G02 (PR #104 final gate): the Worker assembles the served HTML from the trusted index.html
// shell and owner bytes. Owner bytes must land where the shell says, as bytes: a dollar sign in a
// stylesheet is not a replacement pattern, and an id written in a stylesheet or a title is not the
// shell's #root. Each page below is what Edge stores after its own publication validators.

const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>', '')
  .replace(
    '</head>',
    '<script type="module" crossorigin src="/assets/entry.js"></script><link rel="modulepreload" crossorigin href="/assets/chunk.js"><link rel="stylesheet" crossorigin href="/assets/entry.css"></head>',
  )
const publicFile = (path: string): string =>
  readFileSync(new URL(`../../public${path}`, import.meta.url), 'utf8')
const env = {
  SUPABASE_URL: 'https://fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon-key',
  ASSETS: {
    fetch: async (input: Request | URL | string): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/index.html')
        return new Response(shell, { headers: { 'Content-Type': 'text/html' } })
      if (path === '/info.css' || path === '/tokens.css')
        return new Response(publicFile(path), { headers: { 'Content-Type': 'text/css' } })
      return new Response('Not found', { status: 404 })
    },
  },
}
const noPublicContent = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}
const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.invalid',
  builtAssets: CMS_BUILT_ASSETS,
}

const contactSource = publicFile('/contact.html')
const contactBodies = {
  sv: contactSource.slice(
    contactSource.indexOf('<body>') + '<body>'.length,
    contactSource.indexOf('</body>'),
  ),
  en: readFileSync(new URL('../../src/admin/cms/contact.en.html', import.meta.url), 'utf8').trim(),
}

/** The shipped Contact templates, as Studio adopts them, with `css` in both schemes. */
function contactPage(css: string, title = ''): CmsPage {
  return {
    id: '10000000-0000-4000-8000-000000000007',
    kind: 'page',
    path: '/contact',
    name: { sv: 'Kontakt', en: 'Contact' },
    title: { sv: title, en: title },
    description: { sv: '', en: '' },
    inMenu: false,
    content: {
      sv: { html: contactBodies.sv, css: { light: css, dark: css } },
      en: { html: contactBodies.en, css: { light: css, dark: css } },
    },
  }
}

/** A page as Studio's "Skapa ny sida" creates it, with `css` appended to its own rules. */
function createdPage(css: string, title?: string): CmsPage {
  const page = createSitePage({
    id: '20000000-0000-4000-8000-0000000000c1',
    path: '/hemsida',
    name: { sv: 'Ny sida', en: 'New page' },
  })
  for (const lang of ['sv', 'en'] as const) {
    const variant = page.content[lang]
    variant.css = { light: variant.css.light + css, dark: variant.css.dark + css }
    if (title !== undefined) page.title[lang] = title
  }
  return page
}

/** Edge's publication sequence (supabase/functions/cms-studio): the stored presentation. */
function published(page: CmsPage): CmsPresentation {
  const document = emptyDocument()
  document.presentation.pages = [page]
  validateCompleteDocument(document, document)
  const placements = validateDocumentMarkupPlacements(document, policy)
  validateDocumentMedia(document, [], placements)
  validateCompleteDocument(document, document)
  return document.presentation
}

async function serve(presentation: CmsPresentation, url: string): Promise<string> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_cms_presentation')
      ? Response.json({ revision: 7, presentation })
      : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se${url}`),
    env,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  return response.text()
}

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const elements = (node: Node): Element[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
]
const attr = (element: Element, name: string): string | undefined =>
  element.attrs.find((item) => item.name === name)?.value
const text = (node: Node): string =>
  'value' in node && node.nodeName === '#text'
    ? node.value
    : 'childNodes' in node
      ? node.childNodes.map(text).join('')
      : ''

/** The served document as a browser parses it. */
function served(html: string) {
  const all = elements(parse(html))
  const [head] = all.filter((element) => element.tagName === 'head')
  const [body] = all.filter((element) => element.tagName === 'body')
  if (!head || !body) throw new Error('The served document has no head or body')
  const roots = all.filter((element) => attr(element, 'id') === 'root')
  return {
    roots,
    root: roots[0],
    refreshElements: all.filter((element) => attr(element, 'http-equiv') !== undefined).length,
    headSheet: (id: string): string | undefined => {
      const sheet = elements(head).find(
        (element) => element.tagName === 'style' && attr(element, 'id') === id,
      )
      return sheet === undefined ? undefined : text(sheet)
    },
    bodyStyles: elements(body).filter((element) => element.tagName === 'style').length,
  }
}

/** The authored main of each page, as the real #root must hold it. */
const authoredMain = {
  '/contact': (root: Element): boolean =>
    root.childNodes.some(
      (child) =>
        'tagName' in child &&
        child.tagName === 'main' &&
        elements(child).some((element) => attr(element, 'id') === 'contact-title'),
    ),
  '/hemsida': (root: Element): boolean =>
    elements(root).some(
      (element) =>
        element.tagName === 'main' &&
        attr(element, 'id') === 'cms-body-20000000-0000-4000-8000-0000000000c1-sv',
    ),
} as const
const pages = {
  '/contact': contactPage,
  '/hemsida': createdPage,
} as const
/** The page's own stored sheet before the Worker serves it: created pages keep their rules first. */
const storedCss = (path: keyof typeof pages, css: string): string =>
  path === '/contact' ? css : (createdPage('').content.sv.css.light ?? '') + css

// A dollar sign followed by a grave accent is the String.replace pattern for "everything before the
// match": the shell's whole head, including the shell's own </style>.
const REDIRECT_CSS =
  "p::before{content:'$`<meta http-equiv=refresh content=0;url=https://target.invalid/probe>'}"
// Every other replacement pattern, as ordinary CSS text, plus the ordinary `$=` attribute selector.
const DOLLAR_CSS = `.dollar::before{content:"$$ $& $' $1 $<n>"}a[href$=".pdf"]{color:#123456}`
const NORMAL_CSS = '.owner-copy{margin:1rem}@media (max-width:768px){.owner-copy{margin:0}}'

describe('owner stylesheet dollar signs in the served shell (G01)', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['/contact', '/hemsida'] as const)(
    'publishes the redirect payload, then serves %s with it as inert CSS text',
    async (path) => {
      const presentation = published(pages[path](REDIRECT_CSS))
      for (const query of ['?mode=light', '?mode=dark', '']) {
        const page = served(await serve(presentation, `${path}${query}`))
        expect(page.refreshElements, `${path}${query}: active refresh elements`).toBe(0)
        expect(page.bodyStyles, `${path}${query}: style elements in body`).toBe(0)
        expect(page.roots, `${path}${query}: #root elements`).toHaveLength(1)
        expect(page.root && authoredMain[path](page.root), `${path}${query}: authored main`).toBe(
          true,
        )
        for (const scheme of query === '' ? (['light', 'dark'] as const) : [query.slice(6)])
          expect(page.headSheet(`cms-page-${scheme}`), `${path}${query}: ${scheme} sheet`).toBe(
            storedCss(path, REDIRECT_CSS),
          )
      }
    },
  )

  it.each(['/contact', '/hemsida'] as const)(
    'serves every replacement pattern in valid %s CSS as the bytes the owner published',
    async (path) => {
      const presentation = published(pages[path](DOLLAR_CSS))
      const page = served(await serve(presentation, `${path}?mode=light`))
      expect(page.headSheet('cms-page-light')).toBe(storedCss(path, DOLLAR_CSS))
      expect(page.roots).toHaveLength(1)
      expect(page.root && authoredMain[path](page.root)).toBe(true)
      expect(page.bodyStyles).toBe(0)
    },
  )

  it.each(['/contact', '/hemsida'] as const)(
    'serves ordinary %s CSS unchanged (control)',
    async (path) => {
      const presentation = published(pages[path](NORMAL_CSS))
      const page = served(await serve(presentation, `${path}?mode=light`))
      expect(page.headSheet('cms-page-light')).toBe(storedCss(path, NORMAL_CSS))
      expect(page.refreshElements).toBe(0)
      expect(page.root && authoredMain[path](page.root)).toBe(true)
    },
  )

  // A.B01, the earlier fix: owner CSS whose generated form materialises "</style>". Validation now
  // rejects it, so the page is served as a document published before that fix (stored as is).
  it.each(['/contact', '/hemsida'] as const)(
    'keeps an escaped closing-tag payload stored on %s inert (control)',
    async (path) => {
      const boundary = `\\3c /style\\3e \\3c meta http-equiv=refresh content=0;url=https://attacker.invalid/a10-navigation\\3e `
      const css = `p::before{content:"${boundary}"}@media(prefers-color-scheme:dark){p{color:white}}`
      const presentation = { ...emptyDocument().presentation, pages: [pages[path](css)] }
      const html = await serve(presentation, `${path}?mode=light`)
      const page = served(html)
      expect(page.refreshElements).toBe(0)
      expect(html).not.toContain('</style><meta')
      expect(html).toContain('<\\/style')
      expect(page.root && authoredMain[path](page.root)).toBe(true)
    },
  )
})

describe('the shell #root found among owner bytes (G02)', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['/contact', '[id="root"]>main{color:#c80000}'],
    ['/hemsida', '[id="root"]>main{color:#c80000}'],
    ['/contact', '#root>main{color:#c80000}'],
    ['/hemsida', '#root>main{color:#c80000}'],
  ] as const)(
    'serves %s with %s: the real #root holds the authored main, the sheet stays in head',
    async (path, css) => {
      const presentation = published(pages[path](css))
      for (const query of ['?mode=light', '']) {
        const page = served(await serve(presentation, `${path}${query}`))
        expect(page.roots, `${path}${query}: #root elements`).toHaveLength(1)
        expect(page.root && authoredMain[path](page.root), `${path}${query}: authored main`).toBe(
          true,
        )
        expect(page.headSheet('cms-page-light'), `${path}${query}: light sheet`).toBe(
          storedCss(path, css),
        )
        expect(page.bodyStyles, `${path}${query}: style elements in body`).toBe(0)
      }
    },
  )

  // The same text search runs after the page title is in the shell: escapeElementText keeps quotes.
  it.each(['/contact', '/hemsida'] as const)(
    'serves %s whose owner title names id="root" with the authored main in the real #root',
    async (path) => {
      const presentation = published(pages[path](NORMAL_CSS, 'Besök id="root" här'))
      const html = await serve(presentation, `${path}?mode=light`)
      const page = served(html)
      expect(page.root && authoredMain[path](page.root)).toBe(true)
      expect(page.root && attr(page.root, 'data-cms-public')).toBe('1')
      expect(html).toContain('<title id="business-title">Besök id="root" här</title>')
    },
  )

  it('serves the /about fallback in the real #root when the SEO title names id="root"', async () => {
    // Företag & SEO accepts any 1-120 characters for the title.
    const document = emptyDocument()
    document.settings['seo_title_sv'] = 'Om salongen id="root" i Göteborg'
    validateCompleteDocument(document, document)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/rpc/public_business_discovery')
        ? Response.json({
            settings: { seo_title_sv: document.settings['seo_title_sv'] },
            barbers: [],
            services: [],
            schedules: [],
          })
        : new Response(null, { status: 503 }),
    )
    // /about is answered by the cached public-content entrypoint, as in production.
    const publicContent = new PublicContent({} as never, env)
    const response = await worker.fetch(new Request('https://bladeblendstudio.se/about'), env, {
      exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } },
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<title id="business-title">Om salongen id="root" i Göteborg</title>')
    const page = served(html)
    expect(
      page.root?.childNodes.some((child) => 'tagName' in child && child.tagName === 'main'),
    ).toBe(true)
  })
})
