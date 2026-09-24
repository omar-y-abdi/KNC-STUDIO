import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/knc-resource-workflow'
await mkdir(out, { recursive: true })
const engine = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
const browser = await { chromium, webkit }[engine].launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(5000)
const snapshot = () =>
  page.evaluate(async () => (await import('/tools/e2e/cms-resources-harness.tsx')).snapshot())
// No test request may escape to production if local environment configuration drifts.
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.origin === new URL(base).origin) return route.fallback()
  if (url.hostname === 'admin-harness.invalid' && url.pathname.startsWith('/storage/'))
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#dce5d4"/><text x="20" y="100">Test image</text></svg>',
    })
  if (url.hostname === 'admin-harness.invalid') return route.fallback()
  console.error('Blocked unexpected test destination:', url.origin, url.pathname)
  return route.abort()
})
page.on('requestfailed', (request) =>
  console.error('Request failure:', new URL(request.url()).pathname, request.failure()?.errorText),
)
await page.route('https://admin-harness.invalid/functions/v1/**', async (route) => {
  const request = route.request()
  const headers = {
    'access-control-allow-origin': new URL(base).origin,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST,OPTIONS',
  }
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const body = request.postData() ?? ''
  const asset = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'New cut.webp',
    bucket: 'gallery',
    path: 'cuts/uploaded.webp',
    alt: '',
    mime: 'image/webp',
    width: 200,
    height: 200,
    bytes: 100,
    archived: false,
    version: 0,
  }
  if (request.url().endsWith('/upload-image')) {
    assert.match(body, /name="purpose"\r\n\r\ncuts/)
    return route.fulfill({ headers, json: { ok: true, asset } })
  }
  const operation = JSON.parse(body)
  if (operation.operation === 'asset_usage')
    return route.fulfill({ headers, json: { currentReferences: 0, historyReferences: 0 } })
  assert.equal(operation.operation, 'asset_copy')
  assert.equal(operation.id, '22222222-2222-4222-8222-222222222222')
  return route.fulfill({
    headers,
    json: {
      ...asset,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Bank',
      path: `${operation.purpose}/copy.webp`,
    },
  })
})
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { mountResources } = await import('/tools/e2e/cms-resources-harness.tsx')
    const doc = emptyDocument()
    doc.barbers = ['a', 'b'].map((id) => ({
      id,
      name: `Barber ${id}`,
      ig: '',
      role_sv: '',
      role_en: '',
      bio_sv: '',
      bio_en: '',
      sort_order: 0,
    }))
    const rows = [
      ['salon', 'gallery', 'salon/one.webp'],
      ['cuts', 'gallery', 'cuts/one.webp'],
      ['Bank', 'cms-library', 'images/bank.webp'],
      ['Portrait A', 'barber-photos', 'a/photo.webp'],
      ['Portrait B', 'barber-photos', 'b/photo.webp'],
    ].map(([name, bucket, path], index) => ({
      id: `22222222-2222-4222-8222-22222222222${index}`,
      bucket,
      path,
      name,
      alt: '',
      mime: 'image/webp',
      bytes: 100,
      width: 200,
      height: 200,
      archived: false,
      version: 0,
    }))
    mountResources(rows, doc)
  })
  const category = page.getByRole('combobox', { name: 'Kategori', exact: true })
  await category.selectOption('salon')
  assert.equal(await page.locator('.cms-resource-card').count(), 1)
  await category.selectOption('profile')
  await page
    .getByRole('combobox', { name: 'Barberare för profilbild', exact: true })
    .selectOption('b')
  await page.locator('.cms-resource-card button').filter({ hasText: 'Portrait B' }).waitFor()
  assert.equal(await page.locator('.cms-resource-card').count(), 1)
  await page.getByRole('button', { name: 'Ladda upp', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ladda upp resurs', exact: true })
  await dialog.getByRole('combobox', { name: 'Placera i', exact: true }).selectOption('cuts')
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'New cut.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from('intercepted fixture'),
  })
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await snapshot()).document.gallery[0]?.storage_path, 'cuts/uploaded.webp')
  await category.selectOption('library')
  await page.locator('.cms-resource-card button').filter({ hasText: 'Bank' }).click()
  await page.getByRole('combobox', { name: 'Använd på', exact: true }).selectOption('salon')
  await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
  await page.waitForFunction(async () =>
    (await import('/tools/e2e/cms-resources-harness.tsx'))
      .snapshot()
      .document.gallery.some((row) => row.storage_path === 'salon/copy.webp'),
  )
  await category.selectOption('salon')
  await page.locator('.cms-resource-card button').filter({ hasText: 'Bank' }).click()
  await page.getByRole('button', { name: 'Dölj från sidan', exact: true }).click()
  assert.equal(
    (await snapshot()).document.gallery.some((row) => row.storage_path === 'salon/copy.webp'),
    false,
  )
  await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
  assert.equal(
    (await snapshot()).document.gallery.filter((row) => row.storage_path === 'salon/copy.webp')
      .length,
    1,
  )
  assert.equal((await snapshot()).assets.filter((row) => row.path === 'salon/copy.webp').length, 1)
  await page.screenshot({ path: `${out}/${engine}-resources.png` })
  await page.setViewportSize({ width: 390, height: 740 })
  await page.screenshot({ path: `${out}/${engine}-resource-mobile.png` })
  assert.equal((await snapshot()).error, '')
  console.log(
    'PASS resource workflow: filters, upload destination, assignment, cross-scope reuse, hide/reactivate',
  )
} catch (error) {
  console.error(await page.locator('[role=alert], [data-review-error]').allTextContents())
  await page.screenshot({ path: `${out}/${engine}-failure.png` })
  throw error
} finally {
  await browser.close()
}
