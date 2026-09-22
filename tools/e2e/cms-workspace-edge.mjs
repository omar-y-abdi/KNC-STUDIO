import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-workspace-edge'
await mkdir(out, { recursive: true })
const checks = []
const failures = []
const assets = ['Originalbild', 'Arkiverad bild'].map((name, i) => ({
  id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}`,
  bucket: 'cms-library',
  path: `images/example-${i}.webp`,
  name,
  alt: name,
  mime: 'image/webp',
  bytes: 1024,
  width: 1200,
  height: 630,
  archived: i === 1,
  trashed_at: null,
  version: 1,
}))
const check = (pass, message, details) => {
  checks.push({ passed: Boolean(pass), message, details })
  if (!pass) failures.push(message)
}
for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== name) continue
  const browser = await engine.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  context.setDefaultTimeout(12000)
  const backend = await nativeBackend(context, emptyDocument(), assets)
  await context.route('**/functions/v1/cms-studio', (route) => {
    if (route.request().postDataJSON().operation === 'asset_usage')
      return route.fulfill({
        headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
        json: { currentReferences: 0, historyReferences: 0 },
      })
    return route.fallback()
  })
  await context.route('**/storage/v1/object/public/**', (route) =>
    route.fulfill({ contentType: 'image/png', path: 'public/og-image.png' }),
  )
  const page = await context.newPage()
  page.on('pageerror', (error) => failures.push(`${name}: ${error.message}`))
  const shot = (state) =>
    page.screenshot({ path: `${out}/${name}-edge-${state}.png`, animations: 'disabled' })
  const run = async (label, action) => {
    try {
      await action()
    } catch (error) {
      failures.push(`${name}/${label}: ${error.message}`)
      await shot(`${label}-failure`).catch(() => {})
    }
  }
  try {
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await run('contrast', async () => {
      await frame.getByText('KNC source sv', { exact: true }).first().click()
      const field = page.locator('.gjs-sm-property__width input').first()
      await field.waitFor()
      const contrast = await field.evaluate((node) => {
        const rgba = (color) => {
          const values = color.match(/[\d.]+/g).map(Number)
          return [values[0], values[1], values[2], values[3] ?? 1]
        }
        const over = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]))
        const chain = []
        for (let el = node; el; el = el.parentElement) chain.unshift(el)
        let bg = [255, 255, 255]
        for (const el of chain) bg = over(rgba(globalThis.getComputedStyle(el).backgroundColor), bg)
        const color = rgba(globalThis.getComputedStyle(node).color)
        const fg = over(color, bg)
        const luminance = (rgb) =>
          rgb
            .map((v) => {
              const n = v / 255
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
        return {
          color,
          weight: globalThis.getComputedStyle(node).fontWeight,
          background: bg,
          ratio: (values[0] + 0.05) / (values[1] + 0.05),
        }
      })
      check(
        contrast.ratio >= 4.5,
        `${name}: generated property values are readable on the light inspector`,
        contrast,
      )
      check(
        Number(contrast.weight) >= 400,
        `${name}: property values use a readable body weight`,
        contrast,
      )
      await shot('inspector-contrast')
    })
    await run('resources', async () => {
      await page.getByRole('button', { name: 'Resurser', exact: true }).click()
      await page.locator('.cms-resource-card button').first().click()
      await page.getByRole('heading', { name: assets[0].name, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Arkiverade', exact: true }).click()
      check(
        (await page.getByRole('heading', { name: assets[0].name, exact: true }).count()) === 0,
        `${name}: switching resource collections clears stale detail actions`,
      )
      check(
        (await page.getByRole('button', { name: 'Radera permanent', exact: true }).count()) === 0,
        `${name}: switching collections never offers deletion for the previous active asset`,
      )
      await page.locator('.cms-resource-card button').first().click()
      await page.getByRole('heading', { name: assets[1].name, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Papperskorg', exact: true }).click()
      check(
        (await page.getByRole('button', { name: 'Radera permanent', exact: true }).count()) === 0,
        `${name}: an empty trash collection cannot delete an archived selection`,
      )
      await shot('resource-empty-trash')
      await page.getByRole('button', { name: 'Tillbaka till sidan', exact: false }).click()
    })
    await run('preview', async () => {
      let release
      await context.route(
        '**/cms-public/source?preview=1',
        (route) =>
          new Promise((resolve) => {
            release = async () => {
              await route.fallback()
              resolve()
            }
          }),
      )
      await page.getByRole('button', { name: '◐ Webbplatsens stil', exact: true }).click()
      await page.locator('.cms-live-preview iframe').waitFor({ state: 'attached' })
      // A deliberately withheld document must produce feedback, not a blank preview.
      check(
        (await page.locator('.cms-live-preview').getByRole('status').count()) === 1,
        `${name}: the native preview has an explicit loading state`,
      )
      await page.evaluate(() =>
        globalThis.window.dispatchEvent(
          new globalThis.MessageEvent('message', {
            origin: globalThis.location.origin,
            source: globalThis.window,
            data: { type: 'knc-preview-ready', id: 'stale-context' },
          }),
        ),
      )
      check(
        (await page.locator('.cms-live-preview').getByRole('status').count()) === 1,
        `${name}: unrelated readiness messages cannot acknowledge the preview`,
      )
      await shot('preview-loading')
      await page.waitForFunction(() =>
        Boolean(globalThis.document.querySelector('.cms-live-preview iframe')),
      )
      for (let attempt = 0; !release && attempt < 100; attempt++) await page.waitForTimeout(50)
      assert.ok(release, 'The fixture must intercept the native preview document')
      await release()
      const preview = page.frameLocator('.cms-live-preview iframe')
      await preview.locator('html[data-knc-source-ready]').waitFor({ timeout: 30000 })
      await preview
        .locator('svg text')
        .filter({ hasText: /^STUDIO$/ })
        .first()
        .waitFor()
      await page.locator('.cms-live-preview[aria-busy="false"]').waitFor()
      check(
        (await page.locator('.cms-live-preview').getByRole('status').count()) === 0,
        `${name}: the actual native response ends the loading state`,
      )
      await preview.locator('body').evaluate(() =>
        globalThis.window.parent.postMessage(
          {
            type: 'knc-preview-error',
            id: 'stale-context',
          },
          globalThis.location.origin,
        ),
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
          ),
      )
      check(
        (await page.locator('.cms-live-preview').getByRole('alert').count()) === 0,
        `${name}: an obsolete native render cannot replace the current preview with an error`,
      )
      await shot('preview-ready')
      await page.getByRole('button', { name: 'Tillbaka till sidan', exact: false }).click()
      await context.unroute('**/cms-public/source?preview=1')
    })
    await run('preview-retry', async () => {
      await context.route('**/cms-public/source?preview=1', (route) => route.abort())
      await page.getByRole('button', { name: '◐ Webbplatsens stil', exact: true }).click()
      const preview = page.locator('.cms-live-preview')
      await preview.getByRole('alert').waitFor({ timeout: 26000 })
      await shot('preview-network-error')
      await context.unroute('**/cms-public/source?preview=1')
      await preview.getByRole('button', { name: 'Försök igen', exact: true }).click()
      await preview
        .locator('iframe')
        .contentFrame()
        .locator('html[data-knc-source-ready]')
        .waitFor({ timeout: 30000 })
      await page.locator('.cms-live-preview[aria-busy="false"]').waitFor()
      check(
        (await preview.getByRole('alert').count()) === 0,
        `${name}: retry recovers a frame that failed to boot`,
      )
      await shot('preview-recovered')
      await page.getByRole('button', { name: 'Tillbaka till sidan', exact: false }).click()
    })
    await run('first-revert', async () => {
      assert.equal(
        backend.document.presentation.pages.length,
        0,
        'This is a genuinely unpublished first-run fixture',
      )
      await page.getByRole('button', { name: 'Revert', exact: true }).click()
      check(
        await page.locator('.cms-canvas-shell').isVisible(),
        `${name}: reverting an unpublished first draft keeps the real website editable`,
      )
      await page.getByRole('button', { name: 'Resurser', exact: true }).click()
      await page.getByRole('heading', { name: 'Bilder & typsnitt', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Tillbaka till sidan', exact: false }).click()
      await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
      await shot('first-revert')
      check(
        backend.writes.length === 0,
        `${name}: inspection and discard never publish or write bookings`,
      )
    })
  } finally {
    await browser.close()
  }
}
await writeFile(`${out}/edge.json`, JSON.stringify({ checks, failures }, null, 2))
console.log(JSON.stringify({ checks, failures }, null, 2))
assert.deepEqual(failures, [], 'Workspace edge contracts')
