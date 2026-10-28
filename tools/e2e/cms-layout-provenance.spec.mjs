import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { emptyDocument } from '../../shared/cms.ts'
import { assetFixture, barberFixture } from './builders.mjs'
import { nativeBackend } from './cms-backend.mjs'
import { loadWorker } from './cms-render.mjs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { routeApi } from './route-api.mjs'

test.use({ viewport: { width: 1440, height: 1000 } })

let renderer
test.beforeAll(async () => {
  renderer = await loadWorker()
})
test.afterAll(async () => {
  await renderer?.close()
})

async function openStudio(page) {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page
    .frameLocator('.gjs-frame')
    .first()
    .locator('[data-knc-surface="desktop-home"]')
    .waitFor({ timeout: 90000 })
}

const aboutHtml = (document) =>
  document.presentation.pages.find((item) => item.path === '/about').content.sv.html
const publications = (backend) => backend.writes.filter((write) => write === 'publish').length

async function publish(page) {
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/, { timeout: 45000 })
}

// Fail only the real capture iframe's source load; the editor and backend keep running.
async function captureGate(context) {
  let blocked = false
  let attempts = 0
  await context.route('**/cms-public/source?preview=1', async (route) => {
    attempts++
    if (blocked) await route.abort()
    else await route.fallback()
  })
  return {
    block: () => (blocked = true),
    allow: () => (blocked = false),
    attempts: () => attempts,
  }
}

async function publicAbout(newContext, document, evidenceDir) {
  const context = await newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const html = renderer.worker.renderCmsPage(
    await readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    document.presentation.pages.find((item) => item.path === '/about'),
    'sv',
    'light',
    `${harnessOrigin}/about`,
    '',
    document.presentation,
  )
  await page.route(`${harnessOrigin}/about?*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  )
  await context.route('https://admin-harness.invalid/storage/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
    }),
  )
  await page.goto(`${harnessOrigin}/about?lang=sv&mode=light`)
  await page.screenshot({ path: `${evidenceDir}/public-about.png`, fullPage: true })
  return page
}

test('cms-layout provenance survives failed capture, publish and Undo', async ({
  page,
  context,
  newContext,
  evidenceDir,
}) => {
  const image = assetFixture({
    id: '7c000000-0000-4000-8000-000000000001',
    bucket: 'gallery',
    path: 'salon/provenance.webp',
    name: 'Proveniensbild.webp',
  })
  const backend = await nativeBackend(context, emptyDocument(), [image])
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openStudio(page)
  await publish(page)
  assert.equal(backend.document.gallery.length, 0)
  assert.ok(!aboutHtml(backend.document).includes(image.path))
  const gate = await captureGate(context)
  gate.block()
  await page
    .locator('.cms-library-tabs')
    .getByRole('button', { name: 'Resurser', exact: true })
    .click()
  await page.locator('.cms-resource-card button').filter({ hasText: image.name }).click()
  await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
  await page
    .getByText('Filen är tilldelad. Förhandsvisningen uppdateras när du publicerar.', {
      exact: true,
    })
    .waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: 'Tillbaka till sidan', exact: true }).click()
  await page.getByRole('textbox', { name: 'Namn', exact: true }).fill('Efter tilldelning')
  gate.allow()
  await publish(page)
  assert.equal(publications(backend), 2)
  assert.ok(backend.document.gallery.some((row) => row.storage_path === image.path))
  assert.ok(aboutHtml(backend.document).includes(image.path))

  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await expect(page.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  gate.block()
  const attempts = gate.attempts()
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect
    .poll(
      async () =>
        publications(backend) > 2 ||
        (await page.getByRole('alert').allTextContents()).some((text) =>
          text.includes('Inget publicerades:'),
        ),
      { timeout: 45000 },
    )
    .toBe(true)
  await writeFile(
    `${evidenceDir}/undo-publication.json`,
    JSON.stringify(
      {
        captureAttempts: gate.attempts() - attempts,
        publications: publications(backend),
        gallery: backend.document.gallery,
        htmlContainsImage: aboutHtml(backend.document).includes(image.path),
        errors,
      },
      null,
      2,
    ),
  )
  assert.equal(publications(backend), 2, 'Undo must not publish stale HTML when recapture fails')
  assert.equal(gate.attempts() - attempts, 1, 'Undo must retry the stale layout capture')
  await expect(page.getByRole('alert')).toContainText('Inget publicerades:')
  gate.allow()
  await publish(page)
  assert.equal(publications(backend), 3)
  assert.ok(backend.document.gallery.some((row) => row.storage_path === image.path))
  assert.ok(aboutHtml(backend.document).includes(image.path))
  const visible = await publicAbout(newContext, backend.document, evidenceDir)
  await expect(visible.locator(`img[src$="/${image.path}"]`).first()).toBeVisible()
  assert.deepEqual(errors, [])
})

for (const reordered of [false, true])
  test(`cms-layout history reconciles ${reordered ? 'retained staff order' : 'portrait-free staff'} in published public HTML`, async ({
    page,
    context,
    newContext,
    evidenceDir,
  }) => {
    const former = barberFixture({
      id: 'former',
      name: 'Tidigare Barberare',
      ig: 'former',
      sort_order: 10,
    })
    const current = barberFixture({
      id: 'current',
      name: 'Aktuell Barberare',
      ig: 'current',
      sort_order: 10,
    })
    const retained = reordered
      ? [
          barberFixture({ id: 'a', name: 'Alfa Kvar', ig: 'a', sort_order: 0 }),
          barberFixture({ id: 'b', name: 'Beta Kvar', ig: 'b', sort_order: 1 }),
        ]
      : []
    const seed = emptyDocument()
    seed.barbers = [...retained, former]
    const backend = await nativeBackend(context, seed)
    await routeApi(context, [
      [
        'https://admin-harness.invalid/rest/v1/rpc/public_*',
        (route, headers) =>
          route.fulfill({
            headers,
            json: {
              settings: backend.document.settings,
              barbers: [...backend.document.barbers]
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                .map((barber) => ({
                  ...barber,
                  active: true,
                  photo_path: null,
                })),
              services: [],
              schedules: [],
            },
          }),
      ],
    ])
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openStudio(page)
    await publish(page)
    assert.ok(
      aboutHtml(backend.document).includes(former.name),
      'Historical HTML really shows the former staff member',
    )

    // Fixture the later roster and its matching layout through the real capture function.
    // The backend preserves revision 2 as history, just as a later staff administration change does.
    backend.document.barbers = [
      ...retained.map((barber) => ({ ...barber, sort_order: 1 - barber.sort_order })),
      current,
    ]
    const pages = await page.evaluate(async (document) => {
      const { captureResourceLayouts } = await import('/src/admin/cms/captureResourceLayouts.ts')
      return captureResourceLayouts(document, new globalThis.AbortController().signal)
    }, backend.document)
    backend.document.presentation.pages = backend.document.presentation.pages.map(
      (item) => pages.find((captured) => captured.id === item.id) ?? item,
    )
    assert.deepEqual(backend.document.photos, {})
    assert.ok(
      aboutHtml(backend.document).includes(current.name),
      'Current HTML really shows the new staff member',
    )
    assert.ok(!aboutHtml(backend.document).includes(former.name))
    await openStudio(page)
    await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/)

    const gate = await captureGate(context)
    await page.getByRole('button', { name: 'Historik', exact: true }).click()
    await page
      .locator('.cms-history-row')
      .filter({ hasText: 'v2' })
      .getByRole('button', { name: 'Återställ till utkast', exact: true })
      .click()
    await page
      .getByText(
        'Personalen har ändrats sedan den versionen. Barberare som slutat togs bort och nya behölls som de är nu.',
        { exact: true },
      )
      .waitFor()
    gate.block()
    const attempts = gate.attempts()
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await expect
      .poll(
        async () =>
          publications(backend) > 1 ||
          (await page.getByRole('alert').allTextContents()).some((text) =>
            text.includes('Inget publicerades:'),
          ),
        { timeout: 45000 },
      )
      .toBe(true)
    await writeFile(
      `${evidenceDir}/staff-publication.json`,
      JSON.stringify(
        {
          captureAttempts: gate.attempts() - attempts,
          publications: publications(backend),
          barbers: backend.document.barbers,
          htmlContainsFormer: aboutHtml(backend.document).includes(former.name),
          htmlContainsCurrent: aboutHtml(backend.document).includes(current.name),
          errors,
        },
        null,
        2,
      ),
    )
    assert.equal(
      publications(backend),
      1,
      'Reconciled staff must not publish historical HTML when recapture fails',
    )
    assert.equal(gate.attempts() - attempts, 1)
    await expect(page.getByRole('alert')).toContainText('Inget publicerades:')
    gate.allow()
    await publish(page)
    assert.deepEqual(backend.document.barbers, [...retained, current])
    assert.deepEqual(backend.document.photos, {})
    assert.ok(aboutHtml(backend.document).includes(current.name))
    assert.ok(!aboutHtml(backend.document).includes(former.name))
    const visible = await publicAbout(newContext, backend.document, evidenceDir)
    await expect(visible.getByText(current.name, { exact: true }).first()).toBeVisible()
    await expect(visible.getByText(former.name, { exact: true })).toHaveCount(0)
    const expectedOrder = [...retained, current].map((barber) => barber.name)
    const publicOrder = (
      await visible
        .locator('[data-knc-fold="barber-marquee"]')
        .first()
        .locator('span')
        .allTextContents()
    )
      .map((text) => text.trim())
      .filter((text) => expectedOrder.includes(text))
    await writeFile(
      `${evidenceDir}/staff-order.json`,
      JSON.stringify(
        {
          staff: backend.document.barbers.map(({ name, sort_order }) => ({ name, sort_order })),
          expectedOrder,
          publicOrder,
        },
        null,
        2,
      ),
    )
    assert.deepEqual(
      publicOrder,
      expectedOrder,
      'Published staff order and stored public HTML must agree',
    )
    assert.deepEqual(errors, [])
  })
