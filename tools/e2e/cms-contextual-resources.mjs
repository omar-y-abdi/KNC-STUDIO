import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument } from '../../shared/cms.ts'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-contextual-resources'
await mkdir(out, { recursive: true })
const engine = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
const browser = await { chromium, webkit }[engine].launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
})
context.setDefaultTimeout(10000)
const seed = emptyDocument()
seed.barbers = ['a', 'b', 'c', 'd'].map((id, i) => ({
  id,
  name: `Barber ${id}`,
  ig: id,
  role_sv: 'Frisör',
  role_en: 'Barber',
  bio_sv: 'Presentation',
  bio_en: 'Presentation',
  sort_order: i,
}))
const asset = {
  id: '28000000-0000-4000-8000-000000000001',
  bucket: 'barber-photos',
  path: 'a/new.webp',
  name: 'New portrait A',
  alt: 'Portrait A',
  mime: 'image/webp',
  width: 800,
  height: 800,
  bytes: 200,
  archived: false,
  version: 0,
}
const backend = await nativeBackend(context, seed, [asset])
await context.route('https://admin-harness.invalid/storage/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#dce5d4"/></svg>',
  }),
)
await context.route('https://admin-harness.invalid/functions/v1/cms-studio', (route) => {
  if (route.request().method() === 'OPTIONS') return route.fallback()
  if (route.request().postDataJSON().operation !== 'asset_usage') return route.fallback()
  return route.fulfill({
    headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
    json: { currentReferences: 0, historyReferences: 0 },
  })
})
await context.route('https://admin-harness.invalid/rest/v1/rpc/public_*', async (route) => {
  const headers = {
    'Access-Control-Allow-Origin': new URL(base).origin,
    'Access-Control-Allow-Headers': '*',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  return route.fulfill({
    headers,
    json: {
      settings: {},
      barbers: seed.barbers.map((b) => ({ ...b, active: true, photo_path: null })),
      services: [],
      schedules: [],
    },
  })
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  const frame = page.frameLocator('.gjs-frame').first()
  const portrait = frame
    .locator('[data-knc-fold="barber-marquee"][data-knc-source] > div')
    .first()
    .locator('svg')
    .first()
  await portrait.waitFor({ timeout: 90000 })
  await portrait.dblclick()
  await page.locator('.cms-workspace-resources').waitFor({ timeout: 5000 })
  assert.equal(
    await page.getByRole('combobox', { name: 'Kategori', exact: true }).inputValue(),
    'profile',
  )
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Barberare för profilbild', exact: true })
      .inputValue(),
    'a',
  )
  await page.locator('.cms-resource-card button').filter({ hasText: 'New portrait A' }).click()
  await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
  await frame
    .locator('img[src$="/barber-photos/a/new.webp"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15000 })
  assert.equal(backend.writes.length, 0)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: `${out}/${engine}-contextual-portrait.png` })
  console.log(
    'PASS contextual resource picker: double-click placeholder, scoped person library, draft assignment',
  )
} catch (error) {
  await writeFile(
    `${out}/${engine}-error.json`,
    JSON.stringify(
      { errors, alerts: await page.locator('[role=alert]').allTextContents() },
      null,
      2,
    ),
  )
  await page.screenshot({ path: `${out}/${engine}-failure.png` })
  throw error
} finally {
  await context.close()
  await browser.close()
}
