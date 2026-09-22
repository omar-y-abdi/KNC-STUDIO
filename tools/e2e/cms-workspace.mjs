import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-workspace'
await mkdir(out, { recursive: true })
const failures = []
const results = []
const check = (condition, message, details) => {
  results.push({ message, passed: Boolean(condition), ...(details ? { details } : {}) })
  if (!condition) failures.push(message)
}

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== name) continue
  const browser = await engine.launch()
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 900 : 844 },
        reducedMotion: 'reduce',
        colorScheme: 'light',
      })
      context.setDefaultTimeout(10000)
      const backend = await nativeBackend(context)
      const page = await context.newPage()
      const prefix = `${name}/${width}`
      try {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () =>
          (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
        )
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        const frame = page.frameLocator('.gjs-frame').first()
        await frame
          .locator(`[data-knc-surface="${width <= 900 ? 'mobile' : 'desktop'}-home"]`)
          .waitFor()
        await page.screenshot({
          path: `${out}/${name}-${width}-initial.png`,
          animations: 'disabled',
        })
        check(
          await page.locator('.cms-backdrop').isHidden(),
          `${prefix}: a closed drawer never leaves a pointer-blocking backdrop`,
        )
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
        if (width <= 900) {
          const trigger = page
            .locator('.cms-mobile-tools')
            .getByRole('button', { name: 'Sidor', exact: true })
          await trigger.click()
          const library = page.locator('#cms-library')
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
            `${prefix}: page drawer has modal semantics, focus, background isolation and a close control`,
            state,
          )
          await page.keyboard.press('Tab')
          check(
            await library.evaluate((node) => node.contains(globalThis.document.activeElement)),
            `${prefix}: keyboard focus stays in the open drawer`,
          )
          await page.keyboard.press('Escape')
          const closed =
            (await page.locator('.knc-cms-studio').getAttribute('data-library-open')) === 'false'
          check(closed, `${prefix}: Escape dismisses the page drawer`)
          if (!closed) await trigger.click()
          check(
            await trigger.evaluate((node) => node === globalThis.document.activeElement),
            `${prefix}: drawer dismissal restores focus to its opener`,
          )
          await trigger.click()
        }
        const search = page.getByRole('searchbox', { name: 'Sök sidor' })
        await search.fill('no-page-with-this-name')
        check(
          /Ingen sida|Inga sidor/.test(await page.locator('#cms-library').innerText()),
          `${prefix}: empty page search explains the result`,
        )
        await search.fill('')
        if (width <= 900) {
          await page.keyboard.press('Escape')
          await page
            .locator('.cms-mobile-tools')
            .getByRole('button', { name: 'Egenskaper', exact: true })
            .click()
        }
        const design = page.getByRole('tab', { name: 'Design', exact: true })
        await design.focus()
        await page.keyboard.press('ArrowRight')
        check(
          (await page
            .getByRole('tab', { name: 'Lager', exact: true })
            .getAttribute('aria-selected')) === 'true',
          `${prefix}: inspector tabs support arrow-key selection`,
        )
        await page.keyboard.press('Home')
        check(
          (await design.getAttribute('aria-selected')) === 'true',
          `${prefix}: Home returns to the first inspector tab`,
        )
        check(
          backend.writes.length === 0,
          `${prefix}: workspace navigation never publishes or writes bookings`,
        )
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
