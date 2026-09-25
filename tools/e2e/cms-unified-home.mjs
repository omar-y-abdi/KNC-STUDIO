import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

// Isolated localhost fixture only: never visit the production admin or use its login.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const engine = process.env.CMS_ENGINE === 'webkit' ? webkit : chromium
const browser = await engine.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const backend = await nativeBackend(context)
context.setDefaultTimeout(15000)
const page = await context.newPage()
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  const frame = page.frameLocator('.gjs-frame').first()
  await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
  const about = frame.locator('[data-knc-surface="desktop-home"] [data-knc-surface="about"]')
  assert.equal(await about.count(), 1, 'Home must contain the editable canonical About surface')
  assert.equal(
    await page
      .locator('.cms-page-list')
      .getByRole('button', { name: 'Om oss', exact: true })
      .count(),
    0,
    'No duplicate editor destination',
  )
  const heading = about.locator('h2').first()
  const originalHeading = (await heading.textContent()) ?? ''
  await heading.click()
  await page.waitForFunction(
    async (expected) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const selected = cmsGrapes.editors.at(-1)?.getSelected()?.getEl()
      return selected?.textContent?.trim() === expected
    },
    originalHeading.trim(),
    { timeout: 5000 },
  )
  await page
    .locator('#cms-inspector')
    .getByRole('textbox', { name: 'Text', exact: true })
    .fill('Sammanhängande redigering')
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await about.locator('h2').first().getByText(originalHeading, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Gör om', exact: true }).click()
  await about.getByText('Sammanhängande redigering', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  assert.equal(
    await frame
      .locator('[data-knc-surface="desktop-home"] [data-knc-surface="about"]')
      .getByText('Sammanhängande redigering', { exact: true })
      .count(),
    0,
    'Swedish About edits must not overwrite the English variant',
  )
  await page.getByRole('button', { name: 'SV', exact: true }).click()
  await about.getByText('Sammanhängande redigering', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await frame
    .locator('[data-knc-surface="mobile-home"] [data-knc-surface="about"]')
    .getByText('Sammanhängande redigering', { exact: true })
    .waitFor()
  // nativeBackend intercepts this entire transaction and performs validation in memory.
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
  assert.match(
    backend.document.presentation.pages.find((item) => item.path === '/about').content.sv.html,
    /Sammanhängande redigering/,
  )
  assert.ok(
    !JSON.stringify(backend.document).includes('data-editor-about-slot'),
    'Composition markers never enter saved content',
  )
  await page.reload()
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await frame
    .getByText('Sammanhängande redigering', { exact: true })
    .first()
    .waitFor({ timeout: 30000 })
  console.log(
    'PASS unified Home: canonical ownership, inline edit, device switch, validation, save and reload',
  )
} finally {
  await context.close()
  await browser.close()
}
