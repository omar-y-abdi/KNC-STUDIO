import { assetFixture, barberFixture, documentFixture } from './builders.mjs'
import { routeApi } from './route-api.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { nativeBackend } from './cms-backend.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

async function portraitResources(context, evidenceDir) {
  const base = harnessOrigin
  assert.equal(new URL(base).hostname, '127.0.0.1')
  const out = evidenceDir
  await mkdir(out, { recursive: true })
  context.setDefaultTimeout(10000)
  const seed = documentFixture()
  seed.barbers = ['a', 'b', 'c', 'd'].map((id, i) =>
    barberFixture({
      id,
      name: `Barber ${id}`,
      ig: id,
      role_sv: 'Frisör',
      role_en: 'Barber',
      bio_sv: 'Presentation',
      bio_en: 'Presentation',
      sort_order: i,
    }),
  )
  const asset = assetFixture({
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
  })
  const backend = await nativeBackend(context, seed, [asset])
  await context.route('https://admin-harness.invalid/storage/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#dce5d4"/></svg>',
    }),
  )
  await routeApi(context, [
    [
      'https://admin-harness.invalid/functions/v1/cms-studio',
      (route, headers) => {
        if (route.request().postDataJSON().operation !== 'asset_usage') return route.fallback()
        return route.fulfill({
          headers,
          json: { currentReferences: 0, historyReferences: 0 },
        })
      },
    ],
  ])
  await routeApi(context, [
    [
      'https://admin-harness.invalid/rest/v1/rpc/public_*',
      async (route, headers) => {
        return route.fulfill({
          headers,
          json: {
            settings: {},
            barbers: seed.barbers.map((b) => ({ ...b, active: true, photo_path: null })),
            services: [],
            schedules: [],
          },
        })
      },
    ],
  ])
  return { backend, out }
}

test.use({
  viewport: { width: 1440, height: 1000 },
  contextOptions: { reducedMotion: 'reduce' },
})

test('cms-draft-resources', async ({ page, context, browserName, evidenceDir }) => {
  const engine = browserName
  const base = harnessOrigin
  const { backend, out } = await portraitResources(context, evidenceDir)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`${base}/tools/e2e/admin-harness.html`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    const frame = page.frameLocator('.gjs-frame').first()
    await frame
      .locator('[data-knc-fold="barber-marquee"][data-knc-source]')
      .waitFor({ timeout: 90000 })
    await page
      .locator('.cms-library-tabs')
      .getByRole('button', { name: 'Resurser', exact: true })
      .click()
    await page.locator('.cms-resource-card button').filter({ hasText: 'New portrait A' }).click()
    await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
    await page
      .getByText('Tilldelad i utkastet. Publicera för att visa ändringen.', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: 'Tillbaka till sidan', exact: true }).click()
    await frame
      .locator('img[src$="/barber-photos/a/new.webp"]')
      .first()
      .waitFor({ state: 'attached', timeout: 15000 })
    await page.getByRole('button', { name: 'Ångra', exact: true }).click()
    await frame.locator('img[src$="/barber-photos/a/new.webp"]').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Gör om', exact: true }).click()
    await frame
      .locator('img[src$="/barber-photos/a/new.webp"]')
      .first()
      .waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
    await page
      .frameLocator('.cms-live-preview iframe')
      .locator('img[src$="/barber-photos/a/new.webp"]')
      .first()
      .waitFor({ state: 'attached', timeout: 15000 })
    await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
    assert.equal(backend.writes.length, 0, 'Previewing resource assignment never publishes')
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor({ timeout: 15000 })
    assert.equal(backend.document.photos.a, 'a/new.webp')
    await page.reload()
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await frame
      .locator('img[src$="/barber-photos/a/new.webp"]')
      .first()
      .waitFor({ state: 'attached', timeout: 15000 })
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${out}/${engine}-portrait-assigned.png` })
    console.log('PASS draft resources: canvas, undo/redo, isolated preview, publication and reload')
  } catch (error) {
    await writeFile(
      `${out}/${engine}-errors.json`,
      JSON.stringify(
        { errors, alerts: await page.locator('[role=alert]').allTextContents() },
        null,
        2,
      ),
    )
    await page.screenshot({ path: `${out}/${engine}-failure.png` })
    throw error
  }
})

test('cms-contextual-resources', async ({ page, context, browserName, evidenceDir }) => {
  const engine = browserName
  const base = harnessOrigin
  const { backend, out } = await portraitResources(context, evidenceDir)
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
    await portrait.locator('..').dblclick({ position: { x: 10, y: 10 } })
    await page.locator('.cms-workspace-resources').waitFor({ timeout: 5000 })
    assert.equal(
      await page
        .getByRole('combobox', { name: 'Barberare för profilbild', exact: true })
        .inputValue(),
      'a',
    )
    await page.getByRole('button', { name: 'Tillbaka till sidan', exact: true }).click()
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
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        globalThis.HTMLIFrameElement.prototype,
        'contentDocument',
      )
      if (!descriptor?.get) throw new Error('Missing native iframe document getter')
      let reads = 0
      Object.defineProperty(globalThis.HTMLIFrameElement.prototype, 'contentDocument', {
        configurable: true,
        get() {
          const value = descriptor.get.call(this)
          if (this.title === 'Uppdaterar resurser i utkastet' && value && reads++ < 2)
            return new Proxy(value, {
              get(target, property) {
                return property === 'documentElement' ? null : Reflect.get(target, property, target)
              },
            })
          return value
        },
      })
    })
    await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
    await frame
      .locator('img[src$="/barber-photos/a/new.webp"]')
      .first()
      .waitFor({ state: 'attached', timeout: 15000 })
    assert.equal(backend.writes.length, 0)
    const logo = frame.locator('svg[viewBox="0 0 460 330"],svg[viewBox="0 0 460 258"]').first()
    await logo.waitFor({ state: 'visible', timeout: 15000 })
    await logo.dblclick()
    await page.locator('.cms-workspace-resources').waitFor({ timeout: 5000 })
    assert.equal(
      await page.getByRole('combobox', { name: 'Kategori', exact: true }).inputValue(),
      'logo',
      'double-clicking the real native logo opens the logo resource destination',
    )
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${out}/${engine}-contextual-logo.png` })
    await page.getByRole('button', { name: 'Tillbaka till sidan', exact: true }).click()
    for (const [id, alt] of [
      ['owner-phone', 'Telefon'],
      ['owner-decoration', ''],
    ]) {
      await page.evaluate(
        async ({ id, alt }) => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const editor = cmsGrapes.editors.at(-1)
          const surface = editor.getWrapper().find('[data-knc-surface="desktop-home"]')[0]
          if (!surface) throw new Error('Missing editable Home surface')
          surface.append(
            {
              type: 'image',
              attributes: { id, src: '/icons/phone.svg', alt },
              style: { display: 'block', width: '48px', height: '48px', margin: '80px 32px 24px' },
            },
            { at: 0 },
          )
        },
        { id, alt },
      )
      const image = frame.locator(`#${id}`)
      await image.dblclick()
      const picker = page.getByRole('dialog', { name: 'Välj bild', exact: true })
      await picker.getByRole('button').filter({ hasText: 'New portrait A' }).click()
      await picker.waitFor({ state: 'hidden' })
      assert.equal(
        await image.getAttribute('alt'),
        alt,
        'A visual swap preserves explicit alt, including decoration',
      )
      assert.match(await image.getAttribute('src'), /\/barber-photos\/a\/new.webp$/)
      // A reused portrait file remains an ordinary placement, not a barber assignment.
      await image.dblclick()
      await picker.waitFor()
      await picker.getByRole('button', { name: 'Stäng panel', exact: true }).click()
    }
    assert.equal(backend.writes.length, 0, 'Contextual graphic swaps remain draft-only')
    assert.deepEqual(errors, [])
    console.log(
      'PASS contextual resources: placeholder portrait and native logo route to scoped libraries',
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
  }
})
