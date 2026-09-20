import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const failures = []

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  const browser = await engine.launch()
  try {
    for (const scenario of ['duplicate', 'add-block', 'revert-reload', 'selection', 'compare', 'literal-text']) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        reducedMotion: 'reduce',
      })
      context.setDefaultTimeout(10000)
      await nativeBackend(context)
      const page = await context.newPage()
      const frame = page.frameLocator('.gjs-frame').first()
      const inspector = page.locator('#cms-inspector')
      const mount = async () => {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () => {
          const harness = await import('/tools/e2e/admin-harness.tsx')
          harness.mountCmsStudioHarness()
        })
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
        await page.getByRole('button', { name: 'Fit', exact: true }).click()
      }
      const selectCopy = async () => {
        const copy = frame.getByText('KNC source sv', { exact: true }).first()
        const id = await copy.getAttribute('id')
        await copy.click()
        await inspector.getByLabel('Text', { exact: true }).waitFor()
        return id
      }
      const publish = async () => {
        await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
        )
      }
      try {
        await mount()
        if (scenario === 'duplicate') {
          await selectCopy()
          await inspector.getByRole('button', { name: 'Duplicera', exact: true }).click()
          await inspector.getByLabel('Text', { exact: true }).fill('Owner duplicated the real site')
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText('Owner duplicated the real site', { exact: true }).waitFor()
          await live.getByText('KNC source sv', { exact: true }).first().waitFor()
          await live.reload()
          await live.getByText('Owner duplicated the real site', { exact: true }).waitFor()
        } else if (scenario === 'add-block') {
          await inspector.getByRole('tab', { name: 'Lägg till', exact: true }).click()
          await page.locator('.gjs-block').filter({ hasText: /^Rubrik$/ }).click()
          await frame.getByRole('heading', { name: 'Ny rubrik', exact: true }).waitFor()
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByRole('heading', { name: 'Ny rubrik', exact: true }).waitFor()
        } else if (scenario === 'revert-reload') {
          await publish()
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Discard this owner edit')
          await page.waitForFunction(() =>
            globalThis.document.querySelector('.cms-status')?.textContent?.includes('Opublicerade'),
          )
          await page.getByRole('button', { name: 'Revert', exact: true }).click()
          await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
          await mount()
          assert.equal(await frame.getByText('Discard this owner edit', { exact: true }).count(), 0)
        } else if (scenario === 'selection') {
          const id = await selectCopy()
          await page.locator('#cms-library').getByRole('button', { name: 'Om oss', exact: true }).click()
          await page.locator('#cms-library').getByRole('button', { name: 'Startsida', exact: true }).click()
          await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
          await page.waitForFunction(
            (selectedId) => globalThis.document.querySelector('.cms-selection-head')?.textContent?.includes(selectedId),
            id,
          )
        } else if (scenario === 'compare') {
          await page.getByRole('button', { name: 'Mörk', exact: true }).click()
          await page.getByRole('button', { name: 'Jämför', exact: true }).click()
          const expected = await frame.locator('[data-knc-surface="mobile-home"]').evaluate(
            (node) => globalThis.getComputedStyle(node).backgroundColor,
          )
          const comparison = page.frameLocator('.cms-compare-pane iframe')
          const actual = await comparison.locator('[data-knc-surface="mobile-home"]').evaluate(
            (node) => ({ color: globalThis.getComputedStyle(node).backgroundColor, width: globalThis.innerWidth }),
          )
          assert.equal(actual.width, 390, 'Compare must use the opposite device viewport')
          assert.equal(actual.color, expected, 'Compare must render the selected dark theme, not the light snapshot')
        } else {
          await selectCopy()
          const text = 'KNC <strong>literal</strong> & text'
          await inspector.getByLabel('Text', { exact: true }).fill(text)
          await frame.getByText(text, { exact: true }).waitFor()
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText(text, { exact: true }).waitFor()
        }
        await page.screenshot({ path: `/tmp/cms-native-${name}-owner-${scenario}.png` })
        console.log(`PASS owner ${name}: ${scenario}`)
      } catch (error) {
        failures.push(`${name}/${scenario}: ${error.message}`)
        console.error(`FAIL owner ${name}: ${scenario}`, error)
        await page.screenshot({ path: `/tmp/cms-native-${name}-owner-${scenario}-failure.png` })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
assert.deepEqual(failures, [], 'Owner workflows must work beyond the initial green smoke test')
