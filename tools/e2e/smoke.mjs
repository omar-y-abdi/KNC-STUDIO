import { chromium } from 'playwright'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '')
const WAIT_TIMEOUT = 15_000

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForFonts(page) {
  await page.evaluate((timeout) => {
    let timer
    return Promise.race([
      globalThis.document.fonts.ready,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`document fonts did not settle within ${timeout}ms`)),
          timeout,
        )
      }),
    ]).finally(() => globalThis.clearTimeout(timer))
  }, WAIT_TIMEOUT)
}

async function scrollMarqueeRowIntoView(page, rowIndex) {
  await page.evaluate((index) => {
    const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
    if (!(row instanceof globalThis.HTMLElement)) throw new Error(`marquee row ${index} missing`)
    row.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
  }, rowIndex)
}

async function marqueeTilePoint(page, rowIndex) {
  return page.evaluate((index) => {
    const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
    const tile = row?.querySelector('[role="button"]')
    if (!(row instanceof globalThis.HTMLElement) || !(tile instanceof globalThis.HTMLElement)) {
      throw new Error(`marquee logical tile ${index} missing`)
    }
    const rect = tile.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, rowIndex)
}

async function waitForGalleryToSettle(page) {
  let previousSignature = ''
  let stableSamples = 0
  for (let attempt = 0; attempt < 50 && stableSamples < 3; attempt += 1) {
    const galleryState = await page.evaluate(() => {
      const rows = [...globalThis.document.querySelectorAll('[data-testid="marquee-row"]')]
      return {
        ready:
          rows.length >= 2 &&
          rows.every(
            (row) =>
              row.querySelector('[role="button"]') !== null &&
              row.querySelector('[aria-hidden="true"]') !== null,
          ),
        signature: rows
          .map((row) =>
            [...row.querySelectorAll('[data-tile-key]')]
              .map(
                (tile) =>
                  `${tile.getAttribute('data-tile-key')}:${tile.getAttribute('role')}:${tile.getAttribute('aria-hidden')}`,
              )
              .join('|'),
          )
          .join('||'),
      }
    })
    if (galleryState.ready && galleryState.signature === previousSignature) {
      stableSamples += 1
    } else {
      stableSamples = 0
    }
    previousSignature = galleryState.signature
    if (stableSamples < 3) await page.waitForTimeout(100)
  }
  assert(stableSamples >= 3, 'gallery tiles did not settle before interaction checks')
}

async function dispatchGalleryPointerSequence(page, rowIndex, sequence) {
  const point = await marqueeTilePoint(page, rowIndex)
  if (sequence === 'cancel') {
    await page.evaluate(() => {
      globalThis.__smokePointerId = null
      globalThis.document.addEventListener(
        'pointerdown',
        (event) => {
          globalThis.__smokePointerId = event.pointerId
        },
        { capture: true, once: true },
      )
    })
  }
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  try {
    if (sequence === 'drag') {
      await page.mouse.move(point.x + 36, point.y, { steps: 3 })
    } else if (sequence === 'cancel') {
      const pointerId = await page.evaluate(() => {
        const activePointerId = globalThis.__smokePointerId
        delete globalThis.__smokePointerId
        return activePointerId
      })
      assert(Number.isInteger(pointerId), 'gallery pointercancel id was not recorded')
      await page.evaluate(
        ({ index, pointerId, x, y }) => {
          const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
          if (!(row instanceof globalThis.HTMLElement))
            throw new Error('gallery pointercancel row missing')
          row.dispatchEvent(
            new globalThis.PointerEvent('pointercancel', {
              bubbles: true,
              pointerId,
              pointerType: 'mouse',
              clientX: x,
              clientY: y,
            }),
          )
        },
        { index: rowIndex, pointerId, x: point.x, y: point.y },
      )
    } else if (sequence === 'scroll') {
      await page.evaluate(() => {
        const scrollRoot = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
        if (scrollRoot instanceof globalThis.HTMLElement) {
          scrollRoot.scrollBy({ top: 40 })
          scrollRoot.dispatchEvent(new globalThis.Event('scroll'))
        } else {
          globalThis.window.scrollBy({ top: 40 })
          globalThis.document.dispatchEvent(new globalThis.Event('scroll'))
        }
      })
    }
  } finally {
    await page.mouse.up()
  }

  return page.evaluate((index) => {
    const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
    return row?.querySelector('[role="button"]')?.getAttribute('aria-pressed') ?? null
  }, rowIndex)
}

async function verifyPublicPage(browser, viewport) {
  const errors = []
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
  context.setDefaultTimeout(WAIT_TIMEOUT)
  context.setDefaultNavigationTimeout(WAIT_TIMEOUT)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT })
  await page.locator('#root > :first-child').waitFor({ timeout: WAIT_TIMEOUT })
  await waitForFonts(page)

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

  await page
    .getByRole('button', { name: 'EN', exact: true })
    .first()
    .click({ timeout: WAIT_TIMEOUT })
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
  await myBookingsButton.click({ timeout: WAIT_TIMEOUT })
  const myBookingsDialog = page.getByRole('dialog', { name: 'My appointments' })
  await myBookingsDialog.waitFor({ timeout: WAIT_TIMEOUT })
  await myBookingsDialog.getByRole('button', { name: 'Close' }).click({ timeout: WAIT_TIMEOUT })
  await myBookingsDialog.waitFor({ state: 'detached', timeout: WAIT_TIMEOUT })

  const about = page.locator('#om-oss')
  assert((await about.count()) === 1, 'About section is not mounted on the homepage')
  await about.scrollIntoViewIfNeeded({ timeout: WAIT_TIMEOUT })
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

  await waitForGalleryToSettle(page)
  await scrollMarqueeRowIntoView(page, 0)
  await dispatchGalleryPointerSequence(page, 0, 'tap')
  await page.waitForFunction(
    () =>
      globalThis.document
        .querySelectorAll('[data-testid="marquee-row"]')[0]
        ?.querySelector('[role="button"]')
        ?.getAttribute('aria-pressed') === 'true',
    undefined,
    { timeout: WAIT_TIMEOUT },
  )
  await waitForGalleryToSettle(page)

  await scrollMarqueeRowIntoView(page, 1)
  const cloneFocused = await page.evaluate(() => {
    const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[1]
    const clones = row?.querySelectorAll('[aria-hidden="true"]')
    if (clones === undefined || clones.length === 0) throw new Error('gallery loop clone missing')
    return [...clones].some((clone) => {
      clone.focus()
      return globalThis.document.activeElement === clone
    })
  })
  assert(!cloneFocused, 'gallery loop clone can receive focus')

  assert(
    (await dispatchGalleryPointerSequence(page, 1, 'drag')) === 'false',
    'gallery drag selected a tile',
  )
  await page.waitForTimeout(50)
  assert(
    (await page.evaluate(() =>
      globalThis.document
        .querySelectorAll('[data-testid="marquee-row"]')[1]
        ?.querySelector('[role="button"]')
        ?.getAttribute('aria-pressed'),
    )) === 'false',
    'gallery drag selected a tile after release',
  )

  await scrollMarqueeRowIntoView(page, 1)
  assert(
    (await dispatchGalleryPointerSequence(page, 1, 'cancel')) === 'false',
    'gallery pointercancel selected a tile',
  )
  await page.waitForTimeout(50)
  assert(
    (await page.evaluate(() =>
      globalThis.document
        .querySelectorAll('[data-testid="marquee-row"]')[1]
        ?.querySelector('[role="button"]')
        ?.getAttribute('aria-pressed'),
    )) === 'false',
    'gallery pointercancel selected a tile after release',
  )

  await scrollMarqueeRowIntoView(page, 1)
  assert(
    (await dispatchGalleryPointerSequence(page, 1, 'scroll')) === 'false',
    'gallery scroll selected a tile',
  )
  await page.waitForTimeout(50)
  assert(
    (await page.evaluate(() =>
      globalThis.document
        .querySelectorAll('[data-testid="marquee-row"]')[1]
        ?.querySelector('[role="button"]')
        ?.getAttribute('aria-pressed'),
    )) === 'false',
    'gallery scroll selected a tile after release',
  )

  await page.evaluate(() => {
    globalThis.window.scrollTo({ top: 0 })
    globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTo({ top: 0 })
  })

  if (viewport.width <= 768) {
    const scrollRoot = page.getByTestId('mobile-site-scroll')
    await scrollRoot.evaluate((element) => element.scrollTo({ top: element.clientHeight }))
    await page.getByRole('button', { name: 'Back to home' }).waitFor({ timeout: WAIT_TIMEOUT })
    await page.getByRole('button', { name: 'Back to home' }).click({ timeout: WAIT_TIMEOUT })
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTop === 0,
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
  } else {
    const panel = page.getByTestId('desktop-top-panel')
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 })
    await page.waitForFunction(
      () => {
        const panel = globalThis.document.querySelector('[data-testid="desktop-top-panel"]')
        return (
          panel !== null &&
          Math.abs(panel.getBoundingClientRect().top - (globalThis.window.innerHeight - 61)) <= 1
        )
      },
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    const initialPanelTop = await panel.evaluate((element) => element.getBoundingClientRect().top)
    assert(initialPanelTop > 0, 'desktop panel does not begin at the hero lower edge')
    await page.evaluate(() =>
      globalThis.window.scrollTo({ top: globalThis.window.innerHeight / 2 }),
    )
    await page.waitForFunction(
      () => {
        const progress = Number(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getAttribute('data-scroll-progress'),
        )
        return progress > 0 && progress < 1
      },
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    const intermediatePanelTop = await panel.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
    assert(
      intermediatePanelTop > 0 && intermediatePanelTop < initialPanelTop,
      'desktop panel did not move continuously toward the top',
    )
    await page.getByRole('button', { name: 'Toggle light/dark' }).click({ timeout: WAIT_TIMEOUT })
    await page.waitForFunction(
      (previousTop) => {
        const panel = globalThis.document.querySelector('[data-testid="desktop-top-panel"]')
        return panel !== null && Math.abs(panel.getBoundingClientRect().top - previousTop) <= 1
      },
      intermediatePanelTop,
      { timeout: WAIT_TIMEOUT },
    )
    await page.evaluate(() => globalThis.window.scrollTo({ top: globalThis.window.innerHeight }))
    await page.waitForFunction(
      () =>
        Number(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getAttribute('data-scroll-progress'),
        ) === 1,
      undefined,
      { timeout: WAIT_TIMEOUT },
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
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    await page.evaluate(() => globalThis.window.scrollTo({ top: 0 }))
    await page.waitForFunction(
      () =>
        Number(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getAttribute('data-scroll-progress'),
        ) === 0,
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    assert(
      Math.abs(
        (await panel.evaluate((element) => element.getBoundingClientRect().top)) -
          (await page.evaluate(() => globalThis.window.innerHeight - 61)),
      ) <= 1,
      'desktop panel did not reverse back to the hero lower edge',
    )
    await page.getByRole('button', { name: 'About', exact: true }).click({ timeout: WAIT_TIMEOUT })
    await page.waitForFunction(
      () => {
        const top = globalThis.document.querySelector('#om-oss')?.getBoundingClientRect().top
        return top !== undefined && top >= 60 && top <= 62
      },
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    await page.evaluate(() => globalThis.window.scrollTo({ top: 0 }))
  }

  await page
    .getByRole('button', { name: 'Book appointment', exact: true })
    .first()
    .click({ timeout: WAIT_TIMEOUT })
  assert((await about.count()) === 0, 'About section remains mounted while booking is open')
  await page.getByTestId('booking-step-barber').waitFor({ timeout: WAIT_TIMEOUT })
  // Production data may provide options; an intentionally unconfigured test build must show an
  // honest empty state instead of bundled barber fixtures.
  await page
    .locator('[data-testid="booking-barber-option"],[data-testid="booking-barber-empty"]')
    .first()
    .waitFor({ timeout: WAIT_TIMEOUT })

  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`)
  await context.close()
}

async function verifyStaticEndpoints(page) {
  const acp = await page.request.get(`${baseUrl}/.well-known/acp.json`, { timeout: WAIT_TIMEOUT })
  assert(acp.status() === 200, `ACP status ${acp.status()}`)
  const document = await acp.json()
  assert(document?.protocol?.name === 'acp', 'ACP protocol name missing')
  assert(Array.isArray(document?.capabilities?.services), 'ACP services missing')

  for (const path of ['/robots.txt', '/sitemap.xml', '/privacy']) {
    const response = await page.request.get(`${baseUrl}${path}`, { timeout: WAIT_TIMEOUT })
    assert(response.status() === 200, `${path} status ${response.status()}`)
  }
}

const browser = await chromium.launch({ timeout: WAIT_TIMEOUT })
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
