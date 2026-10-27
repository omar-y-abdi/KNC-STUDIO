import { assetFixture } from './builders.mjs'
import { routeApi } from './route-api.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

async function resourceHarness(page, evidenceDir) {
  const base = harnessOrigin
  assert.equal(new URL(base).hostname, '127.0.0.1')
  const out = evidenceDir
  await mkdir(out, { recursive: true })
  page.setDefaultTimeout(5000)
  const snapshot = () =>
    page.evaluate(async () => (await import('/tools/e2e/cms-resources-harness.tsx')).snapshot())
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
    console.error(
      'Request failure:',
      new URL(request.url()).pathname,
      request.failure()?.errorText,
    ),
  )
  return { base, out, snapshot }
}

test.use({ viewport: { width: 1440, height: 1000 } })

test('cms-resource-workflow', async ({ page, browserName, evidenceDir }) => {
  const engine = browserName
  const { base, out, snapshot } = await resourceHarness(page, evidenceDir)
  let uploaded = 0
  let failUploadAt = 0
  await routeApi(page, [
    [
      'https://admin-harness.invalid/functions/v1/**',
      async (route, headers) => {
        const request = route.request()

        const body = request.postData() ?? ''
        const asset = assetFixture({
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
        })
        if (request.url().endsWith('/upload-image')) {
          assert.match(body, /name="purpose"\r\n\r\ncuts/)
          uploaded++
          if (uploaded === failUploadAt)
            return route.fulfill({
              status: 503,
              headers,
              json: { message: 'Fixture upload failed' },
            })
          return route.fulfill({
            headers,
            json: {
              ok: true,
              asset:
                uploaded === 1
                  ? asset
                  : {
                      ...asset,
                      id: `33333333-3333-4333-8333-${String(uploaded).padStart(12, '0')}`,
                      name: `Upload ${uploaded}.webp`,
                      path: `cuts/uploaded-${uploaded}.webp`,
                    },
            },
          })
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
      },
    ],
  ])
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
    const updates = () =>
      page.evaluate(async () =>
        (await import('/tools/e2e/cms-resources-harness.tsx')).resourceDocumentUpdates(),
      )
    const startUploads = async (count) => {
      await page.getByRole('button', { name: 'Ladda upp', exact: true }).click()
      await dialog.getByRole('combobox', { name: 'Placera i', exact: true }).selectOption('cuts')
      await dialog.locator('input[type=file]').setInputFiles(
        Array.from({ length: count }, (_, i) => ({
          name: `Batch ${i}.webp`,
          mimeType: 'image/webp',
          buffer: Buffer.from('intercepted fixture'),
        })),
      )
    }
    const beforeBatch = await updates()
    await startUploads(2)
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(
      (await updates()) - beforeBatch,
      1,
      'One upload batch must trigger one draft/preview transaction',
    )
    assert.ok(
      (await snapshot()).document.gallery.some(
        (row) => row.storage_path === 'cuts/uploaded-2.webp',
      ),
    )
    assert.ok(
      (await snapshot()).document.gallery.some(
        (row) => row.storage_path === 'cuts/uploaded-3.webp',
      ),
    )
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
    assert.equal(
      (await snapshot()).assets.filter((row) => row.path === 'salon/copy.webp').length,
      1,
    )
    await page.screenshot({ path: `${out}/${engine}-resources.png` })
    assert.equal((await snapshot()).error, '')
    const beforePartial = await updates()
    failUploadAt = uploaded + 2
    await startUploads(3)
    await dialog.getByRole('alert').waitFor()
    assert.equal(uploaded, failUploadAt)
    assert.equal((await updates()) - beforePartial, 1)
    assert.ok(
      (await snapshot()).document.gallery.some(
        (row) => row.storage_path === 'cuts/uploaded-4.webp',
      ),
    )
    assert.ok((await snapshot()).assets.some((row) => row.path === 'cuts/uploaded-4.webp'))
    await page.setViewportSize({ width: 390, height: 740 })
    await page.screenshot({ path: `${out}/${engine}-resource-mobile.png` })
    assert.equal((await snapshot()).error, 'Fixture upload failed')
    console.log(
      'PASS resource workflow: filters, upload destination, assignment, upload batching/partial failure, cross-scope reuse, hide/reactivate',
    )
  } catch (error) {
    console.error(await page.locator('[role=alert], [data-review-error]').allTextContents())
    await page.screenshot({ path: `${out}/${engine}-failure.png` })
    throw error
  }
})

test('cms-site-resources', async ({ page, browserName, evidenceDir }) => {
  const engine = browserName
  const { base, out, snapshot } = await resourceHarness(page, evidenceDir)
  await routeApi(page, [
    [
      'https://admin-harness.invalid/functions/v1/**',
      async (route, headers) => {
        const request = route.request()

        const body = request.postData() ?? ''
        const asset = assetFixture({
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
        })
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
      },
    ],
  ])
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { mountResources } = await import('/tools/e2e/cms-resources-harness.tsx')
    const doc = emptyDocument()
    doc.settings.business_phone_display = '079-000 00 00'
    doc.settings.business_phone_tel = '+46790000000'
    doc.settings.business_maps_href = 'https://maps.google.com/?q=Studio'
    const html =
      '<div data-knc-native="1"><header><svg id="brand" data-knc-source="brand" role="img" aria-label="Hörnlogotyp" viewBox="0 0 100 30"><text x="5" y="20">BNB</text></svg><button id="language" data-knc-source="language" data-knc-required="true" aria-label="Byt språk till engelska"><span>SV</span><span>EN</span></button><a href="tel:+46790000000"><img id="phone-icon" data-knc-source="phone-icon" src="/icons/phone.svg" alt="Telefon" /></a></header></div>'
    doc.presentation.pages = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        path: '/',
        kind: 'page',
        name: { sv: 'Startsida', en: 'Home' },
        title: { sv: '', en: '' },
        description: { sv: '', en: '' },
        inMenu: true,
        content: {
          sv: { html, css: { light: '', dark: '' } },
          en: { html, css: { light: '', dark: '' } },
        },
      },
    ]
    mountResources(
      [
        {
          id: '22222222-2222-4222-8222-222222222222',
          bucket: 'cms-library',
          path: 'images/new.webp',
          name: 'Replacement',
          alt: 'New icon',
          mime: 'image/webp',
          width: 100,
          height: 100,
          bytes: 100,
          archived: false,
          version: 0,
        },
      ],
      doc,
    )
  })
  await page.getByRole('button', { name: 'Webbplatsens resurser', exact: true }).click()
  await page.getByRole('button', { name: 'Hörnlogotyp · Startsida', exact: true }).click()
  await page.getByRole('textbox', { name: 'Logotyptext 1', exact: true }).fill('OWN')
  await page.getByRole('button', { name: 'Spara komponent', exact: true }).click()
  assert.match((await snapshot()).document.presentation.pages[0].content.sv.html, />OWN<\/text>/)
  await page
    .getByRole('button', { name: 'Byt språk till engelska · Startsida', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Beskrivning', exact: true }).fill('Välj språk')
  await page.getByRole('button', { name: 'Spara komponent', exact: true }).click()
  assert.match(
    (await snapshot()).document.presentation.pages[0].content.sv.html,
    /data-knc-required="true"/,
  )
  await page.getByRole('button', { name: 'Telefon · Startsida', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Ersätt med bild', exact: true })
    .selectOption('22222222-2222-4222-8222-222222222222')
  await page.getByRole('button', { name: 'Ersätt komponentbild', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Beskrivning', exact: true }).inputValue(),
    'Telefon',
    'replacing a phone icon preserves the functional control label',
  )
  const result = await snapshot()
  for (const lang of ['sv', 'en']) {
    assert.match(
      result.document.presentation.pages[0].content[lang].html,
      /\/cms-library\/images\/new.webp/,
    )
    assert.match(
      result.document.presentation.pages[0].content[lang].html,
      /alt="Telefon"/,
      'visual replacement preserves the existing icon meaning',
    )
  }
  assert.equal(result.error, '')
  await page.getByText('Kontakt & karta', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('079-111 22 33')
  await page.evaluate(async () =>
    (await import('/tools/e2e/cms-resources-harness.tsx')).changeBusinessName(
      'Concurrent business edit',
    ),
  )
  await page.getByRole('button', { name: 'Spara kontaktuppgifter', exact: true }).click()
  const updated = await snapshot()
  assert.equal(updated.document.settings.business_phone_display, '079-111 22 33')
  assert.equal(updated.document.settings.business_name, 'Concurrent business edit')
  await page.screenshot({ path: `${out}/${engine}-site-components.png` })
  await page.setViewportSize({ width: 390, height: 740 })
  await page.screenshot({ path: `${out}/${engine}-site-components-mobile.png` })
  console.log(
    'PASS site resources: existing logo, SVG text, language control and safe icon replacement',
  )
})
