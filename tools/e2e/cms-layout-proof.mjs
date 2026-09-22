import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-layout'
await mkdir(out, { recursive: true })
const checks = []
for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const browser = await engine.launch()
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      context.setDefaultTimeout(15000)
      await nativeBackend(context)
      const page = await context.newPage()
      await page.goto('http://127.0.0.1:4188/tools/e2e/admin-harness.html?view=cms-studio')
      await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
      await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      await page.frameLocator('.gjs-frame').first().getByText('KNC source sv', { exact: true }).first().waitFor({ state: 'attached' })
      if (width === 390) await page.locator('.cms-mobile-tools').getByRole('button', { name: 'Egenskaper', exact: true }).click()
      await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
      const blocks = await page.locator('.gjs-block').evaluateAll(nodes => nodes.slice(0, 2).map(node => {
        const r = node.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }))
      checks.push({ name, width, check: 'Two-column block palette', passed: blocks.length === 2 && Math.abs(blocks[0].y - blocks[1].y) < 2 && blocks[1].x > blocks[0].x, blocks })
      await page.screenshot({ path: `${out}/${name}-${width}-blocks.png` })
      if (width === 390) await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Jämför', exact: true }).click()
      await page.locator('.cms-compare-pane iframe').waitFor()
      const dimensions = await page.locator('.cms-compare-pane iframe').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }))
      const expected = width === 390 ? { width: 1440, height: 900 } : { width: 390, height: 844 }
      checks.push({ name, width, check: 'Comparison uses the intended device viewport', passed: dimensions.width === expected.width && dimensions.height === expected.height, dimensions, expected })
      await page.screenshot({ path: `${out}/${name}-${width}-comparison.png` })
      await writeFile(`${out}/layout.json`, JSON.stringify(checks, null, 2))
      await context.close()
    }
  } finally { await browser.close() }
}
await writeFile(`${out}/layout.json`, JSON.stringify(checks, null, 2))
console.log(JSON.stringify(checks, null, 2))
assert.ok(checks.every(check => check.passed), 'Workspace geometry')
