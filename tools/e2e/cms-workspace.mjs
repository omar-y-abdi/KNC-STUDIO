import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-workspace'
await mkdir(out, { recursive: true })
const results = []
const failures = []
const check = (condition, message, details) => {
  results.push({ message, passed: Boolean(condition), details })
  if (!condition) failures.push(message)
}

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  const browser = await engine.launch()
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 900 : 844 },
        reducedMotion: 'reduce',
        colorScheme: 'light',
      })
      context.setDefaultTimeout(12000)
      const backend = await nativeBackend(context)
      const page = await context.newPage()
      const prefix = `${name}/${width}`
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () =>
          (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
        )
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        const frame = page.frameLocator('.gjs-frame').first()
        await frame
          .locator(`[data-knc-surface="${width <= 900 ? 'mobile-home' : 'desktop-home'}"]`)
          .waitFor({ state: 'visible' })
        await page.screenshot({
          path: `${out}/${name}-${width}-initial.png`,
          animations: 'disabled',
        })
        const metrics = await page.evaluate(() => {
          const publish = globalThis.document.querySelector('.cms-publish')
          const box = publish.getBoundingClientRect()
          const controls = [...globalThis.document.querySelectorAll('.cms-bottom button')].filter(
            (node) => node.getClientRects().length,
          )
          const clipped = controls
            .filter((node) => {
              const rect = node.getBoundingClientRect()
              return (
                rect.left < -1 ||
                rect.right > globalThis.innerWidth + 1 ||
                rect.bottom > globalThis.innerHeight + 1
              )
            })
            .map((node) => node.textContent.trim())
          return {
            headerPublish: Boolean(publish.closest('.cms-topbar')),
            publishReachable: publish.contains(
              globalThis.document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            ),
            publishHeight: box.height,
            clipped,
            horizontalOverflow:
              globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
          }
        })
        check(
          await page.locator('.cms-backdrop').isHidden(),
          `${prefix}: a closed drawer never blocks the canvas`,
        )
        check(metrics.headerPublish, `${prefix}: publication stays in the persistent header`)
        check(
          metrics.publishReachable && metrics.publishHeight >= 40,
          `${prefix}: publication is reachable and touch-sized`,
          metrics,
        )
        check(
          !metrics.clipped.length,
          `${prefix}: the command dock never clips actions`,
          metrics.clipped,
        )
        check(!metrics.horizontalOverflow, `${prefix}: no page-level horizontal overflow`)
        check(
          (await page
            .getByRole('button', { name: width <= 900 ? 'Mobil' : 'Dator', exact: true })
            .getAttribute('aria-pressed')) === 'true',
          `${prefix}: initial canvas matches the operator's device`,
        )
        check(
          await page.locator('.cms-canvas-breadcrumb').isVisible(),
          `${prefix}: the current page remains identified`,
        )
        const library = page.locator('#cms-library')
        const tools = page.locator('.cms-mobile-tools')
        if (width <= 900) {
          const trigger = tools.getByRole('button', { name: 'Sidor', exact: true })
          await trigger.click()
          const state = await library.evaluate((node) => ({
            dialog:
              node.getAttribute('role') === 'dialog' && node.getAttribute('aria-modal') === 'true',
            focused: node.contains(globalThis.document.activeElement),
            backgroundInert: Boolean(
              globalThis.document.querySelector('.cms-editor-canvas').closest('[inert]'),
            ),
            close: [...node.querySelectorAll('button')].some(
              (button) => button.getAttribute('aria-label') === 'Stäng panel',
            ),
          }))
          check(
            state.dialog && state.focused && state.backgroundInert && state.close,
            `${prefix}: page drawer isolates background and owns focus`,
            state,
          )
          const close = library.getByRole('button', { name: 'Stäng panel', exact: true })
          await close.focus()
          await page.keyboard.press('Shift+Tab')
          check(
            await library.evaluate((node) => node.contains(globalThis.document.activeElement)),
            `${prefix}: reverse Tab wraps within the drawer`,
          )
          await page.keyboard.press('Tab')
          check(
            await close.evaluate((node) => node === globalThis.document.activeElement),
            `${prefix}: forward Tab wraps to the close control`,
          )
          await page.keyboard.press('Escape')
          await library.waitFor({ state: 'hidden' })
          check(
            await trigger.evaluate((node) => node === globalThis.document.activeElement),
            `${prefix}: Escape restores opener focus`,
          )
          await trigger.click()
        }
        const pageList = await library.locator('.cms-page-list').evaluate((node) => ({
          available: node.clientHeight,
          content: node.scrollHeight,
        }))
        check(
          pageList.content <= pageList.available + 1,
          `${prefix}: library pages use the drawer's scroll flow, not a crushed nested list`,
          pageList,
        )
        const search = page.getByRole('searchbox', { name: 'Sök sidor' })
        await search.fill('no-page-with-this-name')
        check(
          /Ingen sida|Inga sidor/.test(await library.innerText()),
          `${prefix}: empty page search explains the result`,
        )
        await library.getByRole('button', { name: 'Rensa sökning', exact: true }).click()
        check((await search.inputValue()) === '', `${prefix}: empty search has a working reset`)
        if (width <= 900) {
          // Native dialogs must own focus without an enclosing drawer fighting them.
          await library.getByRole('button', { name: '+ Ny sida', exact: true }).click()
          const dialog = page.getByRole('dialog', { name: 'Ny sida', exact: true })
          await dialog.waitFor()
          check(
            await dialog.evaluate((node) => node.contains(globalThis.document.activeElement)),
            `${prefix}: nested task dialog owns focus`,
          )
          check(!(await library.isVisible()), `${prefix}: task dialog dismisses the page drawer`)
          await page.keyboard.press('Escape')
          await dialog.waitFor({ state: 'hidden' })
          await tools.getByRole('button', { name: 'Egenskaper', exact: true }).click()
        }
        const inspector = page.locator('#cms-inspector')
        const design = inspector.getByRole('tab', { name: 'Design', exact: true })
        await design.focus()
        await page.keyboard.press('ArrowRight')
        check(
          (await inspector
            .getByRole('tab', { name: 'Lager', exact: true })
            .getAttribute('aria-selected')) === 'true',
          `${prefix}: tabs support arrow-key selection`,
        )
        await page.keyboard.press('End')
        check(
          (await inspector
            .getByRole('tab', { name: 'Lägg till', exact: true })
            .getAttribute('aria-selected')) === 'true',
          `${prefix}: End selects the last tab`,
        )
        await page.keyboard.press('Home')
        check(
          (await design.getAttribute('aria-selected')) === 'true',
          `${prefix}: Home selects the first tab`,
        )
        if (width <= 900) {
          await inspector.getByRole('button', { name: 'Stäng panel', exact: true }).click()
          check(
            await tools
              .getByRole('button', { name: 'Egenskaper', exact: true })
              .evaluate((node) => node === globalThis.document.activeElement),
            `${prefix}: inspector close restores opener focus`,
          )
          await tools.getByRole('button', { name: 'Sidor', exact: true }).click()
        }
        await page.getByRole('button', { name: 'Business / SEO', exact: true }).click()
        const workspace = page.getByRole('region', { name: 'Företag & sökresultat', exact: true })
        await workspace.waitFor()
        check(
          await page.locator('.cms-editor-wrap').evaluate((node) => node.inert),
          `${prefix}: workspace isolates the mounted canvas`,
        )
        await page.keyboard.press('Escape')
        await workspace.waitFor({ state: 'hidden' })
        check(
          !(await page.locator('.cms-editor-wrap').evaluate((node) => node.inert)),
          `${prefix}: returning from a workspace releases the canvas`,
        )
        check(
          backend.writes.length === 0,
          `${prefix}: navigation never publishes or writes bookings`,
        )
        check(errors.length === 0, `${prefix}: no browser exceptions`, errors)
      } catch (error) {
        failures.push(`${prefix}: ${error.message}`)
        await page
          .screenshot({ path: `${out}/${name}-${width}-failure.png`, animations: 'disabled' })
          .catch(() => undefined)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
await writeFile(`${out}/contracts.json`, JSON.stringify({ results, failures }, null, 2))
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.message}`)
assert.deepEqual(failures, [], `${failures.length} responsive workspace contracts failed`)
