import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const id = (number) => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`
const seed = emptyDocument()
seed.settings.homepage_logo_path = `logo/${id(30)}.webp`
seed.barbers = ['Fixture barber A', 'Fixture barber B'].map((name, index) => ({
  id: `fixture-barber-${index + 1}`,
  name,
  ig: '',
  role_sv: 'Frisör',
  role_en: 'Barber',
  bio_sv: 'Frisörens befintliga presentation.',
  bio_en: 'The existing barber presentation.',
  sort_order: index,
}))
seed.photos = Object.fromEntries(
  seed.barbers.map((barber) => [barber.id, `${barber.id}/${id(3)}.webp`]),
)
seed.gallery = ['salon', 'cuts'].flatMap((kind, index) =>
  [1, 2, 3].map((number) => ({
    id: id(10 + index * 3 + number),
    kind,
    storage_path: `${kind}/${id(10 + index * 3 + number)}.webp`,
    alt: `Fixture ${kind} photo ${number}`,
    sort_order: number,
  })),
)
const services = seed.barbers.map((barber, index) => ({
  id: id(40 + index),
  barber_id: barber.id,
  name: 'Klippning',
  price: 350,
  duration_min: 30,
  active: true,
  sort_order: 0,
  available_weekdays: [0, 1, 2, 3, 4, 5, 6],
}))
const failures = []

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  const browser = await engine.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  context.setDefaultTimeout(15000)
  const backend = await nativeBackend(context, seed)
  await context.route('https://admin-harness.invalid/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const document = backend.document
    const headers = { 'Access-Control-Allow-Origin': new URL(base).origin }
    const reply = (json) => route.fulfill({ headers, json })
    if (request.method() === 'OPTIONS') return route.fallback()
    if (url.pathname.startsWith('/storage/v1/object/public/'))
      return route.fulfill({ headers, contentType: 'image/png', path: 'public/og-image.png' })
    if (url.pathname === '/rest/v1/rpc/public_business_discovery')
      return reply({
        settings: document.settings,
        barbers: document.barbers.map(({ id, name }) => ({ id, name })),
        services,
        schedules: [],
      })
    if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
      return reply({
        barbers: document.barbers.map((barber) => ({
          ...barber,
          active: true,
          photo_path: document.photos[barber.id],
        })),
        services,
      })
    if (url.pathname === '/rest/v1/gallery_images') {
      const kind = url.searchParams.get('kind')?.slice(3)
      return reply(document.gallery.filter((photo) => !kind || photo.kind === kind))
    }
    return route.fallback()
  })
  const page = await context.newPage()
  const frame = page.frameLocator('.gjs-frame').first()
  const inspector = page.locator('#cms-inspector')
  try {
    await page.goto(base)
    await page.getByRole('button', { name: 'Om oss', exact: true }).click()
    const originalTileWidth = await page
      .getByAltText('Fixture salon photo 1', { exact: true })
      .first()
      .evaluate((node) => globalThis.getComputedStyle(node).width)
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      harness.mountCmsStudioHarness()
    })
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Anpassa vyn', exact: true }).click()
    const library = page.locator('#cms-library')
    await library.getByRole('button', { name: 'Om oss', exact: true }).click()
    await frame.getByAltText('Fixture salon photo 1', { exact: true }).first().waitFor()
    await frame.getByText('Fixture barber A', { exact: true }).first().waitFor()
    await page.screenshot({ path: `/tmp/cms-native-${name}-populated-about.png` })
    await library.getByRole('button', { name: 'Startsida', exact: true }).click()
    await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
    const galleryImage = page
      .frameLocator('.cms-live-preview iframe')
      .getByAltText('Fixture salon photo 1', { exact: true })
      .first()
    await galleryImage.scrollIntoViewIfNeeded()
    assert.equal(
      await galleryImage.evaluate((node) => globalThis.getComputedStyle(node).width),
      originalTileWidth,
      'Locked home preview must retain gallery tile sizing instead of expanding original images',
    )
    await page.screenshot({ path: `/tmp/cms-native-${name}-locked-home-scroll.png` })
    await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
    const copy = frame.getByText('KNC source sv', { exact: true }).first()
    await copy.click()
    await inspector.getByLabel('Text', { exact: true }).fill('Owner edited the populated site')
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.waitForFunction(() =>
      globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
    )
    assert.deepEqual(
      backend.document.barbers,
      seed.barbers,
      'Presentation edits must not mutate the roster',
    )
    assert.deepEqual(
      backend.document.gallery,
      seed.gallery,
      'Presentation edits must retain the gallery',
    )
    const live = await context.newPage()
    await live.goto(base)
    await live.getByText('Owner edited the populated site', { exact: true }).waitFor()
    await live.getByRole('button', { name: 'Boka tid', exact: true }).click()
    await live.locator('[data-testid="fold-booking"]').waitFor()
    await live
      .locator('[data-testid="fold-booking"]')
      .getByText('Fixture barber A', { exact: true })
      .waitFor()
    await live.reload()
    await live.getByText('Owner edited the populated site', { exact: true }).waitFor()
    console.log(`PASS populated ${name}: roster, photos, publication, reload, native booking`)

    await page.bringToFront()
    await frame.getByAltText('Blade & Blend Studio', { exact: true }).first().click()
    await inspector.getByLabel('Alternativtext', { exact: true }).fill('Owner logo description')
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.waitForFunction(() =>
      globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
    )
    await live.reload()
    await live.getByAltText('Owner logo description', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/cms-native-${name}-populated-image.png` })
    console.log(`PASS populated ${name}: original image edit survives publication and reload`)

    await live.goto(`${base}/?lang=en&mode=dark`)
    await live.getByText('KNC source en', { exact: true }).waitFor()
    assert.equal(await live.locator('html').getAttribute('lang'), 'en')
    assert.equal(
      await live
        .getByRole('button', { name: 'Toggle light/dark' })
        .locator('span img')
        .getAttribute('src'),
      '/icons/moon.svg',
    )
    await live.reload()
    await live.getByText('KNC source en', { exact: true }).waitFor()
    assert.equal(
      await live
        .getByRole('button', { name: 'Toggle light/dark' })
        .locator('span img')
        .getAttribute('src'),
      '/icons/moon.svg',
    )
    await live.screenshot({ path: `/tmp/cms-native-${name}-english-dark-reload.png` })
    console.log(`PASS populated ${name}: direct English/dark URL survives fresh public reload`)

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await live.setViewportSize(viewport)
      await live.goto(`${base}/about`)
      const aboutAtTop = () => {
        const bounds = globalThis.document.getElementById('om-oss-heading')?.getBoundingClientRect()
        return bounds && bounds.top >= 0 && bounds.top < 300
      }
      await live.waitForFunction(aboutAtTop)
      await live.reload()
      await live.waitForFunction(aboutAtTop)
      await live.getByText('Fixture barber A', { exact: true }).waitFor()
      await live.getByAltText('Fixture salon photo 1', { exact: true }).first().waitFor()
      await live.screenshot({ path: `/tmp/cms-native-${name}-about-${viewport.width}-reload.png` })
    }
    console.log(
      `PASS populated ${name}: direct About opens its existing section on desktop/mobile reload`,
    )
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.error('POPULATED_OWNER_ERROR', error)
    console.error('POPULATED_OWNER_BODY', (await page.locator('body').innerText()).slice(0, 4000))
    await page.screenshot({ path: `/tmp/cms-native-${name}-populated-failure.png` })
  } finally {
    await browser.close()
  }
}
assert.deepEqual(failures, [], 'The owner editor must work with populated public content')
