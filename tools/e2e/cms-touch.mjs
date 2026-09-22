import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-edge'
await mkdir(out, { recursive: true })
const results = []
const failures = []
for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (process.env.CMS_BROWSER && process.env.CMS_BROWSER !== name) continue
  const browser = await engine.launch()
  try {
    for (const [width, height, touch] of [
      [1920, 1080, false],
      [390, 844, true],
      [844, 390, true],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: touch,
        isMobile: touch,
        reducedMotion: 'reduce',
      })
      context.setDefaultTimeout(15000)
      const backend = await nativeBackend(context)
      const page = await context.newPage()
      const prefix = `${name}-${width}x${height}`
      const activate = (node) => (touch ? node.tap() : node.click())
      const capture = async (state) => {
        await page.screenshot({ path: `${out}/${prefix}-${state}.png` })
        const metrics = await page.evaluate(() => {
          const button = globalThis.document.querySelector('.cms-publish')
          const r = button.getBoundingClientRect()
          const body = globalThis.document.querySelector('.cms-workspace-content')
          return {
            overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
            publish: button.contains(
              globalThis.document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            ),
            bodyHeight: body?.clientHeight,
          }
        })
        results.push({ prefix, state, metrics })
        assert.ok(!metrics.overflow, `${prefix}/${state}: horizontal overflow`)
        assert.ok(metrics.publish, `${prefix}/${state}: publication obscured`)
        if (metrics.bodyHeight !== undefined)
          assert.ok(
            metrics.bodyHeight >= 100,
            `${prefix}/${state}: workspace too short to use (${metrics.bodyHeight}px)`,
          )
      }
      try {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () =>
          (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
        )
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        await page
          .frameLocator('.gjs-frame')
          .first()
          .locator(`[data-knc-surface="${touch ? 'mobile' : 'desktop'}-home"]`)
          .waitFor()
        await capture('editor')
        if (touch) {
          await activate(
            page.locator('.cms-mobile-tools').getByRole('button', { name: 'Sidor', exact: true }),
          )
          await page.screenshot({ path: `${out}/${prefix}-drawer.png` })
        }
        await activate(page.getByRole('button', { name: 'Business / SEO', exact: true }))
        await page.getByRole('region', { name: 'Företag & sökresultat' }).waitFor()
        await capture('business')
        await activate(page.getByRole('button', { name: 'Tillbaka till sidan', exact: true }))
        if (touch)
          await activate(
            page.locator('.cms-mobile-tools').getByRole('button', { name: 'Sidor', exact: true }),
          )
        await activate(page.getByRole('button', { name: '◐ Webbplatsens stil', exact: true }))
        if (touch) {
          // A hidden preview must survive time spent editing before it is shown.
          if (width === 390) await new Promise((resolve) => globalThis.setTimeout(resolve, 22000))
          await activate(page.getByRole('button', { name: 'Förhandsvisa stil', exact: true }))
        }
        await page.waitForFunction(
          () =>
            globalThis.document.querySelector('.cms-live-preview')?.dataset.previewState ===
            'ready',
          null,
          { timeout: 30000 },
        )
        const visibleFrame = await page.locator('.cms-live-preview iframe').evaluate((node) => {
          const frame = node.getBoundingClientRect()
          const content = globalThis.document
            .querySelector('.cms-workspace-content')
            .getBoundingClientRect()
          return frame.top >= content.top && frame.bottom <= content.bottom + 1
        })
        assert.ok(visibleFrame, `${prefix}: theme preview fits the visible workspace`)
        await capture('theme')
        assert.equal(backend.writes.length, 0)
      } catch (error) {
        failures.push(`${prefix}: ${error.message}`)
        await page.screenshot({ path: `${out}/${prefix}-failure.png` }).catch(() => {})
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
await writeFile(`${out}/touch-report.json`, JSON.stringify({ results, failures }, null, 2))
console.log(JSON.stringify({ results, failures }, null, 2))
assert.deepEqual(failures, [])
