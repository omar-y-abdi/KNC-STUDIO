import { chromium } from 'playwright'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function verifyPublicPage(browser, viewport) {
  const errors = []
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('#root > *').waitFor()
  await page.evaluate(() => globalThis.document.fonts.ready)

  assert((await page.title()).includes('Blade & Blend Studio'), 'public title missing')
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  )
  assert(overflow <= 1, `horizontal overflow: ${overflow}px`)

  const brokenImages = await page
    .locator('img')
    .evaluateAll((images) =>
      images
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute('src') ?? '<missing src>'),
    )
  assert(brokenImages.length === 0, `broken images: ${brokenImages.join(', ')}`)

  await page.getByRole('button', { name: 'EN', exact: true }).first().click()
  assert(
    (await page
      .getByRole('button', { name: 'EN', exact: true })
      .first()
      .getAttribute('aria-pressed')) === 'true',
    'language toggle did not activate English',
  )
  await page.getByRole('button', { name: 'Book appointment', exact: true }).first().click()
  await page.getByTestId('booking-barber-option').first().waitFor()

  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`)
  await context.close()
}

async function verifyStaticEndpoints(page) {
  const acp = await page.request.get(`${baseUrl}/.well-known/acp.json`)
  assert(acp.status() === 200, `ACP status ${acp.status()}`)
  const document = await acp.json()
  assert(document?.protocol?.name === 'acp', 'ACP protocol name missing')
  assert(Array.isArray(document?.capabilities?.services), 'ACP services missing')

  for (const path of ['/robots.txt', '/sitemap.xml', '/privacy']) {
    const response = await page.request.get(`${baseUrl}${path}`)
    assert(response.status() === 200, `${path} status ${response.status()}`)
  }
}

const browser = await chromium.launch()
try {
  await verifyPublicPage(browser, { width: 1280, height: 900 })
  await verifyPublicPage(browser, { width: 390, height: 844 })
  const page = await browser.newPage()
  await verifyStaticEndpoints(page)
  await page.close()
  console.log('Browser smoke passed: desktop, mobile, assets, booking, discovery.')
} finally {
  await browser.close()
}
