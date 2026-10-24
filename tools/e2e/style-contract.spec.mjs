// Style contract (STY-12): every user-facing page outside the homepage takes its look from
// public/tokens.css and passes axe wcag2aa in both colour schemes. Static documents and the app's
// status and staff screens are served by the preview build; /terms and /privacy are the real Worker
// render of the committed production fixture (tools/e2e/cms-render.mjs).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
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
// The homepage surface (src/app/shared.ts) that every tokenised page paints.
const SURFACE = { light: 'rgb(255, 255, 255)', dark: 'rgb(28, 28, 30)' }
const WORKER_PATHS = ['/terms', '/privacy']
// `tokens: false`: the fixture's stored legal CSS still carries its own palette until it is migrated.
const PAGES = [
  { url: '/404.html', ready: 'h1', tokens: true },
  { url: '/no-such-page', ready: 'h1', tokens: true },
  { url: '/login', ready: 'text=Laddar', tokens: true, holdAdminChunk: true },
  { url: '/login', ready: '#admin-email', tokens: true },
  { url: '/reset', ready: 'h1', tokens: true },
  { url: '/privacy.html', ready: 'h1', tokens: true },
  { url: '/google-calendar.html', ready: 'h1', tokens: true },
  { url: '/contact.html', ready: 'h1', tokens: true },
  { url: '/terms', ready: 'h1', tokens: false },
  { url: '/privacy', ready: 'h1', tokens: false },
]

let rendering
let shell
test.beforeAll(async () => {
  shell = await (await fetch(`${publicOrigin}/index.html`)).text()
  rendering = await loadWorker()
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

/** The tokenised surface's background and font, or null when the page has none. */
const tokenSurface = (page) =>
  page.evaluate(() => {
    const surface = globalThis.document.querySelector('.bb-page, .bb-status')
    if (!surface) return null
    const style = globalThis.getComputedStyle(surface)
    return { background: style.backgroundColor, font: style.fontFamily.split(',')[0] }
  })

for (const scheme of ['light', 'dark']) {
  test.describe(`OS ${scheme}`, () => {
    test.use({ colorScheme: scheme })
    for (const target of PAGES) {
      const label = `${target.url}${target.holdAdminChunk ? ' (loading fallback)' : ''}`
      test(`${label} meets the style contract`, async ({ page, context }, testInfo) => {
        await installPublicBackend(context)
        if (target.holdAdminChunk) await holdAdminChunk(page)
        if (WORKER_PATHS.includes(target.url))
          await routeWorkerDocuments(page, {
            origin: publicOrigin,
            paths: WORKER_PATHS,
            worker: rendering.worker,
            presentation: fixture,
            shell,
          })
        await page.goto(`${publicOrigin}${target.url}`)
        await page.locator(target.ready).first().waitFor()
        await page.evaluate(() => globalThis.document.fonts.ready)
        const result = await audit(page)
        testInfo.annotations.push({ type: 'metrics', description: JSON.stringify(result) })
        expect(result.violations, `${label}: axe wcag2aa`).toEqual([])
        expect(result.minContrast, `${label}: lowest text contrast`).toBeGreaterThanOrEqual(4.5)
        if (target.tokens)
          expect(await tokenSurface(page), `${label}: token surface`).toEqual({
            background: SURFACE[scheme],
            font: '"Inter Variable"',
          })
      })
    }
  })
}
