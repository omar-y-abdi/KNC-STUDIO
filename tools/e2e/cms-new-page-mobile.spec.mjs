import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { nativeBackend } from './cms-backend.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
test.describe('new page', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('cms-new-page-mobile', async ({ page, context, evidenceDir }) => {
    const base = harnessOrigin
    assert.equal(new URL(base).hostname, '127.0.0.1')
    const out = evidenceDir
    await mkdir(out, { recursive: true })
    const name = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
    context.setDefaultTimeout(10000)
    const backend = await nativeBackend(context)
    await page.goto(`${base}/tools/e2e/admin-harness.html`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Ny sida' })
      .getByRole('button', { name: 'Skapa sida', exact: true })
      .click()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.locator('#cms-site-header').waitFor()
    const measure = () =>
      frame.locator('#cms-site-header').evaluate((node) => {
        const rect = (element) => {
          const r = element.getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          }
        }
        const phone = node.querySelector('a[href^="tel:"]')
        const brand = node.querySelector('svg')
        return {
          header: rect(node),
          phone: phone ? rect(phone) : null,
          brand: brand ? rect(brand) : null,
          overflow: node.scrollWidth > node.clientWidth + 1,
          phoneWhiteSpace: phone ? globalThis.getComputedStyle(phone).whiteSpace : null,
        }
      })
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
    )
    const mobile = await measure()
    await writeFile(`${out}/${name}-geometry.json`, JSON.stringify(mobile, null, 2))
    await page.screenshot({ path: `${out}/${name}-new-page.png` })
    assert.equal(mobile.overflow, false, 'Mobile header must not overflow')
    assert.equal(mobile.phoneWhiteSpace, 'nowrap', 'The phone number must not wrap across lines')
    assert.ok(
      mobile.brand && mobile.brand.width <= 240 && mobile.brand.height <= 44,
      'Brand must have a bounded phone size',
    )
    assert.ok(
      mobile.header.height <= 160,
      'Header must not consume a disproportionate phone height',
    )
    await page.getByRole('button', { name: 'Dator', exact: true }).click()
    await frame.locator('#cms-site-header').waitFor()
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 1440,
    )
    const desktop = await measure()
    assert.equal(desktop.overflow, false)
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
    const saved = backend.document.presentation.pages.find((item) => item.path === '/hemsida')
    assert.equal(saved.layout, 'independent')
    await page.reload()
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page
      .locator('.cms-page-list')
      .getByRole('button', { name: 'Ny sida', exact: true })
      .click()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
    )
    assert.equal((await measure()).phoneWhiteSpace, 'nowrap')
    console.log('PASS new-page mobile chrome: bounded logo, contact, viewport fit and saved layout')
  })
})
test.describe('canonical Home', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('cms-unified-home', async ({ page, context }) => {
    const base = harnessOrigin
    assert.equal(new URL(base).hostname, '127.0.0.1')
    const backend = await nativeBackend(context)
    context.setDefaultTimeout(15000)
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
  })
})
