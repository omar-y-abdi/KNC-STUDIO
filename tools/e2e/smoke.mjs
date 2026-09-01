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

  await page.getByRole('button', { name: 'EN', exact: true }).first().click()
  assert(
    (await page
      .getByRole('button', { name: 'EN', exact: true })
      .first()
      .getAttribute('aria-pressed')) === 'true',
    'language toggle did not activate English',
  )

  const myBookingsButton = page
    .getByRole('button', { name: 'My appointments', exact: true })
    .first()
  await myBookingsButton.click()
  const myBookingsDialog = page.getByRole('dialog', { name: 'My appointments' })
  await myBookingsDialog.waitFor()
  await myBookingsDialog.getByRole('button', { name: 'Close' }).click()
  await myBookingsDialog.waitFor({ state: 'detached' })

  const about = page.locator('#om-oss')
  assert((await about.count()) === 1, 'About section is not mounted on the homepage')
  await about.scrollIntoViewIfNeeded()
  await page.waitForTimeout(100)
  const marqueeTransforms = await page
    .getByTestId('marquee-track')
    .evaluateAll((tracks) => tracks.map((track) => track.style.transform))
  assert(
    marqueeTransforms.every((transform) => transform === ''),
    `gallery moved with reduced motion: ${marqueeTransforms.join(', ')}`,
  )
  const marqueeSemantics = await page.getByTestId('marquee-row').evaluateAll((rows) =>
    rows.map((row) => {
      const tiles = [...row.querySelectorAll('[data-tile-key]')]
      const selectable = tiles.filter((tile) => tile.getAttribute('role') === 'button')
      const keys = new Set(selectable.map((tile) => tile.getAttribute('data-tile-key')))
      const hidden = tiles.filter((tile) => tile.getAttribute('aria-hidden') === 'true')
      return {
        tileCount: tiles.length,
        selectableCount: selectable.length,
        logicalCount: keys.size,
        hiddenCount: hidden.length,
        hiddenFocusableCount: hidden.filter((tile) => tile.hasAttribute('tabindex')).length,
        hiddenRoleCount: hidden.filter((tile) => tile.hasAttribute('role')).length,
      }
    }),
  )
  assert(
    marqueeSemantics.every(
      (row) =>
        row.tileCount > 0 &&
        row.selectableCount === row.logicalCount &&
        row.hiddenCount === row.tileCount - row.selectableCount &&
        row.hiddenFocusableCount === 0 &&
        row.hiddenRoleCount === 0,
    ),
    `gallery loop clones remain accessible: ${JSON.stringify(marqueeSemantics)}`,
  )

  const marqueeRow = page.getByTestId('marquee-row').first()
  await marqueeRow.scrollIntoViewIfNeeded()
  let previousGallerySignature = ''
  let stableGallerySamples = 0
  for (let attempt = 0; attempt < 30 && stableGallerySamples < 3; attempt += 1) {
    const gallerySignature = await marqueeRow
      .locator('[data-tile-key]')
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-tile-key')).join('|'))
    if (gallerySignature === previousGallerySignature) stableGallerySamples += 1
    else stableGallerySamples = 0
    previousGallerySignature = gallerySignature
    if (stableGallerySamples < 3) await page.waitForTimeout(100)
  }
  assert(stableGallerySamples >= 3, 'gallery tiles did not settle before interaction checks')
  const marqueeTiles = marqueeRow.locator('[role="button"]')
  assert((await marqueeTiles.count()) >= 1, 'gallery interaction regression has no logical tile')

  const tapTile = marqueeTiles.nth(0)
  await tapTile.click()
  assert((await tapTile.getAttribute('aria-pressed')) === 'true', 'gallery tap did not select tile')

  const interactionRow = page.getByTestId('marquee-row').nth(1)
  await interactionRow.scrollIntoViewIfNeeded()
  const interactionTile = interactionRow.locator('[role="button"]').first()
  const clone = interactionRow.locator('[aria-hidden="true"]').first()
  const cloneFocused = await clone.evaluate((element) => {
    element.focus()
    return globalThis.document.activeElement === element
  })
  assert(!cloneFocused, 'gallery loop clone can receive focus')

  const dragBox = await interactionTile.boundingBox()
  assert(dragBox !== null, 'gallery drag tile is not measurable')
  if (dragBox !== null) {
    const x = dragBox.x + dragBox.width / 2
    const y = dragBox.y + dragBox.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 36, y, { steps: 3 })
    await page.mouse.up()
  }
  assert(
    (await interactionTile.getAttribute('aria-pressed')) === 'false',
    'gallery drag selected a tile',
  )

  await interactionRow.scrollIntoViewIfNeeded()
  const cancelBox = await interactionTile.boundingBox()
  assert(cancelBox !== null, 'gallery pointercancel tile is not measurable')
  if (cancelBox !== null) {
    const x = cancelBox.x + cancelBox.width / 2
    const y = cancelBox.y + cancelBox.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await interactionRow.evaluate((row) => {
      row.dispatchEvent(
        new globalThis.PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
      )
    })
    await page.mouse.up()
  }
  assert(
    (await interactionTile.getAttribute('aria-pressed')) === 'false',
    'gallery pointercancel selected a tile',
  )

  await interactionRow.scrollIntoViewIfNeeded()
  const scrollBox = await interactionTile.boundingBox()
  assert(scrollBox !== null, 'gallery scroll tile is not measurable')
  if (scrollBox !== null) {
    const x = scrollBox.x + scrollBox.width / 2
    const y = scrollBox.y + scrollBox.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    if (viewport.width <= 768) {
      await page
        .getByTestId('mobile-site-scroll')
        .evaluate((element) => element.scrollBy({ top: 40 }))
    } else {
      await page.evaluate(() => globalThis.window.scrollBy({ top: 40 }))
    }
    await page.mouse.up()
  }
  assert(
    (await interactionTile.getAttribute('aria-pressed')) === 'false',
    'gallery scroll selected a tile',
  )

  await page.evaluate(() => {
    globalThis.window.scrollTo({ top: 0 })
    globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTo({ top: 0 })
  })

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
