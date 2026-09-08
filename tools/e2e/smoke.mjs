import { chromium } from 'playwright'
import { writeSync } from 'node:fs'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '')
const WAIT_TIMEOUT = 15_000
const WATCHDOG_TIMEOUT = 180_000

const watchdog = globalThis.setTimeout(() => {
  writeSync(
    2,
    `[browser-smoke watchdog ${new Date().toISOString()}] exceeded ${WATCHDOG_TIMEOUT}ms\n`,
  )
  process.exit(124)
}, WATCHDOG_TIMEOUT)

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
    const tile = [...(row?.querySelectorAll('[role="button"]') ?? [])].find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.left < globalThis.innerWidth &&
        rect.bottom > 0 &&
        rect.top < globalThis.innerHeight
      )
    })
    if (!(row instanceof globalThis.HTMLElement) || !(tile instanceof globalThis.HTMLElement)) {
      throw new Error(`marquee logical tile ${index} missing`)
    }
    const rect = tile.getBoundingClientRect()
    const key = tile.getAttribute('data-tile-key')
    if (key === null) throw new Error(`marquee logical tile ${index} has no key`)
    return { key, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, rowIndex)
}

async function marqueeTileState(page, rowIndex, key) {
  return page.evaluate(
    ({ index, tileKey }) => {
      const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
      const tile = [...(row?.querySelectorAll('[role="button"]') ?? [])].find(
        (candidate) => candidate.getAttribute('data-tile-key') === tileKey,
      )
      return tile?.getAttribute('aria-pressed') ?? null
    },
    { index: rowIndex, tileKey: key },
  )
}

async function waitForMarqueeTileState(page, rowIndex, key, state) {
  await page.waitForFunction(
    ({ index, tileKey, expected }) => {
      const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
      const tile = [...(row?.querySelectorAll('[role="button"]') ?? [])].find(
        (candidate) => candidate.getAttribute('data-tile-key') === tileKey,
      )
      return tile?.getAttribute('aria-pressed') === expected
    },
    { index: rowIndex, tileKey: key, expected: state },
    { timeout: WAIT_TIMEOUT },
  )
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
  if (sequence === 'cancel') {
    const point = await marqueeTilePoint(page, rowIndex)
    await page.evaluate((index) => {
      const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
      if (!(row instanceof globalThis.HTMLElement))
        throw new Error('gallery pointercancel row missing')
      globalThis.__smokeCancelObserved = false
      row.addEventListener(
        'pointercancel',
        () => {
          globalThis.__smokeCancelObserved = true
        },
        { capture: true, once: true },
      )
    }, rowIndex)
    const client = await page.context().newCDPSession(page)
    let touchStarted = false
    try {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id: 37 }],
        modifiers: 0,
      })
      touchStarted = true
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x, y: point.y + 80, radiusX: 1, radiusY: 1, force: 1, id: 37 }],
        modifiers: 0,
      })
    } finally {
      if (touchStarted) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
          modifiers: 0,
        })
      }
      await client.detach()
    }
    await page.waitForFunction(() => globalThis.__smokeCancelObserved === true, undefined, {
      timeout: WAIT_TIMEOUT,
    })
    await page.evaluate(() => {
      delete globalThis.__smokeCancelObserved
    })
    return {
      key: point.key,
      pressed: await marqueeTileState(page, rowIndex, point.key),
    }
  }

  const point = await marqueeTilePoint(page, rowIndex)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  try {
    if (sequence === 'drag') {
      await page.mouse.move(point.x + 36, point.y, { steps: 3 })
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

  return { key: point.key, pressed: await marqueeTileState(page, rowIndex, point.key) }
}

async function verifyPublicPage(browser, viewport) {
  const errors = []
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: true })
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
  const tap = await dispatchGalleryPointerSequence(page, 0, 'tap')
  await waitForMarqueeTileState(page, 0, tap.key, 'true')
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

  await scrollMarqueeRowIntoView(page, 1)
  const cancel = await dispatchGalleryPointerSequence(page, 1, 'cancel')
  assert(cancel.pressed === 'false', 'gallery pointercancel selected a tile')
  await page.waitForTimeout(50)
  assert(
    (await marqueeTileState(page, 1, cancel.key)) === 'false',
    'gallery pointercancel selected a tile after release',
  )

  await scrollMarqueeRowIntoView(page, 1)
  const scroll = await dispatchGalleryPointerSequence(page, 1, 'scroll')
  assert(scroll.pressed === 'false', 'gallery scroll selected a tile')
  await page.waitForTimeout(50)
  assert(
    (await marqueeTileState(page, 1, scroll.key)) === 'false',
    'gallery scroll selected a tile after release',
  )

  await scrollMarqueeRowIntoView(page, 1)
  const drag = await dispatchGalleryPointerSequence(page, 1, 'drag')
  assert(drag.pressed === 'false', 'gallery drag selected a tile')
  await page.waitForTimeout(50)
  assert(
    (await marqueeTileState(page, 1, drag.key)) === 'false',
    'gallery drag selected a tile after release',
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
        return panel !== null && Math.abs(panel.getBoundingClientRect().top) <= 1
      },
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    const initialPanelTop = await panel.evaluate((element) => element.getBoundingClientRect().top)
    assert(Math.abs(initialPanelTop) <= 1, 'desktop panel does not begin at the viewport top')
    await page.evaluate(() =>
      globalThis.window.scrollTo({ top: globalThis.window.innerHeight / 2 }),
    )
    await page.waitForFunction(
      () =>
        Math.abs(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getBoundingClientRect().top ?? 1,
        ) <= 1,
      undefined,
      { timeout: WAIT_TIMEOUT },
    )
    const intermediatePanelTop = await panel.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
    assert(Math.abs(intermediatePanelTop) <= 1, 'desktop panel moved away from the viewport top')
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
        Math.abs(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getBoundingClientRect().top ?? 1,
        ) <= 1,
      undefined,
      { timeout: WAIT_TIMEOUT },
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
        Math.abs(
          globalThis.document
            .querySelector('[data-testid="desktop-top-panel"]')
            ?.getBoundingClientRect().top ?? 1,
        ) <= 1,
      undefined,
      { timeout: WAIT_TIMEOUT },
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

async function verifyNormalMotionGalleryKeyboard(browser) {
  const context = await browser.newContext({
    viewport: { width: 2400, height: 900 },
    reducedMotion: 'no-preference',
    hasTouch: true,
  })
  context.setDefaultTimeout(WAIT_TIMEOUT)
  context.setDefaultNavigationTimeout(WAIT_TIMEOUT)
  const page = await context.newPage()

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT })
  await page.locator('#root > :first-child').waitFor({ timeout: WAIT_TIMEOUT })
  await waitForFonts(page)
  await page.locator('#om-oss').scrollIntoViewIfNeeded({ timeout: WAIT_TIMEOUT })
  await scrollMarqueeRowIntoView(page, 0)
  await waitForGalleryToSettle(page)

  const row = page.getByTestId('marquee-row').first()
  const layout = await row.evaluate((element) => ({
    physicalCount: element.querySelectorAll('[data-tile-key]').length,
    logicalCount: element.querySelectorAll('[role="button"]').length,
    rowWidth: element.getBoundingClientRect().width,
    rowTop: element.getBoundingClientRect().top,
  }))
  assert(
    layout.physicalCount > layout.logicalCount * 2,
    `normal-motion gallery did not exercise perHalf > 1: ${JSON.stringify(layout)}`,
  )
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector('[data-testid="marquee-track"]')?.style.transform !== '',
    undefined,
    { timeout: WAIT_TIMEOUT },
  )

  const rowBox = await row.boundingBox()
  if (rowBox === null) throw new Error('normal-motion marquee row has no box')
  const dragDistance = layout.logicalCount * (210 + 14) + 150
  const startX = rowBox.x + rowBox.width - 12
  const endX = Math.max(rowBox.x + 12, startX - dragDistance)
  const client = await page.context().newCDPSession(page)
  let touchStarted = false
  try {
    const y = rowBox.y + rowBox.height / 2
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y, radiusX: 1, radiusY: 1, force: 1, id: 88 }],
      modifiers: 0,
    })
    touchStarted = true
    for (let step = 1; step <= 12; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: startX + ((endX - startX) * step) / 12,
            y,
            radiusX: 1,
            radiusY: 1,
            force: 1,
            id: 88,
          },
        ],
        modifiers: 0,
      })
    }
  } finally {
    if (touchStarted) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
        modifiers: 0,
      })
    }
    await client.detach()
  }

  const firstLogicalTile = row.locator('[role="button"]').first()
  const beforeFocus = await firstLogicalTile.boundingBox()
  assert(
    beforeFocus !== null && (beforeFocus.x + beforeFocus.width <= 0 || beforeFocus.x >= 2400),
    `normal-motion focus target was not advanced past the initial logical set: ${JSON.stringify(beforeFocus)}`,
  )
  await firstLogicalTile.focus()
  await page.waitForFunction(
    () => {
      const active = globalThis.document.activeElement
      if (!(active instanceof globalThis.HTMLElement)) return false
      const rect = active.getBoundingClientRect()
      return rect.right > 0 && rect.left < globalThis.innerWidth && rect.bottom > 0
    },
    undefined,
    { timeout: WAIT_TIMEOUT },
  )
  const afterFocus = await firstLogicalTile.boundingBox()
  assert(
    afterFocus !== null && afterFocus.x + afterFocus.width > 0 && afterFocus.x < 2400,
    `normal-motion focus target remained offscreen after re-anchor: ${JSON.stringify(afterFocus)}`,
  )
  await context.close()
}

async function verifyStaticEndpoints(page) {
  for (const path of ['/robots.txt', '/sitemap.xml', '/privacy']) {
    const response = await page.request.get(`${baseUrl}${path}`, { timeout: WAIT_TIMEOUT })
    assert(response.status() === 200, `${path} status ${response.status()}`)
  }
}

let browser
try {
  browser = await chromium.launch({ timeout: WAIT_TIMEOUT })
  await verifyPublicPage(browser, { width: 1280, height: 900 })
  await verifyPublicPage(browser, { width: 390, height: 844 })
  await verifyNormalMotionGalleryKeyboard(browser)
  const page = await browser.newPage()
  await verifyStaticEndpoints(page)
  await page.close()
  console.log('Browser smoke passed: desktop, mobile, assets, booking, my-bookings, discovery.')
} finally {
  if (browser !== undefined) {
    await browser.close()
  }
  globalThis.clearTimeout(watchdog)
}
