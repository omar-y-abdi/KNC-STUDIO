import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument } from '../../shared/cms.ts'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-mobile'
await mkdir(out, { recursive: true })
const results = []
const check = (passed, name, detail) => results.push({ passed: Boolean(passed), name, detail })
const selectedEngines = Object.entries({ chromium, webkit }).filter(([name]) => !process.env.CMS_ENGINE || process.env.CMS_ENGINE === name)
assert.ok(selectedEngines.length, 'No matching browser engine')
for (const [name, engine] of selectedEngines) {
  const browser = await engine.launch()
  try {
    for (const width of [390, 320]) {
      const height = width === 390 ? 690 : 568
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: true, hasTouch: true })
      context.setDefaultTimeout(15000)
      const seed = emptyDocument()
      seed.barbers = ['Exempel A', 'Exempel B'].map((label, i) => ({ id: `example-${i}`, name: label, ig: '', role_sv: 'Frisör', role_en: 'Barber', bio_sv: 'Presentation av frisören.', bio_en: 'Barber presentation.', sort_order: i }))
      const backend = await nativeBackend(context, seed)
      await context.route('https://admin-harness.invalid/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (request.method() !== 'OPTIONS' && ['/rest/v1/rpc/public_business_discovery', '/rest/v1/rpc/public_booking_catalog'].includes(url.pathname))
          return route.fulfill({ headers: { 'Access-Control-Allow-Origin': new URL(base).origin }, json: { settings: {}, barbers: seed.barbers.map(barber => ({ ...barber, active: true, photo_path: null })), services: [], schedules: [] } })
        return route.fallback()
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const prefix = `${name}-${width}`
      const shot = label => page.screenshot({ path: `${out}/${prefix}-${label}.png`, animations: 'disabled' })
      try {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        const frame = page.frameLocator('.gjs-frame').first()
        await frame.locator('[data-knc-surface="mobile-home"]').waitFor()
        const infoClose = page.locator('.cms-notice-info button')
        if (await infoClose.isVisible()) await infoClose.click()
        await page.locator('.cms-mobile-tools').getByRole('button', { name: 'Sidor', exact: true }).click()
        await page.locator('.cms-page-list').getByRole('button', { name: 'Om oss', exact: true }).click()
        await page.getByRole('button', { name: 'Mörk', exact: true }).click()
        await frame.locator('[data-knc-surface="mobile-about"]').waitFor()
        await page.getByRole('button', { name: 'Anpassa vyn', exact: true }).click()
        const geometry = () => page.evaluate(() => {
          const bounds = selector => {
            const rect = globalThis.document.querySelector(selector).getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
          }
          const frame = globalThis.document.querySelector('.gjs-frame')
          return { native: { width: frame.contentWindow.innerWidth, height: frame.contentWindow.innerHeight }, frame: bounds('.gjs-frame'), host: bounds('.cms-editor-canvas'), header: bounds('.cms-topbar'), toolbar: bounds('.cms-canvas-toolbar'), dock: bounds('.cms-bottom'), root: bounds('.knc-cms-studio') }
        })
        await page.waitForFunction(() => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390)
        let state = await geometry()
        check(state.native.height === 844, `${prefix}: phone viewport remains 390 by 844`, state)
        check(state.header.height <= 94 && state.toolbar.height <= 78 && state.dock.height <= 76, `${prefix}: compact chrome budgets`, state)
        check(state.host.height >= height * 0.57, `${prefix}: majority of the workspace belongs to the canvas`, state)
        check(state.frame.x >= state.host.x - 1 && state.frame.right <= state.host.right + 1 && state.frame.y >= state.host.y - 1 && state.frame.bottom <= state.host.bottom + 1, `${prefix}: fit reveals the complete device`, state)
        await shot('about-fit')
        for (const control of ['Zooma in', 'Zooma ut']) {
          await page.getByRole('button', { name: control, exact: true }).click()
          state = await geometry()
          check(state.native.width === 390 && state.native.height === 844, `${prefix}: ${control} changes scale, never native dimensions`, state)
        }
        await page.getByRole('button', { name: 'Anpassa vyn', exact: true }).click()
        const opener = page.locator('.cms-mobile-tools').getByRole('button', { name: 'Egenskaper', exact: true })
        await opener.click()
        const panel = page.locator('#cms-inspector')
        const panelState = () => panel.evaluate(node => {
          const rect = node.getBoundingClientRect()
          const close = node.querySelector('[aria-label="Stäng panel"]')
          const target = close.getBoundingClientRect()
          return { height: rect.height, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, closeReachable: close.contains(globalThis.document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2)), focusInside: node.contains(globalThis.document.activeElement), modal: node.getAttribute('aria-modal') === 'true' }
        })
        let drawer = await panelState()
        check(drawer.height >= height * 0.85 && drawer.top >= 0 && drawer.bottom <= height, `${prefix}: inspector uses the viewport instead of the clipped canvas`, drawer)
        check(drawer.closeReachable && drawer.focusInside && drawer.modal, `${prefix}: inspector is operable and modal`, drawer)
        await shot('inspector')
        await page.keyboard.press('Escape')
        check(await opener.evaluate(node => node === globalThis.document.activeElement), `${prefix}: inspector restores focus`)
        await page.locator('.cms-mobile-tools').getByRole('button', { name: 'Sidor', exact: true }).click()
        await page.getByRole('searchbox', { name: 'Sök sidor', exact: true }).fill('Om')
        await shot('pages')
        await page.keyboard.press('Escape')
        if (width === 390) {
          await opener.click()
          await page.evaluate(() => {
            Object.defineProperty(globalThis.visualViewport, 'height', { configurable: true, value: 360 })
            globalThis.visualViewport.dispatchEvent(new Event('resize'))
          })
          await page.waitForFunction(() => globalThis.document.querySelector('.knc-cms-studio').getBoundingClientRect().height <= 361, null, { timeout: 2000 }).catch(() => undefined)
          drawer = await panelState()
          check(drawer.bottom <= 360 && drawer.height >= 300, `${prefix}: keyboard viewport keeps the panel and close control reachable`, drawer)
          await shot('keyboard-geometry')
          await page.evaluate(() => { delete globalThis.visualViewport.height; globalThis.visualViewport.dispatchEvent(new Event('resize')) })
          await page.keyboard.press('Escape')
          await page.setViewportSize({ width: 844, height: 390 })
          await opener.click()
          drawer = await panelState()
          check(drawer.height >= 330 && drawer.bottom <= 390, `${prefix}: landscape drawer remains useful`, drawer)
          await shot('landscape')
          await page.keyboard.press('Escape')
          await page.setViewportSize({ width: 1440, height: 900 })
          await page.getByRole('button', { name: 'Dator', exact: true }).click()
          await page.getByRole('button', { name: 'Anpassa vyn', exact: true }).click()
          state = await geometry()
          check(state.native.width === 1440 && state.native.height === 900, `${prefix}: desktop device remains intact`, state)
          await shot('desktop')
        }
        check(backend.writes.length === 0, `${prefix}: inspecting and resizing never publishes`, backend.writes)
        check(errors.length === 0, `${prefix}: no uncaught browser errors`, errors)
      } catch (error) {
        check(false, `${prefix}: scenario completes`, error.stack ?? String(error))
        await shot('failure').catch(() => undefined)
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
await writeFile(`${out}/mobile-results.json`, JSON.stringify(results, null, 2))
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`)
assert.equal(results.filter(result => !result.passed).length, 0, 'Mobile workspace regression contracts failed')
