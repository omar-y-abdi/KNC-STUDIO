import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-preview'
await mkdir(out, { recursive: true })
for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  const browser = await engine.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    context.setDefaultTimeout(30000)
    const backend = await nativeBackend(context)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let requested = false
    await context.route('**/cms-public/source?preview=1', async (route) => {
      requested = true
      await gate
      await route.fallback()
    })
    const page = await context.newPage()
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page
      .frameLocator('.gjs-frame')
      .first()
      .getByText('KNC source sv', { exact: true })
      .first()
      .waitFor()
    await page.getByRole('button', { name: '◐ Webbplatsens stil', exact: true }).click()
    const host = page.locator('.cms-live-preview')
    await host.waitFor()
    await page.screenshot({ path: `${out}/${name}-preview-loading.png` })
    assert.equal(
      await host.getAttribute('data-preview-state'),
      'loading',
      'Preview must expose loading before the iframe response',
    )
    assert.equal(await host.getAttribute('aria-busy'), 'true')
    assert.equal(await host.getByRole('status').innerText(), 'Förhandsvisningen laddas…')
    release()
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('.cms-live-preview')?.dataset.previewState === 'ready',
    )
    assert.ok(requested, 'Readiness must follow a real source request')
    const preview = page.frameLocator('iframe[title="Förhandsvisning av sidan"]')
    const readyId = await preview.locator('html').getAttribute('data-knc-source-ready')
    assert.ok(readyId)
    await page.screenshot({ path: `${out}/${name}-preview-ready.png` })
    await preview.locator('html').evaluate((root) => {
      root.dataset.kncSourceError = 'obsolete-context'
    })
    assert.equal(
      await host.getAttribute('data-preview-state'),
      'ready',
      'Stale contexts cannot fail the current preview',
    )
    await preview.locator('html').evaluate((root, id) => {
      root.dataset.kncSourceError = id
    }, readyId)
    await host.getByRole('alert').waitFor()
    assert.equal(await host.getAttribute('aria-busy'), 'false')
    await page.screenshot({ path: `${out}/${name}-preview-error.png` })
    await host.getByRole('button', { name: 'Försök igen', exact: true }).click()
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('.cms-live-preview')?.dataset.previewState === 'ready',
    )
    assert.notEqual(
      await preview.locator('html').getAttribute('data-knc-source-ready'),
      readyId,
      'Retry must establish a fresh context',
    )
    await page.screenshot({ path: `${out}/${name}-preview-recovered.png` })
    assert.equal(
      backend.writes.length,
      0,
      'Preview loading and retry must not publish or write bookings',
    )
    console.log(
      `PASS ${name}: preview loading, real readiness, stale error isolation, failure and retry`,
    )
    await context.close()
  } finally {
    await browser.close()
  }
}
