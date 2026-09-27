import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/knc-new-page'
await mkdir(out, { recursive: true })
const name = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
const browser = await { chromium, webkit }[name].launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
context.setDefaultTimeout(10000)
const backend = await nativeBackend(context)
const page = await context.newPage()
try {
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
  assert.ok(mobile.header.height <= 160, 'Header must not consume a disproportionate phone height')
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
  await page.locator('.cms-page-list').getByRole('button', { name: 'Ny sida', exact: true }).click()
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  assert.equal((await measure()).phoneWhiteSpace, 'nowrap')
  console.log('PASS new-page mobile chrome: bounded logo, contact, viewport fit and saved layout')
} finally {
  await context.close()
  await browser.close()
}
