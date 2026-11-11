// Style contract (STY-12): every user-facing page outside the homepage takes its look from
// public/tokens.css and passes axe wcag2aa in both colour schemes. Static documents and the app's
// status and staff screens are served by the preview build; /terms, /privacy and /contact are real Worker
// render of the committed production fixture (tools/e2e/cms-render.mjs), both as stored and after
// the Studio's legacy legal upgrade (modules/studio/src/legacyLegal.ts) that the owner publishes.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { INFORMATION_PAGE_PATHS } from '../../packages/content-contracts/src/cms.ts'
import { loadWorker, routeWorkerDocuments } from './cms-render.mjs'
import { expect, test } from './fixtures.mjs'
import { publicOrigin } from './origins.mjs'
import { installPublicBackend } from './public-fixtures.mjs'

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)
const fixture = JSON.parse(
  gunzipSync(readFileSync(new URL('./fixtures/presentation.json.gz', import.meta.url))),
).presentation
// The homepage surface (modules/public-web/src/app/shared.ts) that every tokenised page paints.
const SURFACE = { light: 'rgb(255, 255, 255)', dark: 'rgb(28, 28, 30)' }
const WORKER_PATHS = INFORMATION_PAGE_PATHS
// Where the token surface is painted: the app's status and staff screens on their own element, the
// documents on the root (public/info.css) so a CMS legal page's own body styles stay visible. `null`:
// the stored legal CSS still carries its own palette until the upgrade is published.
const APP = '.bb-page, .bb-status'
const DOC = ':root'
const PAGES = [
  { url: '/404.html', ready: 'h1', surface: DOC },
  { url: '/500.html', ready: 'h1', surface: DOC },
  { url: '/maintenance.html', ready: 'h1', surface: DOC },
  { url: '/no-such-page', ready: 'h1', surface: APP },
  // Root's fallback paints no text, and axe measures no contrast on text with opacity 0.
  { url: '/login', ready: 'text=Laddar', surface: APP, holdAdminChunk: true, noPaintedText: true },
  { url: '/login', ready: '#admin-email', surface: APP },
  { url: '/reset', ready: 'h1', surface: APP },
  { url: '/privacy.html', ready: 'h1', surface: DOC },
  { url: '/google-calendar.html', ready: 'h1', surface: DOC },
  { url: '/contact.html', ready: 'h1', surface: DOC },
  { url: '/terms', ready: 'h1', surface: null, presentation: 'stored' },
  { url: '/privacy', ready: 'h1', surface: null, presentation: 'stored' },
  { url: '/terms', ready: 'h1', surface: DOC, presentation: 'upgraded' },
  { url: '/privacy', ready: 'h1', surface: DOC, presentation: 'upgraded' },
  { url: '/contact', ready: 'h1', surface: DOC, presentation: 'upgraded' },
]
// The static documents that carry the skip link of public/info.css in their own markup.
const SKIP_DOCUMENTS = ['/404.html', '/500.html', '/maintenance.html', '/google-calendar.html']
// Every static document on public/info.css; contact and terms have both a breadcrumb and a footer.
const PRINT_DOCUMENTS = [
  '/404.html',
  '/500.html',
  '/maintenance.html',
  '/contact.html',
  '/terms.html',
  '/privacy.html',
  '/google-calendar.html',
]

let rendering
let shell
const presentations = { stored: fixture }
test.beforeAll(async () => {
  shell = await (await fetch(`${publicOrigin}/index.html`)).text()
  rendering = await loadWorker()
  const { upgradeLegacyLegalPages } = await rendering.load('/modules/studio/src/legacyLegal.ts')
  presentations.upgraded = upgradeLegacyLegalPages({ presentation: fixture }).presentation
  if (presentations.upgraded === fixture) throw new Error('The fixture has no legacy legal CSS')
  // Contact's new Studio import stores the fallback body and its own rules, without copying the
  // base sheets. The CMS upgrade itself is exercised with the real importer in cms-reported.
  const html = readFileSync(new URL('../../public/contact.html', import.meta.url), 'utf8')
  const variant = {
    html: html.split('<body>')[1].split('</body>')[0],
    css: { light: '', dark: '' },
  }
  presentations.upgraded.pages.push({
    id: '10000000-0000-4000-8000-000000000007',
    path: '/contact',
    kind: 'page',
    name: { sv: 'Kontakt', en: 'Contact' },
    title: { sv: 'Kontakt', en: 'Contact' },
    description: { sv: '', en: '' },
    inMenu: false,
    content: { sv: globalThis.structuredClone(variant), en: globalThis.structuredClone(variant) },
  })
})
test.afterAll(async () => rendering?.close())

/** Keep the lazy admin chunk pending so Root's Suspense fallback stays on screen. */
async function holdAdminChunk(page) {
  const shellScripts = [...shell.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
  await page.route(
    (url) => url.origin === publicOrigin && /^\/assets\/.+\.js$/.test(url.pathname),
    (route) =>
      shellScripts.includes(new URL(route.request().url()).pathname) ? route.continue() : undefined,
  )
}

/** axe wcag2a/wcag2aa violations, plus the lowest text contrast axe measured. */
async function audit(page) {
  await page.evaluate(`${AXE_SOURCE}\n;undefined`)
  return page.evaluate(async () => {
    const results = await globalThis.axe.run(globalThis.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })
    const contrast = [...results.passes, ...results.violations]
      .filter((rule) => rule.id === 'color-contrast')
      .flatMap((rule) => rule.nodes.flatMap((node) => node.any))
      .map((check) => check.data?.contrastRatio)
      .filter((ratio) => Number.isFinite(ratio))
    return {
      violations: results.violations.flatMap((rule) =>
        rule.nodes.map((node) => `${rule.id} ${node.target.join(' ')}`),
      ),
      minContrast: contrast.length > 0 ? Math.min(...contrast) : null,
    }
  })
}

/** The surface's background and font; on a document also the colour a visitor sees inside its
 * main: the first painted background in the stack at a point within main.bb-doc. */
const tokenSurface = (page, selector) =>
  page.evaluate((selector) => {
    const surface = globalThis.document.querySelector(selector)
    if (!surface) return null
    const style = globalThis.getComputedStyle(surface)
    // Chromium quotes the family name in the computed value; Firefox and WebKit do not.
    const font = style.fontFamily.split(',')[0].replaceAll('"', '').trim()
    const doc = globalThis.document.querySelector('main.bb-doc')
    if (!doc) return { background: style.backgroundColor, font }
    const box = doc.getBoundingClientRect()
    const seen = globalThis.document
      .elementsFromPoint(box.left + 4, Math.min(box.top + 8, globalThis.innerHeight - 1))
      .map((element) => globalThis.getComputedStyle(element).backgroundColor)
      .find((color) => color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color))
    return { background: style.backgroundColor, font, seen: seen ?? null }
  }, selector)

/** What the paper styles of public/info.css decide, as computed under the current media. */
const paper = (page) =>
  page.evaluate(() => {
    const OWN_NAVIGATION = '.bb-doc > nav, .bb-doc > footer'
    const computed = (element, pseudo) => globalThis.getComputedStyle(element, pseudo)
    const main = globalThis.document.querySelector('main.bb-doc')
    const elements = [main, ...main.querySelectorAll('*')]
    const worded = (element) =>
      [...element.childNodes].some((node) => node.nodeType === 3 && node.data.trim() !== '')
    const link = [...main.querySelectorAll('a[href^="/"]')].find(
      (item) => !item.closest(OWN_NAVIGATION),
    )
    return {
      root: computed(globalThis.document.documentElement).backgroundColor,
      text: [...new Set(elements.filter(worded).map((element) => computed(element).color))],
      backgrounds: [
        ...new Set(elements.map((element) => computed(element).backgroundColor)),
      ].filter((color) => color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)),
      hidden: [
        ...new Set(
          [...globalThis.document.querySelectorAll(`.bb-skip, ${OWN_NAVIGATION}`)].map(
            (element) => computed(element).display,
          ),
        ),
      ],
      address: link ? computed(link, '::after').content : null,
    }
  })

for (const scheme of ['light', 'dark']) {
  test.describe(`OS ${scheme}`, () => {
    test.use({ colorScheme: scheme })
    for (const target of PAGES) {
      const variant = target.holdAdminChunk ? ' (loading fallback)' : ''
      const label = `${target.url}${target.presentation ? ` (${target.presentation})` : variant}`
      test(`${label} meets the style contract`, async ({
        page,
        context,
        evidenceDir,
      }, testInfo) => {
        await installPublicBackend(context)
        if (target.holdAdminChunk) await holdAdminChunk(page)
        if (target.presentation)
          await routeWorkerDocuments(page, {
            origin: publicOrigin,
            paths: WORKER_PATHS,
            worker: rendering.worker,
            presentation: presentations[target.presentation],
            shell,
          })
        // The held chunk never settles. WebKit keeps the document loading while a module request is
        // pending, so neither the load event nor document.fonts.ready (which WebKit resolves only
        // after it) ever comes: the fallback waits for its own ready text and the faces it lays out.
        await page.goto(
          `${publicOrigin}${target.url}`,
          target.holdAdminChunk ? { waitUntil: 'domcontentloaded' } : {},
        )
        await page.locator(target.ready).first().waitFor()
        if (target.holdAdminChunk)
          await page.waitForFunction(() =>
            [...globalThis.document.fonts].every((face) => face.status !== 'loading'),
          )
        else await page.evaluate(() => globalThis.document.fonts.ready)
        // The before/after pair of the legal pages, for review (not compared).
        if (target.presentation)
          await page.screenshot({ path: `${evidenceDir}/${scheme}.png`, fullPage: true })
        const result = await audit(page)
        testInfo.annotations.push({ type: 'metrics', description: JSON.stringify(result) })
        expect(result.violations, `${label}: axe wcag2aa`).toEqual([])
        if (!target.noPaintedText)
          expect(result.minContrast, `${label}: lowest text contrast`).toBeGreaterThanOrEqual(4.5)
        if (target.surface)
          expect(await tokenSurface(page, target.surface), `${label}: token surface`).toEqual({
            background: SURFACE[scheme],
            font: 'Inter Variable',
            ...(target.surface === DOC ? { seen: SURFACE[scheme] } : {}),
          })
      })
    }

    for (const url of SKIP_DOCUMENTS)
      test(`${url} shows its skip link only while it has focus`, async ({ page, context }) => {
        await installPublicBackend(context)
        await page.goto(`${publicOrigin}${url}`)
        await page.evaluate(() => globalThis.document.fonts.ready)
        const skip = page.locator('a.bb-skip')
        await expect(skip).not.toBeInViewport()
        const first = await page.evaluate(
          () =>
            globalThis.document.querySelector(
              'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
            )?.className,
        )
        expect(first, `${url}: first focusable element`).toBe('bb-skip bb-btn')
        // Focused by script rather than Tab: WebKit on macOS leaves links out of the Tab order.
        await skip.focus()
        await expect(skip).toBeInViewport({ ratio: 1 })
        const result = await audit(page)
        expect(result.violations, `${url}: axe wcag2aa with the skip link shown`).toEqual([])
        expect(result.minContrast, `${url}: lowest text contrast`).toBeGreaterThanOrEqual(4.5)
        await skip.press('Enter')
        await expect(page).toHaveURL(`${publicOrigin}${url}#main`)
        await expect(skip).not.toBeInViewport()
      })
  })
}

// One test for all: a test per document and scheme would open a context apiece on every engine.
test('the static documents print black on white without their navigation', async ({
  page,
  context,
}) => {
  await installPublicBackend(context)
  for (const url of PRINT_DOCUMENTS) {
    await page.goto(`${publicOrigin}${url}`)
    await page.locator('h1').first().waitFor()
    for (const scheme of ['light', 'dark']) {
      const label = `${url} (OS ${scheme})`
      await page.emulateMedia({ media: null, colorScheme: scheme })
      const screen = await paper(page)
      expect(screen.root, `${label}: screen surface`).toBe(SURFACE[scheme])
      expect(screen.address, `${label}: no link address on screen`).not.toContain(
        'bladeblendstudio.se',
      )
      await page.emulateMedia({ media: 'print' })
      const printed = await paper(page)
      expect(printed.root, `${label}: paper`).toBe('rgb(255, 255, 255)')
      expect(printed.text, `${label}: text colours`).toEqual(['rgb(0, 0, 0)'])
      expect(
        printed.backgrounds.filter((color) => color !== 'rgb(255, 255, 255)'),
        `${label}: painted backgrounds`,
      ).toEqual([])
      expect(printed.hidden, `${label}: skip link, breadcrumb and footer`).toEqual(['none'])
      expect(printed.address, `${label}: address after a link to the site`).toContain(
        'bladeblendstudio.se',
      )
    }
  }
})
