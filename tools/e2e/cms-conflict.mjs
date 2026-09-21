import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const failures = []

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (process.env.CMS_BROWSER && process.env.CMS_BROWSER !== name) continue
  const browser = await engine.launch()
  try {
    for (const scenario of ['keep-local', 'keep-server', 'stale-backup', 'conflict-reload']) {
      if (process.env.CMS_CONFLICT_SCENARIO && process.env.CMS_CONFLICT_SCENARIO !== scenario)
        continue
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      })
      context.setDefaultTimeout(10000)
      const backend = await nativeBackend(context)
      // Model the real API's 409 response, not a thrown test-runner assertion.
      await context.route('**/functions/v1/cms-studio', async (route) => {
        const request = route.request()
        if (request.method() !== 'POST') return route.fallback()
        const body = request.postDataJSON()
        const revision = 1 + backend.writes.filter((value) => value === 'publish').length
        const fingerprint = createHash('md5').update(JSON.stringify(backend.document)).digest('hex')
        if (
          body.operation === 'publish' &&
          (body.baseRevision !== revision || body.baseFingerprint !== fingerprint)
        )
          return route.fulfill({
            status: 409,
            headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
            json: {
              error: 'conflict',
              message: 'Innehållet har ändrats. Jämför med den senaste versionen.',
            },
          })
        return route.fallback()
      })
      const first = await context.newPage()
      const second = await context.newPage()
      const canvas = (page) => page.frameLocator('.gjs-frame').first()
      const mount = async (page, expected = 'KNC source sv') => {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () => {
          const harness = await import('/tools/e2e/admin-harness.tsx')
          harness.mountCmsStudioHarness()
        })
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        await canvas(page).getByText(expected, { exact: true }).first().waitFor()
        await page.getByRole('button', { name: 'Fit', exact: true }).click()
      }
      const edit = async (page, value) => {
        await canvas(page).getByText('KNC source sv', { exact: true }).first().click()
        await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(value)
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Opublicerade'),
        )
      }
      const publish = async (page) => {
        await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
        )
      }
      try {
        await mount(first)
        await publish(first)
        await mount(second)
        await edit(second, 'Local owner change')
        await edit(first, 'Remote owner change')
        await publish(first)
        if (scenario === 'stale-backup') await mount(second, 'Local owner change')
        else await second.getByRole('button', { name: 'Save / Publicera', exact: true }).click()

        if (scenario === 'conflict-reload') {
          await second
            .getByRole('button', { name: 'Behåll mina konfliktändringar', exact: true })
            .waitFor()
          await mount(second, 'Local owner change')
        }
        const keepLocal = second.getByRole('button', {
          name: 'Behåll mina konfliktändringar',
          exact: true,
        })
        const keepServer = second.getByRole('button', {
          name: 'Använd serverns konfliktändringar',
          exact: true,
        })
        await keepLocal.waitFor()
        await keepServer.waitFor()
        assert.equal(
          await second.getByRole('button', { name: 'Save / Publicera', exact: true }).isDisabled(),
          true,
          'Unresolved conflicts must block publication',
        )
        const live = await context.newPage()
        await live.goto(base)
        await live.getByText('Remote owner change', { exact: true }).waitFor()
        if (scenario === 'keep-server') {
          await keepServer.click()
          await canvas(second).getByText('Remote owner change', { exact: true }).waitFor()
          await mount(second, 'Remote owner change')
          assert.equal(await canvas(second).getByText('Local owner change').count(), 0)
        } else {
          await keepLocal.click()
          await canvas(second).getByText('Local owner change', { exact: true }).waitFor()
          // Resolving a conflict is only a draft change, never an implicit publish.
          await live.reload()
          await live.getByText('Remote owner change', { exact: true }).waitFor()
          await publish(second)
          await live.reload()
          await live.getByText('Local owner change', { exact: true }).waitFor()
        }
        await second.screenshot({ path: `/tmp/cms-native-${name}-revision-${scenario}.png` })
        console.log(`PASS revision ${name}: ${scenario}`)
      } catch (error) {
        failures.push(`${name}/${scenario}: ${error.message}`)
        console.error(`FAIL revision ${name}: ${scenario}`, error)
        await second.screenshot({
          path: `/tmp/cms-native-${name}-revision-${scenario}-failure.png`,
        })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
assert.deepEqual(failures, [], 'Concurrent editing and stale recovery must not silently overwrite')
