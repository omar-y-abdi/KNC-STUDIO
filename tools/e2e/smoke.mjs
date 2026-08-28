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
  await page.locator('#root > :first-child').waitFor()
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

  await page.evaluate(() => {
    globalThis.document.cookie = 'bladeblend_mybookings_phone=0700000000; Path=/; SameSite=Lax'
  })
  const swedishPrivacyBanner = page.getByRole('region', { name: 'Integritet och lagring' })
  await swedishPrivacyBanner.getByRole('button', { name: 'Avvisa valfri lagring' }).click()
  assert(
    !(await page.evaluate(() =>
      globalThis.document.cookie.includes('bladeblend_mybookings_phone='),
    )),
    'rejecting optional storage did not delete the phone-memory cookie',
  )
  await page.getByRole('button', { name: 'EN', exact: true }).first().click()
  assert(
    (await page
      .getByRole('button', { name: 'EN', exact: true })
      .first()
      .getAttribute('aria-pressed')) === 'true',
    'language toggle did not activate English',
  )

  const privacyBanner = page.getByRole('region', { name: 'Privacy and storage' })
  const managePrivacy = page.getByRole('button', { name: 'Manage privacy preferences' })
  await managePrivacy.waitFor()
  await managePrivacy.click()
  await privacyBanner.waitFor()
  const functionalStorage = page.locator('#functional-storage')
  await functionalStorage.check()
  await privacyBanner.getByRole('button', { name: 'Save choices' }).click()
  await page.waitForFunction(() =>
    globalThis.document.cookie.includes('bladeblend_storage_preferences=functional'),
  )

  await page.evaluate(() => {
    globalThis.document.cookie = 'bladeblend_mybookings_phone=0700000000; Path=/; SameSite=Lax'
  })
  await managePrivacy.click()
  await privacyBanner.waitFor()
  assert(await functionalStorage.isChecked(), 'functional storage was not restored in preferences')
  await functionalStorage.uncheck()
  await privacyBanner.getByRole('button', { name: 'Save choices' }).click()
  await page.waitForFunction(() =>
    globalThis.document.cookie.includes('bladeblend_storage_preferences=essential'),
  )
  assert(
    !(await page.evaluate(() =>
      globalThis.document.cookie.includes('bladeblend_mybookings_phone='),
    )),
    'withdrawing functional storage did not delete the phone-memory cookie',
  )

  const myBookingsButton = page.getByRole('button', { name: 'My appointments', exact: true }).first()
  await myBookingsButton.click()
  const myBookingsDialog = page.getByRole('dialog', { name: 'My appointments' })
  await myBookingsDialog.waitFor()
  await myBookingsDialog.getByRole('button', { name: 'Close' }).click()
  await myBookingsDialog.waitFor({ state: 'detached' })

  const about = page.locator('#om-oss')
  assert((await about.count()) === 1, 'About section is not mounted on the homepage')

  if (viewport.width <= 768) {
    const scrollRoot = page.getByTestId('mobile-site-scroll')
    await scrollRoot.evaluate((element) => element.scrollTo({ top: element.clientHeight }))
    await page.getByRole('button', { name: 'Back to home' }).waitFor()
    await page.getByRole('button', { name: 'Back to home' }).click()
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTop === 0,
    )
  } else {
    const panel = page.getByTestId('desktop-top-panel')
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 })
    await page.waitForFunction(() => {
      const panel = globalThis.document.querySelector('[data-testid="desktop-top-panel"]')
      return (
        panel !== null &&
        Math.abs(panel.getBoundingClientRect().top - (globalThis.window.innerHeight - 61)) <= 1
      )
    })
    const initialPanelTop = await panel.evaluate((element) => element.getBoundingClientRect().top)
    assert(initialPanelTop > 0, 'desktop panel does not begin at the hero lower edge')
    await page.evaluate(() =>
      globalThis.window.scrollTo({ top: globalThis.window.innerHeight / 2 }),
    )
    await page.waitForFunction(() => {
      const progress = Number(
        globalThis.document
          .querySelector('[data-testid="desktop-top-panel"]')
          ?.getAttribute('data-scroll-progress'),
      )
      return progress > 0 && progress < 1
    })
    const intermediatePanelTop = await panel.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
    assert(
      intermediatePanelTop > 0 && intermediatePanelTop < initialPanelTop,
      'desktop panel did not move continuously toward the top',
    )
    await page.getByRole('button', { name: 'Toggle light/dark' }).click()
    await page.waitForFunction((previousTop) => {
      const panel = globalThis.document.querySelector('[data-testid="desktop-top-panel"]')
      return panel !== null && Math.abs(panel.getBoundingClientRect().top - previousTop) <= 1
    }, intermediatePanelTop)
    await page.evaluate(() => globalThis.window.scrollTo({ top: globalThis.window.innerHeight }))
    await page.waitForFunction(
      () =>
        Number(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getAttribute('data-scroll-progress'),
        ) === 1,
    )
    assert(
      (await panel.evaluate((element) => element.getBoundingClientRect().top)) <= 1,
      'desktop panel did not settle at the top before About',
    )
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 140 })
    await page.waitForFunction(
      () =>
        Math.abs(
          (globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getBoundingClientRect().top ?? 1) - 0,
        ) <= 1,
    )
    await page.evaluate(() => globalThis.window.scrollTo({ top: 0 }))
    await page.waitForFunction(
      () =>
        Number(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getAttribute('data-scroll-progress'),
        ) === 0,
    )
    assert(
      Math.abs(
        (await panel.evaluate((element) => element.getBoundingClientRect().top)) -
          (await page.evaluate(() => globalThis.window.innerHeight - 61)),
      ) <= 1,
      'desktop panel did not reverse back to the hero lower edge',
    )
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await page.waitForFunction(() => {
      const top = globalThis.document.querySelector('#om-oss')?.getBoundingClientRect().top
      return top !== undefined && top >= 60 && top <= 62
    })
    await page.evaluate(() => globalThis.window.scrollTo({ top: 0 }))
  }

  await page.getByRole('button', { name: 'Book appointment', exact: true }).first().click()
  assert((await about.count()) === 0, 'About section remains mounted while booking is open')
  await page.getByTestId('booking-step-barber').waitFor()
  // Production data may provide options; an intentionally unconfigured test build must show an
  // honest empty state instead of bundled barber fixtures.
  await page
    .locator('[data-testid="booking-barber-option"],[data-testid="booking-barber-empty"]')
    .first()
    .waitFor()

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
  console.log('Browser smoke passed: desktop, mobile, assets, booking, my-bookings, discovery.')
} finally {
  await browser.close()
}
