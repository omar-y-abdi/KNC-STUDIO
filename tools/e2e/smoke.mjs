import { chromium, firefox, webkit } from 'playwright'
import { writeSync, mkdtempSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import { customerCmsFixture } from './cms-customer.mjs'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '')
const WAIT_TIMEOUT = 15_000
const WATCHDOG_TIMEOUT = 180_000
let currentPhase = 'startup'

function phase(label) {
  currentPhase = label
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function bounded(promise, label, timeout = WAIT_TIMEOUT) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`${label} timed out after ${timeout}ms (phase: ${currentPhase})`)),
          timeout,
        )
      }),
    ])
  } finally {
    globalThis.clearTimeout(timer)
  }
}

async function runCdpTouchSequence(client, label, startPoint, movePoints) {
  let touchStarted = false
  let failed = false
  let failure
  const retainFirstError = (error) => {
    if (!failed) {
      failed = true
      failure = error
    }
  }
  try {
    phase(`${label}: CDP touchStart`)
    await bounded(
      client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [startPoint],
        modifiers: 0,
      }),
      'CDP Input.dispatchTouchEvent touchStart',
    )
    touchStarted = true
    for (const [index, point] of movePoints.entries()) {
      phase(`${label}: CDP touchMove ${index + 1}`)
      await bounded(
        client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [point],
          modifiers: 0,
        }),
        `CDP Input.dispatchTouchEvent touchMove ${index + 1}`,
      )
    }
  } catch (error) {
    retainFirstError(error)
  } finally {
    if (touchStarted) {
      try {
        phase(`${label}: CDP touchEnd cleanup`)
        await bounded(
          client.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
            modifiers: 0,
          }),
          'CDP Input.dispatchTouchEvent touchEnd cleanup',
        )
      } catch (error) {
        retainFirstError(error)
      }
    }
    try {
      phase(`${label}: CDP detach cleanup`)
      await bounded(client.detach(), 'CDP session detach cleanup')
    } catch (error) {
      retainFirstError(error)
    }
  }
  if (failed) throw failure
}

async function runMousePointerSequence(page, label, point, sequence) {
  let mouseDownAttempted = false
  let failed = false
  let failure
  const retainFirstError = (error) => {
    if (!failed) {
      failed = true
      failure = error
    }
  }
  try {
    phase(`${label}: mouse move to tile`)
    await bounded(page.mouse.move(point.x, point.y), 'mouse.move to gallery tile')
    phase(`${label}: mouse down`)
    mouseDownAttempted = true
    await bounded(page.mouse.down(), 'mouse.down on gallery tile')
    if (sequence === 'drag') {
      phase(`${label}: mouse drag move`)
      await bounded(page.mouse.move(point.x + 36, point.y, { steps: 3 }), 'mouse.move gallery drag')
    } else if (sequence === 'scroll') {
      phase(`${label}: mouse scroll gesture`)
      await bounded(
        page.evaluate(() => {
          const scrollRoot = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
          if (scrollRoot instanceof globalThis.HTMLElement) {
            scrollRoot.scrollBy({ top: 40 })
            scrollRoot.dispatchEvent(new globalThis.Event('scroll'))
          } else {
            globalThis.window.scrollBy({ top: 40 })
            globalThis.document.dispatchEvent(new globalThis.Event('scroll'))
          }
        }),
        'gallery scroll gesture',
      )
    }
  } catch (error) {
    retainFirstError(error)
  } finally {
    if (mouseDownAttempted) {
      try {
        phase(`${label}: mouse up cleanup`)
        await bounded(page.mouse.up(), 'mouse.up gallery cleanup')
      } catch (error) {
        retainFirstError(error)
      }
    }
  }
  if (failed) throw failure
}

const watchdog = globalThis.setTimeout(() => {
  writeSync(
    2,
    `[browser-smoke watchdog ${new Date().toISOString()}] exceeded ${WATCHDOG_TIMEOUT}ms; phase=${currentPhase}\n`,
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

// Exercise the actual gallery adapter/renderer with deterministic image bytes. These routes are
// scoped to each browser test context: no database rows or public Storage objects are changed.
async function installGalleryFixtures(page) {
  const photo = readFileSync(new URL('../../public/og-image.png', import.meta.url))
  await page.route('**/rest/v1/gallery_images?*', async (route) => {
    const kind = new URL(route.request().url()).searchParams.get('kind')?.replace('eq.', '')
    assert(kind === 'salon' || kind === 'cuts', `unexpected gallery kind: ${kind}`)
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: [0, 1].map((index) => ({
        id: `smoke-${kind}-${index}`,
        kind,
        storage_path: `smoke-fixtures/${kind}-${index}.png`,
        alt: index === 0 ? '  ' : `Gallery smoke ${kind} photo`,
        sort_order: index,
      })),
    })
  })
  await page.route('**/storage/v1/object/public/gallery/smoke-fixtures/*.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: photo }),
  )
}

async function scrollMarqueeRowIntoView(page, rowIndex) {
  await page.evaluate((index) => {
    const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
    if (!(row instanceof globalThis.HTMLElement)) throw new Error(`marquee row ${index} missing`)
    row.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
  }, rowIndex)
}

async function marqueeTilePoint(page, rowIndex) {
  return bounded(
    page.evaluate(async (index) => {
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
      // Only the visible target must decode; offscreen lazy images may legitimately remain unloaded.
      const photo = tile.querySelector('img')
      if (photo !== null) await photo.decode()
      if (!tile.isConnected) throw new Error('gallery tile changed while its image decoded')
      const rect = tile.getBoundingClientRect()
      const key = tile.getAttribute('data-tile-key')
      if (key === null) throw new Error(`marquee logical tile ${index} has no key`)
      return { key, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }, rowIndex),
    `gallery row ${rowIndex} target image decode`,
  )
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
  phase(`gallery row ${rowIndex} ${sequence}: locate tile`)
  if (sequence === 'cancel') {
    const point = await marqueeTilePoint(page, rowIndex)
    phase(`gallery row ${rowIndex} ${sequence}: install listener`)
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
    await runCdpTouchSequence(
      client,
      `gallery row ${rowIndex} ${sequence}`,
      { x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id: 37 },
      [{ x: point.x, y: point.y + 80, radiusX: 1, radiusY: 1, force: 1, id: 37 }],
    )
    phase(`gallery row ${rowIndex} ${sequence}: await pointercancel`)
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

  phase(`gallery row ${rowIndex} ${sequence}: locate tile for mouse sequence`)
  const point = await marqueeTilePoint(page, rowIndex)
  if (sequence === 'drag') {
    phase(`gallery row ${rowIndex} ${sequence}: observe native dragstart`)
    await page.evaluate((index) => {
      const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
      if (!(row instanceof globalThis.HTMLElement)) throw new Error('gallery drag row missing')
      globalThis.__smokeNativeDragStarts = []
      globalThis.__smokeNativeDragHandler = (event) => {
        const target = event.target
        globalThis.__smokeNativeDragStarts.push(
          target instanceof globalThis.HTMLElement ? target.tagName : 'unknown',
        )
      }
      row.addEventListener('dragstart', globalThis.__smokeNativeDragHandler, true)
    }, rowIndex)
  }
  await runMousePointerSequence(page, `gallery row ${rowIndex} ${sequence}`, point, sequence)
  if (sequence === 'drag') {
    phase(`gallery row ${rowIndex} ${sequence}: assert no native dragstart`)
    const nativeDragStarts = await page.evaluate(() => globalThis.__smokeNativeDragStarts)
    await page.evaluate((index) => {
      const row = globalThis.document.querySelectorAll('[data-testid="marquee-row"]')[index]
      if (
        row instanceof globalThis.HTMLElement &&
        globalThis.__smokeNativeDragHandler !== undefined
      ) {
        row.removeEventListener('dragstart', globalThis.__smokeNativeDragHandler, true)
      }
      delete globalThis.__smokeNativeDragHandler
      delete globalThis.__smokeNativeDragStarts
    }, rowIndex)
    assert(
      nativeDragStarts.length === 0,
      `native dragstart fired during gallery drag: ${JSON.stringify(nativeDragStarts)}`,
    )
  }

  return { key: point.key, pressed: await marqueeTileState(page, rowIndex, point.key) }
}

async function verifyPublicPage(browser, viewport) {
  phase(`public ${viewport.width}x${viewport.height}: create context`)
  const errors = []
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: true })
  context.setDefaultTimeout(WAIT_TIMEOUT)
  context.setDefaultNavigationTimeout(WAIT_TIMEOUT)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await installGalleryFixtures(page)

  phase(`public ${viewport.width}x${viewport.height}: goto`)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT })
  phase(`public ${viewport.width}x${viewport.height}: wait app`)
  await page.locator('#root > :first-child').waitFor({ timeout: WAIT_TIMEOUT })
  phase(`public ${viewport.width}x${viewport.height}: wait fonts`)
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

  phase(`public ${viewport.width}x${viewport.height}: language toggle`)
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

  phase(`public ${viewport.width}x${viewport.height}: my bookings dialog`)
  const myBookingsButton = page
    .getByRole('button', { name: 'My appointments', exact: true })
    .first()
  await myBookingsButton.click({ timeout: WAIT_TIMEOUT })
  const myBookingsDialog = page.getByRole('dialog', { name: 'My appointments' })
  await myBookingsDialog.waitFor({ timeout: WAIT_TIMEOUT })
  await myBookingsDialog.getByRole('button', { name: 'Close' }).click({ timeout: WAIT_TIMEOUT })
  await myBookingsDialog.waitFor({ state: 'detached', timeout: WAIT_TIMEOUT })

  phase(`public ${viewport.width}x${viewport.height}: gallery setup`)
  const about = page.locator('#om-oss')
  assert((await about.count()) === 1, 'About section is not mounted on the homepage')
  await about.scrollIntoViewIfNeeded({ timeout: WAIT_TIMEOUT })
  await waitForGalleryToSettle(page)
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
    await about.scrollIntoViewIfNeeded({ timeout: WAIT_TIMEOUT })
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

  phase(`public ${viewport.width}x${viewport.height}: booking`)
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
  phase(`public ${viewport.width}x${viewport.height}: context cleanup`)
  await bounded(context.close(), `public ${viewport.width}x${viewport.height} context.close`)
}

async function verifyNormalMotionGalleryKeyboard(browser) {
  phase('normal-motion gallery: create context')
  const context = await browser.newContext({
    viewport: { width: 2400, height: 900 },
    reducedMotion: 'no-preference',
    hasTouch: true,
  })
  context.setDefaultTimeout(WAIT_TIMEOUT)
  context.setDefaultNavigationTimeout(WAIT_TIMEOUT)
  const page = await context.newPage()
  await installGalleryFixtures(page)

  phase('normal-motion gallery: goto')
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: WAIT_TIMEOUT })
  await page.locator('#root > :first-child').waitFor({ timeout: WAIT_TIMEOUT })
  await waitForFonts(page)
  await page.locator('#om-oss').scrollIntoViewIfNeeded({ timeout: WAIT_TIMEOUT })
  await waitForGalleryToSettle(page)
  await scrollMarqueeRowIntoView(page, 0)

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
  phase('normal-motion gallery: create CDP session')
  const client = await page.context().newCDPSession(page)
  const y = rowBox.y + rowBox.height / 2
  await runCdpTouchSequence(
    client,
    'normal-motion gallery',
    { x: startX, y, radiusX: 1, radiusY: 1, force: 1, id: 88 },
    Array.from({ length: 12 }, (_, index) => ({
      x: startX + ((endX - startX) * (index + 1)) / 12,
      y,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: 88,
    })),
  )

  phase('normal-motion gallery: focus re-anchor')
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
  phase('normal-motion gallery: context cleanup')
  await bounded(context.close(), 'normal-motion gallery context.close')
}

async function verifyStaticEndpoints(page) {
  for (const path of ['/robots.txt', '/sitemap.xml', '/privacy']) {
    phase(`static endpoint ${path}`)
    const response = await page.request.get(`${baseUrl}${path}`, { timeout: WAIT_TIMEOUT })
    assert(response.status() === 200, `${path} status ${response.status()}`)
  }
}

/** Authenticated browser gate against a real local Worker + Edge + PostgreSQL. No provider sends. */
async function verifyCustomerBrowser() {
  phase('customer: inspect local stack')
  const stack = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '--output', 'json'], { encoding: 'utf8' }),
  )
  for (const value of [stack.API_URL, stack.DB_URL]) {
    assert(
      ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname),
      'customer browser gate requires loopback Supabase',
    )
  }
  const work = mkdtempSync(join(tmpdir(), 'knc-customer-e2e-'))
  const assets = join(work, 'dist'),
    key = join(work, 'localhost.key'),
    cert = join(work, 'localhost.crt')
  const port = Number(process.env.CUSTOMER_E2E_PORT ?? '4197')
  const workerPort = Number(process.env.CUSTOMER_E2E_WORKER_PORT ?? '8797')
  assert(
    Number.isInteger(port) && Number.isInteger(workerPort) && port !== workerPort,
    'distinct local test ports required',
  )
  const origin = `https://127.0.0.1:${port}`,
    workerOrigin = `https://127.0.0.1:${workerPort}`
  const secret =
    process.env.CUSTOMER_GATEWAY_SECRET ?? 'ci-customer-gateway-secret-not-for-production'
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: `${origin}/__supabase`,
    LOCAL_SUPABASE_URL: stack.API_URL,
    VITE_SUPABASE_ANON_KEY: stack.ANON_KEY,
    VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    CUSTOMER_GATEWAY_PROXY_URL: workerOrigin,
    LOCAL_WORKER_DOCUMENTS: '1',
    LOCAL_HTTPS_KEY: key,
    LOCAL_HTTPS_CERT: cert,
  }
  let failed = false,
    failure
  const retainFailure = (error) => {
    if (!failed) {
      failed = true
      failure = error
    }
  }
  const children = []
  const stopChildren = () => {
    for (const child of children)
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          /* already stopped */
        }
      }
  }
  process.on('exit', stopChildren)
  const db = new Client({ connectionString: stack.DB_URL, connectionTimeoutMillis: 5000 })
  let connected = false,
    fixture
  let cms
  // Hosted Supabase adds its own bot cookie. Preserve separate upstream headers so this gate
  // reproduces production: a Worker using Headers.get would merge Domain=supabase.co into our
  // __Host cookie and every real browser would reject the customer session.
  const upstream = createHttpServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const headers = new globalThis.Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined && !['host', 'connection', 'content-length'].includes(name)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
      }
      const result = await fetch(`${stack.API_URL}${request.url}`, {
        method: request.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        redirect: 'manual',
      })
      response.statusCode = result.status
      const cookies = result.headers.getSetCookie()
      for (const [name, value] of result.headers) {
        if (
          ![
            'set-cookie',
            'content-encoding',
            'content-length',
            'transfer-encoding',
            'connection',
          ].includes(name)
        ) {
          response.setHeader(name, value)
        }
      }
      if (request.url?.startsWith('/functions/v1/')) {
        cookies.push(
          '__cf_bm=local-provider-fixture; HttpOnly; Secure; Path=/; Domain=supabase.co; Expires=Thu, 10 Sep 2037 22:19:54 GMT',
        )
      }
      if (cookies.length) response.setHeader('Set-Cookie', cookies)
      response.end(Buffer.from(await result.arrayBuffer()))
    } catch {
      response.statusCode = 502
      response.end('Local upstream unavailable')
    }
  })
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const removeQueuedMail = async (emails) =>
    db.query(
      `delete from public.external_action_jobs
    where action_type='customer_access_email_send' and payload->>'challenge_id' in (
      select id::text from public.customer_booking_access_challenges where email=any($1))`,
      [emails],
    )
  const cleanupFixture = async () => {
    if (!fixture) return
    await db.query('begin')
    try {
      await db.query('set local session_replication_role=replica')
      await removeQueuedMail(fixture.people.map((person) => person.email))
      for (const table of [
        'customer_booking_access_sessions',
        'customer_booking_access_challenges',
        'customer_booking_access_tokens',
      ]) {
        await db.query(`delete from public.${table} where email=any($1)`, [
          fixture.people.map((person) => person.email),
        ])
      }
      // This suite creates real bookings. Remove only its outbox/receipt children, including
      // those whose normal cascade is disabled by the fixture-cleanup transaction.
      await db.query(
        `delete from public.customer_booking_receipts where token_hash in (
        select r.receipt_hash from public.customer_booking_receipt_bookings r
        join public.bookings b on b.id=r.booking_id where b.barber_id=$1)`,
        [fixture.barber],
      )
      for (const table of [
        'customer_booking_receipt_bookings',
        'booking_email_delivery_jobs',
        'booking_reminders',
      ])
        await db.query(
          `delete from public.${table} where booking_id in (select id from public.bookings where barber_id=$1)`,
          [fixture.barber],
        )
      await db.query(
        `delete from public.external_action_jobs where payload->>'booking_id' in (select id::text from public.bookings where barber_id=$1)`,
        [fixture.barber],
      )
      if (fixture.attempts.length)
        await db.query('delete from public.booking_attempts where id=any($1)', [fixture.attempts])
      for (const table of ['bookings', 'services', 'barber_schedules'])
        await db.query(`delete from public.${table} where barber_id=$1`, [fixture.barber])
      await db.query('delete from public.barbers where id=$1', [fixture.barber])
      await db.query('commit')
      fixture = undefined
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  }
  const start = (name, args, childEnv = process.env) => {
    const fd = openSync(join(work, `${name}.log`), 'w', 0o600)
    const child = spawn(process.execPath, args, {
      env: childEnv,
      detached: true,
      stdio: ['ignore', fd, fd],
    })
    closeSync(fd)
    children.push(child)
    return child
  }
  const ready = async (url, child, name) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      assert(
        child.exitCode === null,
        `${name} exited before readiness: ${readFileSync(join(work, `${name}.log`), 'utf8')}`,
      )
      const ok = await new Promise((resolveReady) => {
        const req = httpsRequest(url, { rejectUnauthorized: false }, (response) => {
          response.resume()
          resolveReady(response.statusCode === 200)
        })
        req.on('error', () => resolveReady(false))
        req.setTimeout(1000, () => req.destroy())
        req.end()
      })
      if (ok) return
      await delay(100)
    }
    throw new Error(`${name} did not become ready`)
  }
  try {
    await db.connect()
    connected = true
    await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen))
    const upstreamAddress = upstream.address()
    assert(
      upstreamAddress !== null && typeof upstreamAddress === 'object',
      'upstream test port missing',
    )
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    phase('customer: build local frontend')
    execFileSync('npm', ['run', 'build', '--', '--outDir', assets, '--emptyOutDir'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    })
    const workerConfig = join(work, 'wrangler.jsonc')
    writeFileSync(
      workerConfig,
      JSON.stringify({
        name: 'knc-customer-browser',
        main: resolve('src/worker.ts'),
        compatibility_date: '2026-08-09',
        vars: { SUPABASE_URL: `http://127.0.0.1:${upstreamAddress.port}` },
        assets: {
          directory: assets,
          binding: 'ASSETS',
          run_worker_first: true,
          html_handling: 'none',
          not_found_handling: 'none',
        },
      }),
    )
    writeFileSync(
      join(work, '.dev.vars'),
      `SUPABASE_ANON_KEY=${stack.ANON_KEY}\nCUSTOMER_GATEWAY_SECRET=${secret}\n`,
      { mode: 0o600 },
    )
    phase('customer: start actual Worker and Vite preview')
    const worker = start('worker', [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--config',
      workerConfig,
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(workerPort),
      '--inspector-port',
      '0',
      '--local-protocol',
      'https',
      '--https-key-path',
      key,
      '--https-cert-path',
      cert,
      '--log-level',
      'error',
    ])
    const preview = start(
      'preview',
      [
        resolve('node_modules/vite/bin/vite.js'),
        'preview',
        '--outDir',
        assets,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      env,
    )
    await Promise.all([
      ready(`${workerOrigin}/robots.txt`, worker, 'worker'),
      ready(origin, preview, 'preview'),
    ])
    cms = await customerCmsFixture({ db, stack, origin, work })

    for (const engine of [chromium, firefox, webkit]) {
      phase(`customer ${engine.name()}: seed isolated fixtures`)
      const marker = randomUUID(),
        barber = `e2e-${marker.slice(0, 20)}`,
        service = randomUUID()
      const people = ['A', 'B'].map((label) => ({
        label,
        token: randomBytes(32).toString('hex'),
        booking: randomUUID(),
        name: `Customer ${label}`,
        phone: `070${String(randomBytes(4).readUInt32BE() % 10000000).padStart(7, '0')}`,
        email: `${label.toLowerCase()}-${marker}@example.test`,
      }))
      fixture = { barber, people, attempts: [] }
      await db.query('begin')
      try {
        await db.query('set local session_replication_role=replica')
        await db.query(
          "insert into public.barbers(id,name,ig,active,sort_order) values($1,'Customer E2E Barber','e2e',true,999)",
          [barber],
        )
        await db.query(
          "insert into public.services(id,barber_id,name,price,duration_min,active,sort_order,available_weekdays) values($1,$2,'Customer E2E Cut',100,30,true,0,ARRAY[0,1,2,3,4,5,6])",
          [service, barber],
        )
        await db.query(
          'insert into public.barber_schedules(barber_id,weekday,working,start_min,end_min) select $1,day,true,540,1080 from generate_series(0,6) day',
          [barber],
        )
        for (const [index, person] of people.entries()) {
          await db.query(
            `insert into public.bookings(id,barber_id,service_id,service_name,price,duration_min,start_at,end_at,customer_name,method,phone,email,lang,status)
            values($1,$2,$3,$4,100,30,date_trunc('day',now())+interval '90 days'+make_interval(hours => $8),
            date_trunc('day',now())+interval '90 days 30 minutes'+make_interval(hours => $8),$5,'email',$6,$7,'sv','confirmed')`,
            [
              person.booking,
              barber,
              service,
              `Customer ${person.label} appointment`,
              person.name,
              person.phone,
              person.email,
              10 + index,
            ],
          )
          await db.query(
            'insert into public.customer_booking_access_tokens(email,phone,token_hash,token_ciphertext) values($1,$2,$3,$4)',
            [person.email, person.phone, hash(person.token), `v1.${'a'.repeat(80)}`],
          )
        }
        await db.query('commit')
      } catch (error) {
        await db.query('rollback')
        throw error
      }
      const [a, b] = people
      const browser = await engine.launch({ timeout: WAIT_TIMEOUT })
      const showHistory = async (page, person) => {
        await page.getByRole('heading', { name: /kommande/i }).waitFor()
        await page
          .getByRole('button', { name: /Visa detaljer/ })
          .last()
          .click()
        await page
          .getByRole('dialog')
          .getByText(`Customer ${person.label} appointment`, { exact: false })
          .waitFor()
        assert(
          !(await page.getByRole('dialog').innerText()).includes(
            `Customer ${person.label === 'A' ? 'B' : 'A'} appointment`,
          ),
          'mixed customer histories',
        )
      }
      try {
        if (engine === chromium) {
          phase('customer: publish actual desktop/mobile CMS through the owner UI')
          await cms.publish(browser)
        }
        for (const width of [1280, 390]) {
          phase(`customer ${engine.name()} ${width}: permanent link and browser cookie`)
          const context = await browser.newContext({
            viewport: { width, height: 844 },
            ignoreHTTPSErrors: true,
            reducedMotion: 'reduce',
          })
          const page = await context.newPage()
          page.setDefaultTimeout(WAIT_TIMEOUT)
          await page.goto(`${origin}/${a.token}`, { waitUntil: 'domcontentloaded' })
          await cms.verify(page, width)
          await showHistory(page, a)
          assert(
            new URL(page.url()).pathname === '/' && !page.url().includes(a.token),
            'email credential remains in URL',
          )
          const cookie = (await context.cookies()).find(
            (item) => item.name === '__Host-bladeblend_customer_session',
          )
          assert(
            cookie?.httpOnly &&
              cookie.secure &&
              cookie.sameSite === 'Lax' &&
              cookie.domain === '127.0.0.1' &&
              cookie.path === '/',
            'browser did not accept the required first-party cookie',
          )
          assert(
            !(await page.evaluate(() =>
              globalThis.document.cookie.includes('bladeblend_customer_session'),
            )),
            'customer credential readable by JavaScript',
          )
          await page.getByRole('button', { name: 'Stäng', exact: true }).click()
          const dismiss = page.getByRole('button', { name: 'Avvisa valfri lagring', exact: true })
          if (await dismiss.isVisible()) await dismiss.click()
          await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
          await showHistory(page, a)
          await page.getByRole('button', { name: 'Stäng', exact: true }).click()
          await page.reload({ waitUntil: 'domcontentloaded' })
          await cms.verify(page, width)
          await page.screenshot({
            path: join(work, `cms-published-${engine.name()}-${width}.png`),
          })
          const dismissAgain = page.getByRole('button', {
            name: 'Avvisa valfri lagring',
            exact: true,
          })
          if (await dismissAgain.isVisible()) await dismissAgain.click()
          await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
          await showHistory(page, a)
          if (width === 1280) {
            phase(
              `customer ${engine.name()}: shared-cookie customer switch and real profile hydration`,
            )
            await page.getByRole('button', { name: 'Stäng', exact: true }).click()
            await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
            await page
              .getByTestId('booking-barber-option')
              .filter({ hasText: 'Customer E2E Barber' })
              .click()
            const date = new Date(Date.now() + 2 * 86400000)
            const fmt = (options) =>
              new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(
                date,
              )
            const dateLabel = `${fmt({ weekday: 'long' })} ${fmt({ day: 'numeric' })} ${fmt({ month: 'long' })} ${fmt({ year: 'numeric' })}`
            await page.getByRole('button', { name: dateLabel, exact: true }).click()
            await page
              .getByTestId('booking-service-option')
              .filter({ hasText: 'Customer E2E Cut' })
              .click()
            await page.getByRole('button', { name: '10:00', exact: true }).click()
            const fields = page.getByRole('dialog').locator('input')
            assert(
              (await fields.nth(0).inputValue()) === a.name &&
                (await fields.nth(1).inputValue()) === a.phone &&
                (await fields.nth(2).inputValue()) === a.email,
              'successful real session hydration did not populate customer A',
            )
            await fields.nth(0).fill('Typed name survives')
            await page.getByRole('button', { name: 'Stäng', exact: true }).click()
            const second = await context.newPage()
            second.setDefaultTimeout(WAIT_TIMEOUT)
            await second.goto(`${origin}/${b.token}`, { waitUntil: 'domcontentloaded' })
            await showHistory(second, b)
            await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
            await showHistory(page, b)
            await page.getByRole('button', { name: 'Stäng', exact: true }).click()
            await page.getByRole('button', { name: '10:00', exact: true }).click()
            assert(
              (await fields.nth(0).inputValue()) === 'Typed name survives' &&
                (await fields.nth(1).inputValue()) === b.phone &&
                (await fields.nth(2).inputValue()) === b.email,
              'verified customer B retained customer A auto-fill or erased typed input',
            )
          }
          await context.close()
        }
        for (const existingCookie of [false, true]) {
          phase(
            `customer ${engine.name()}: rejected cookie ${existingCookie ? 'replacement' : 'creation'}`,
          )
          const context = await browser.newContext({ ignoreHTTPSErrors: true })
          const page = await context.newPage()
          page.setDefaultTimeout(WAIT_TIMEOUT)
          let previous
          if (existingCookie) {
            await page.goto(`${origin}/${a.token}`, { waitUntil: 'domcontentloaded' })
            await showHistory(page, a)
            previous = (await context.cookies()).find(
              (item) => item.name === '__Host-bladeblend_customer_session',
            )
            assert(previous, 'old-cookie fixture did not establish an actual session')
          }
          await context.route('**/api/customer-bookings', async (route) => {
            const response = await route.fetch(),
              headers = response.headers()
            delete headers['set-cookie']
            await context.clearCookies()
            if (previous) await context.addCookies([previous])
            await route.fulfill({ response, headers })
          })
          await page.goto(`${origin}/${b.token}`, { waitUntil: 'domcontentloaded' })
          await page
            .getByText(
              'Den säkra åtkomsten kunde inte sparas. Öppna mejllänken igen. Kontrollera webbplatsens cookieinställningar om felet kvarstår.',
              { exact: true },
            )
            .waitFor()
          assert(
            (await page.getByRole('heading', { name: /kommande/i }).count()) === 0,
            'rejected session cookie exposed a customer history',
          )
          await context.close()
        }
        phase(`customer ${engine.name()}: two fresh tabs book and share one optional receipt`)
        const receiptContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          ignoreHTTPSErrors: true,
          reducedMotion: 'reduce',
        })
        const receiptPages = await Promise.all([receiptContext.newPage(), receiptContext.newPage()])
        // The supported cancellation cutoff reaches seven days. A fixed 11:00 appointment
        // three dates ahead can already be inside a 72-hour cutoff in an afternoon run.
        const bookingDate = new Date(Date.now() + 9 * 86400000)
        const datePart = (options, date = bookingDate) =>
          new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(
            date,
          )
        const bookingDateLabel = `${datePart({ weekday: 'long' })} ${datePart({ day: 'numeric' })} ${datePart({ month: 'long' })} ${datePart({ year: 'numeric' })}`
        const prepareBooking = async (page, person, time, consent) => {
          page.setDefaultTimeout(WAIT_TIMEOUT)
          await page.goto(origin, { waitUntil: 'domcontentloaded' })
          await cms.verify(page, page.viewportSize().width)
          const choose = page.getByRole('button', {
            name: consent ? 'Godkänn valfri lagring' : 'Avvisa valfri lagring',
            exact: true,
          })
          if (await choose.isVisible()) await choose.click()
          await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
          await page
            .getByTestId('booking-barber-option')
            .filter({ hasText: 'Customer E2E Barber' })
            .click()
          const monthFormat = { year: 'numeric', month: 'numeric' }
          if (datePart(monthFormat) !== datePart(monthFormat, new Date()))
            await page.getByRole('button', { name: 'Nästa månad', exact: true }).click()
          await page.getByRole('button', { name: bookingDateLabel, exact: true }).click()
          await page
            .getByTestId('booking-service-option')
            .filter({ hasText: 'Customer E2E Cut' })
            .click()
          await page.getByRole('button', { name: time, exact: true }).click()
          const fields = page.getByRole('dialog').locator('input:not([type="hidden"])')
          assert(
            (await fields.nth(0).inputValue()) === '' &&
              (await fields.nth(1).inputValue()) === '' &&
              (await fields.nth(2).inputValue()) === '',
            'device or unverified contact prefilled private customer data',
          )
          await fields.nth(0).fill(person.name)
          await fields.nth(1).fill(person.phone)
          await fields.nth(2).fill(person.email)
        }
        // Sequential preparation, simultaneous submit: both tabs start with no receipt cookie.
        await prepareBooking(receiptPages[0], a, '11:00', true)
        await prepareBooking(receiptPages[1], a, '11:30', true)
        assert(
          !(await receiptContext.cookies()).some(
            (item) => item.name === '__Host-bladeblend_booking_receipts',
          ),
          'fresh context unexpectedly has receipt',
        )
        const listFrom = (page) =>
          page.evaluate(async () =>
            (
              await fetch('/api/customer-bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list' }),
              })
            ).json(),
          )
        const submitBooking = async (page) => {
          const response = page.waitForResponse(
            (r) => new URL(r.url()).pathname === '/api/bookings' && r.request().method() === 'POST',
          )
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Boka tid', exact: true })
            .click()
          const body = await (await response).json()
          assert(body.ok === true, `real booking failed: ${body.error ?? 'invalid result'}`)
          // Track this fixture's exact IP-attempt rows without truncating unrelated local data.
          const attempts = await db.query(
            `select id from public.booking_attempts where created_at = (select created_at from public.bookings where id=$1) and ip_hash=$2`,
            [body.booking.id, hash('127.0.0.1' + 'ci-booking-ip-salt-not-for-production')],
          )
          fixture.attempts.push(...attempts.rows.map((row) => row.id))
          return body
        }
        const receipts = await Promise.all(receiptPages.map(submitBooking))
        for (const page of receiptPages)
          await page
            .getByText('Din bokning finns nu under Mina bokningar på den här enheten.', {
              exact: true,
            })
            .waitFor()
        const deviceCookie = (await receiptContext.cookies()).find(
          (item) => item.name === '__Host-bladeblend_booking_receipts',
        )
        assert(
          deviceCookie?.httpOnly &&
            deviceCookie.secure &&
            deviceCookie.sameSite === 'Lax' &&
            deviceCookie.path === '/' &&
            deviceCookie.domain === '127.0.0.1',
          'browser rejected/failed to protect optional receipt',
        )
        assert(
          receipts[0].receipt_proof === receipts[1].receipt_proof,
          'simultaneous first bookings lost their shared collection',
        )
        const receiptList = await listFrom(receiptPages[0])
        assert(
          receiptList.ok &&
            receiptList.authority === 'device' &&
            !('email' in receiptList) &&
            !('phone' in receiptList) &&
            !('name' in receiptList),
          'device receipt became verified identity',
        )
        assert(
          receiptList.bookings.length === 2 &&
            receipts.every((item) =>
              receiptList.bookings.some((booking) => booking.id === item.booking.id),
            ),
          'receipt omitted a concurrent booking or imported older email history',
        )
        await receiptPages[0]
          .getByRole('dialog')
          .getByRole('button', { name: 'Mina bokningar', exact: true })
          .click()
        await receiptPages[0]
          .getByText(
            'Här visas bokningar skapade på den här enheten. Öppna mejllänken för tidigare bokningar.',
            { exact: true },
          )
          .waitFor()
        assert(
          (await receiptPages[0].getByRole('button', { name: /Visa detaljer/ }).count()) === 2,
          'confirmation did not open both new bookings immediately',
        )
        const refused = await receiptPages[0].evaluate(
          async (bookingId) =>
            (
              await fetch('/api/customer-bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel', bookingId }),
              })
            ).json(),
          a.booking,
        )
        assert(refused.ok === false, 'device receipt cancelled an older booking at the same email')
        await receiptPages[0]
          .getByRole('button', { name: /Visa detaljer/ })
          .first()
          .click()
        await receiptPages[0]
          .getByRole('button', { name: 'Avboka tid', exact: true })
          .first()
          .click()
        const confirmCancel = receiptPages[0].getByRole('button', {
          name: 'Ja, avboka tid',
          exact: true,
        })
        const cancellationResponse = receiptPages[0].waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/customer-bookings' &&
            response.request().postDataJSON()?.action === 'cancel',
        )
        await confirmCancel.click()
        const cancellation = await (await cancellationResponse).json()
        assert(
          cancellation.ok === true,
          `device cancellation rejected: ${JSON.stringify(cancellation)}`,
        )
        await receiptPages[0].getByText('Tiden är avbokad.', { exact: true }).waitFor()
        assert(
          (await listFrom(receiptPages[0])).bookings.length === 1,
          'device cancellation did not persist',
        )

        phase(`customer ${engine.name()}: withdrawing optional storage removes only receipt access`)
        const preferencesPage = await receiptContext.newPage()
        await preferencesPage.goto(origin, { waitUntil: 'domcontentloaded' })
        // Live About content can move this footer between pointerdown and pointerup. This auth
        // scenario uses the real keyboard action; the About UI gate covers pointer interaction.
        const preferencesLink = preferencesPage.getByRole('link', {
          name: 'Hantera integritetsinställningar',
          exact: true,
        })
        await preferencesLink.focus()
        await preferencesPage.keyboard.press('Enter')
        await preferencesPage.getByRole('checkbox', { name: /Valfri lagring/ }).uncheck()
        const forgot = preferencesPage.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === '/api/customer-bookings' &&
            r.request().postDataJSON()?.action === 'forget_device',
        )
        await preferencesPage.getByRole('button', { name: 'Spara val', exact: true }).click()
        await forgot
        assert(
          !(await receiptContext.cookies()).some(
            (item) => item.name === '__Host-bladeblend_booking_receipts',
          ),
          'withdrawal retained optional credential',
        )
        assert(
          (await listFrom(preferencesPage)).error === 'access_denied',
          'withdrawal retained receipt authority',
        )
        assert(
          (
            await db.query(
              'select count(*)::int as count from public.bookings where id=any($1::uuid[])',
              [receipts.map((item) => item.booking.id)],
            )
          ).rows[0].count === 2,
          'withdrawal deleted customer bookings',
        )
        await receiptContext.close()

        phase(`customer ${engine.name()}: rejected consent still books without optional cookie`)
        const rejectedContext = await browser.newContext({
          ignoreHTTPSErrors: true,
          reducedMotion: 'reduce',
        })
        const rejectedPage = await rejectedContext.newPage()
        await prepareBooking(rejectedPage, b, '12:00', false)
        const rejectedBooking = await submitBooking(rejectedPage)
        await rejectedPage
          .getByText('Öppna länken i bekräftelsemejlet för att se dina bokningar.', { exact: true })
          .waitFor()
        assert(
          !rejectedBooking.receipt_proof &&
            !(await rejectedContext.cookies()).some(
              (item) => item.name === '__Host-bladeblend_booking_receipts',
            ),
          'rejected storage issued optional receipt',
        )
        assert(
          (await listFrom(rejectedPage)).error === 'access_denied',
          'rejected consent authenticated submitted contact',
        )
        await rejectedContext.close()

        phase(`customer ${engine.name()}: invalid link and rotation revocation`)
        const context = await browser.newContext({ ignoreHTTPSErrors: true })
        const page = await context.newPage()
        page.setDefaultTimeout(WAIT_TIMEOUT)
        await page.goto(`${origin}/${a.token}`, { waitUntil: 'domcontentloaded' })
        await showHistory(page, a)
        const fullSession = (await context.cookies()).find(
          (cookie) => cookie.name === '__Host-bladeblend_customer_session',
        )
        assert(fullSession !== undefined, 'verified customer session cookie missing')
        await page.evaluate(async () => {
          const response = await fetch('/api/customer-bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'forget_device' }),
          })
          if (!response.ok || (await response.json()).ok !== true)
            throw new Error('forget_device did not accept the verified-session request')
        })
        assert(
          (await context.cookies()).find((cookie) => cookie.name === fullSession.name)?.value ===
            fullSession.value && (await listFrom(page)).authority === 'verified',
          'forgetting optional device access revoked the full email session',
        )
        const invalid = await page.evaluate(async () =>
          (
            await fetch('/api/customer-bookings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'list', accessToken: 'f'.repeat(64) }),
            })
          ).json(),
        )
        assert(
          invalid.ok === false && invalid.error === 'access_denied',
          'invalid explicit link fell back to an old cookie',
        )
        const cross = await context.request.post(`${origin}/api/customer-bookings`, {
          headers: { Origin: 'https://attacker.example' },
          data: { action: 'list' },
        })
        assert(cross.status() === 403, 'cross-origin customer request was accepted')
        const replacement = randomBytes(32).toString('hex')
        await db.query('begin')
        try {
          await db.query('select public.rotate_customer_booking_access_token($1,$2,$3,$4,$5)', [
            a.email,
            hash(replacement),
            `v1.${'b'.repeat(80)}`,
            replacement,
            'sv',
          ])
          // The browser gate tests revocation, not provider sending. No mail job escapes this transaction.
          await removeQueuedMail([a.email])
          await db.query('commit')
        } catch (error) {
          await db.query('rollback')
          throw error
        }
        const revoked = await page.evaluate(async () =>
          (
            await fetch('/api/customer-bookings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'list' }),
            })
          ).json(),
        )
        assert(
          revoked.ok === false && revoked.error === 'access_denied',
          'rotation left old browser session authorized',
        )
        await page.goto(`${origin}/${replacement}`, { waitUntil: 'domcontentloaded' })
        await showHistory(page, a)
        await context.close()
        console.log(
          `Customer browser passed: ${engine.name()}, mobile/desktop, actual cookie/profile switch, blocked cookies, invalid link, rotation, concurrent first bookings, consent and device cancellation.`,
        )
      } catch (error) {
        retainFailure(error)
        console.error(`Customer browser failure: ${currentPhase}`)
        for (const context of browser.contexts())
          for (const page of context.pages()) {
            console.error(
              (
                await page
                  .locator('body')
                  .innerText({ timeout: 3000 })
                  .catch(() => '')
              ).slice(-1000),
            )
            await page
              .screenshot({ path: join(work, `${engine.name()}-failure.png`), timeout: 3000 })
              .catch(() => undefined)
          }
      } finally {
        try {
          await bounded(browser.close(), `customer ${engine.name()} browser.close`)
        } catch (error) {
          retainFailure(error)
        }
      }
      if (failed) break
      await cleanupFixture()
    }
  } catch (error) {
    retainFailure(error)
  } finally {
    upstream.closeAllConnections()
    await new Promise((resolveClose) => upstream.close(resolveClose))
    if (connected) {
      try {
        await cms?.cleanup()
      } catch (error) {
        retainFailure(error)
      }
      try {
        await cleanupFixture()
      } catch (error) {
        retainFailure(error)
      }
      try {
        await db.end()
      } catch (error) {
        retainFailure(error)
      }
    }
    stopChildren()
    const stopped = await Promise.allSettled(
      children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : bounded(
              new Promise((resolveExit) => child.once('exit', resolveExit)),
              'local test server cleanup',
              5000,
            ),
      ),
    )
    for (const result of stopped)
      if (result.status === 'rejected') {
        retainFailure(result.reason)
        for (const child of children)
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              /* already stopped */
            }
          }
      }
    process.removeListener('exit', stopChildren)
    console.log(`Customer browser diagnostics: ${work}`)
  }
  if (failed) throw failure
}

let browser
let testError
let failurePhase
try {
  if (process.argv.includes('--customer')) {
    await verifyCustomerBrowser()
  } else {
    phase('browser launch')
    browser = await chromium.launch({ timeout: WAIT_TIMEOUT })
    phase('public desktop')
    await verifyPublicPage(browser, { width: 1280, height: 900 })
    phase('public mobile')
    await verifyPublicPage(browser, { width: 390, height: 844 })
    phase('normal-motion gallery')
    await verifyNormalMotionGalleryKeyboard(browser)
    phase('static endpoints')
    const page = await browser.newPage()
    await verifyStaticEndpoints(page)
    phase('static endpoint page cleanup')
    await bounded(page.close(), 'static endpoint page.close')
    console.log('Browser smoke passed: desktop, mobile, assets, booking, my-bookings, discovery.')
  }
} catch (error) {
  testError = error
  failurePhase = currentPhase
  throw error
} finally {
  if (browser !== undefined) {
    try {
      phase('browser cleanup')
      await bounded(browser.close(), 'browser.close')
    } catch (error) {
      writeSync(
        2,
        `[browser-smoke cleanup] ${describeError(error)}; original=${testError === undefined ? 'none' : `${describeError(testError)} (phase: ${failurePhase})`}\n`,
      )
      process.exit(1)
    }
  }
  globalThis.clearTimeout(watchdog)
}
