// PAR-18 "stored" homepage pixel guard (R11). The hydrated homepage is rendered from the committed
// rev-56 presentation (tools/e2e/fixtures/presentation.json.gz) and the entities it was captured
// from, then compared with stored baselines. visual.spec.mjs stays the code-fallback guard (empty
// presentation); this spec guards what the CMS output looks like.
//
// Determinism without masking. Playwright's fake clock is installed before navigation, runs while
// the page boots, then is paused. Afterwards fake time only advances in single 16 ms frames that
// this spec issues, while every moving part is parked:
//  - a gallery marquee row runs its rAF loop only while it intersects the viewport, and its first
//    frame never moves it. About data is loaded with only the section's first 40 px on screen, so
//    the galleries are below the fold, and an element shot issues one frame after scrolling.
//  - the mobile barber carousel (Embla AutoScroll) waits 800 ms of fake time before it scrolls; a
//    test may spend at most MAX_FRAMES (640 ms) after the pause.
// Lazy images load while the spec scrolls through the page with the clock paused: nothing moves.
// Every shot that includes About asserts that About is loaded right before it and right after it
// (aboutShot), so a section that fell back to its loading state fails the run and is never written
// as a baseline by --update-snapshots.
//
// The mobile site scrolls inside a fixed-height shell, so its full page is the hero alone. 390 px is
// covered in viewport steps instead: the hero as a returning visitor sees it, then shell positions
// that bring each next stretch of the homepage below the compact panel, down to its end. One frame
// at the first step lets the panel collapse (mobileFold); later steps keep that collapse and get no
// frame, so no gallery row gets past its first, motionless tick.
//
// Reduced motion changes the resting layout in one place only: the mobile barber strip becomes a
// native scroll-snap row instead of an Embla loop (useBarberMarquee: `animate` needs
// !reducedMotion). Every other reduced-motion difference is a transition, which has no effect at
// rest. So the reduced-motion variant is the 390 px barber strip alone.

import { test, expect } from './fixtures.mjs'
import { installStoredBackend } from './public-fixtures.mjs'
import { publicOrigin } from './origins.mjs'

const base = publicOrigin
const CLOCK_START = new Date('2026-09-14T08:00:00Z')
const CLOCK_PAUSE = new Date('2026-09-14T08:05:00Z')
const FRAME_MS = 16
const MAX_FRAMES = 40
const POLL_MS = 50
const POLL_TIMEOUT_MS = 15_000
const ABOUT_PEEK_PX = 40
const MOBILE_MAX_WIDTH = 768
// PANEL_COMPACT in src/app/shared.ts: the mobile panel's height once the hero has folded away.
const COMPACT_PANEL_PX = 112
const CONSENT_COOKIE = 'bladeblend_storage_preferences'
const SNAPSHOT = {
  // The existing pixelmatch policy of visual.spec.mjs. 'disabled' finishes CSS transitions, so the
  // final paint is compared; rAF-driven motion is held by the paused clock instead.
  threshold: 0.1,
  maxDiffPixelRatio: 0.001,
  animations: 'disabled',
  caret: 'hide',
  scale: 'css',
}
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const VIEWPORTS = [MOBILE_VIEWPORT, { width: 800, height: 900 }, { width: 1280, height: 900 }]
const BARBER_STRIP = '#om-oss [data-knc-fold="barber-marquee"]'
// The salon gallery: the GalleryMarquee root that holds the first two marquee rows. Each row sits
// in a display:contents slot wrapper, which has no box to screenshot.
const SALON_GALLERY =
  '#om-oss [data-testid="marquee-row"] >> nth=0 >> xpath=ancestor::div[not(@data-knc-slot)][1]'
const ABOUT_PARTS = [
  { part: 'barbers', selector: BARBER_STRIP },
  { part: 'gallery', selector: SALON_GALLERY },
]

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

/** Real-time poll from Node: page timers are fake and paused, so the page cannot poll itself. */
async function pollUntil(page, check, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (!(await page.evaluate(check))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await sleep(POLL_MS)
  }
}

/** Fake frames after the pause, capped so the barber carousel's 800 ms start delay never elapses. */
function frameBudget(page) {
  let used = 0
  const step = async (waitingFor) => {
    used += 1
    if (used > MAX_FRAMES)
      throw new Error(
        `Fake-time budget exceeded: ${used} frames of ${FRAME_MS} ms` +
          (waitingFor === undefined ? '' : ` while waiting for ${waitingFor}`),
      )
    await page.clock.runFor(FRAME_MS)
    await sleep(POLL_MS)
  }
  const stepUntil = async (check, label) => {
    while (!(await page.evaluate(check))) await step(label)
  }
  return { step, stepUntil }
}

async function openStoredHome(page, context, { lang, returningVisitor }) {
  await installStoredBackend(context)
  if (returningVisitor)
    await context.addCookies([{ name: CONSENT_COOKIE, value: 'essential', url: base }])
  await page.clock.install({ time: CLOCK_START })
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const english = page.getByRole('button', { name: 'Byt språk till engelska', exact: true })
  await english.waitFor({ state: 'visible', timeout: 15_000 })
  if (lang === 'en') {
    await english.click()
    await page
      .getByRole('button', { name: 'Switch language to Swedish', exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 })
  }
  await page.evaluate(() => globalThis.document.fonts.ready)
  await page.clock.pauseAt(CLOCK_PAUSE)
  return frameBudget(page)
}

// Each page function finds the homepage scroller itself (evaluate cannot close over helpers):
// the mobile shell's container, or the document on desktop.
async function scrollHomeTo(page, top) {
  await page.evaluate((next) => {
    const root =
      globalThis.document.querySelector('[data-testid="mobile-site-scroll"]') ??
      globalThis.document.scrollingElement
    root.scrollTop = next
  }, top)
}

/** Put the About section's first `peek` px on screen; the galleries stay below the fold. */
async function peekAbout(page) {
  await page.evaluate((peek) => {
    const shell = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
    const root = shell ?? globalThis.document.scrollingElement
    const bottom = shell === null ? globalThis.innerHeight : shell.getBoundingClientRect().bottom
    const top = globalThis.document.getElementById('om-oss').getBoundingClientRect().top
    root.scrollTop += top - bottom + peek
  }, ABOUT_PEEK_PX)
}

function aboutLoaded() {
  const section = globalThis.document.getElementById('om-oss')
  if (section === null) return false
  const cards = section.querySelector('[data-knc-fold="barber-marquee"]')?.children.length ?? 0
  const tracks = [...section.querySelectorAll('[data-testid="marquee-track"]')]
  return (
    cards === 4 &&
    tracks.length === 4 &&
    tracks.every((track) => track.children.length > 0) &&
    section.querySelector('p[aria-live]') === null
  )
}

async function expectAboutLoaded(page, moment) {
  expect(await page.evaluate(aboutLoaded), `About is loaded ${moment} the screenshot`).toBe(true)
}

/**
 * About's data gate opens from an IntersectionObserver that an effect attaches, and effects run only
 * on a frame of the paused clock: a remount after the last frame stays in the loading state. The
 * check before the shot keeps that state out of a baseline; the one after it catches a revert while
 * the capture ran, which --update-snapshots would otherwise write.
 */
async function aboutShot(page, shoot) {
  await expectAboutLoaded(page, 'before')
  await shoot()
  await expectAboutLoaded(page, 'after')
}

async function settleImages(page) {
  await pollUntil(
    page,
    () =>
      [...globalThis.document.images].every((image) => image.complete && image.naturalWidth > 0),
    'every image to load',
  )
  await page.evaluate(() =>
    Promise.all([...globalThis.document.images].map((image) => image.decode())),
  )
}

/** Visit every scroll position with the clock paused so lazy images load, then wait for decode. */
async function loadLazyImages(page) {
  const { height, step } = await page.evaluate(() => {
    const root =
      globalThis.document.querySelector('[data-testid="mobile-site-scroll"]') ??
      globalThis.document.scrollingElement
    return { height: root.scrollHeight, step: root.clientHeight }
  })
  for (let top = 0; top < height + step; top += step) {
    await scrollHomeTo(page, top)
    await sleep(POLL_MS)
  }
  await settleImages(page)
}

/** Load About data with the marquees parked, then every image. Leaves the page scrolled. */
async function hydrateAbout(page, frames) {
  await peekAbout(page)
  await frames.stepUntil(aboutLoaded, 'About to load')
  // Effects that follow the last data render (the mobile carousel attaches in one) get fixed frames.
  for (let frame = 0; frame < 3; frame++) await frames.step()
  await loadLazyImages(page)
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark']) {
    for (const lang of ['sv', 'en']) {
      const name = `stored-${viewport.width}-${scheme}-${lang}.png`
      test.describe(name, () => {
        test.use({ viewport, colorScheme: scheme, deviceScaleFactor: 1 })
        test('stored homepage, full page', async ({ page, context }) => {
          const frames = await openStoredHome(page, context, { lang, returningVisitor: false })
          // The mobile shell is exactly one viewport tall and About starts below it, so its full
          // page is the hero; the viewport steps below cover the rest. Desktop scrolls the
          // document, so its full page includes About once the section has loaded.
          const shoot = () => expect(page).toHaveScreenshot(name, { ...SNAPSHOT, fullPage: true })
          if (viewport.width > MOBILE_MAX_WIDTH) {
            await hydrateAbout(page, frames)
            await scrollHomeTo(page, 0)
            await aboutShot(page, shoot)
          } else {
            await settleImages(page)
            await shoot()
          }
        })
      })
    }
  }
}

/**
 * Shell positions that show every part of the homepage below the folded panel once: the first puts
 * the top of About just below it, each next one the following stretch, the last the page's end.
 */
async function shellSteps(page) {
  return page.evaluate((panel) => {
    const shell = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
    const visible = shell.clientHeight - panel
    const end = shell.scrollHeight - shell.clientHeight
    const steps = []
    for (let top = visible; top < end; top += visible) steps.push(top)
    return [...steps, end]
  }, COMPACT_PANEL_PX)
}

for (const scheme of ['light', 'dark']) {
  for (const lang of ['sv', 'en']) {
    const name = `stored-390-${scheme}-${lang}-step`
    test.describe(name, () => {
      test.use({ viewport: MOBILE_VIEWPORT, colorScheme: scheme, deviceScaleFactor: 1 })
      test('stored mobile homepage, viewport steps', async ({ page, context }) => {
        const frames = await openStoredHome(page, context, { lang, returningVisitor: true })
        await settleImages(page)
        await expect.soft(page).toHaveScreenshot(`${name}-0.png`, SNAPSHOT)
        await hydrateAbout(page, frames)
        const steps = await shellSteps(page)
        test.info().annotations.push({ type: 'shell steps', description: steps.join(', ') })
        for (const [index, top] of steps.entries()) {
          await scrollHomeTo(page, top)
          if (index === 0) await frames.step()
          await aboutShot(page, () =>
            expect.soft(page).toHaveScreenshot(`${name}-${index + 1}.png`, SNAPSHOT),
          )
        }
      })
    })
  }
}

/**
 * The element's box cut to the viewport, rounded outwards as an element screenshot rounds it. The
 * mobile barber carousel is full-bleed and its box starts 12 px left of the viewport; an element
 * screenshot of that box captures the top of the viewport instead of the element.
 */
async function onScreenClip(page, element) {
  const box = await element.boundingBox()
  if (box === null) throw new Error('The About element is not rendered')
  const viewport = page.viewportSize()
  const left = Math.max(0, Math.floor(box.x))
  const top = Math.max(0, Math.floor(box.y))
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width))
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * A returning visitor (storage choice made, so no privacy notice) scrolls the element to the
 * centre. One frame lets the mobile panel follow the scroll; a gallery row that came on screen
 * gets its first, motionless frame and no second one.
 */
async function aboutElementShot(page, context, { lang, selector, name }) {
  const frames = await openStoredHome(page, context, { lang, returningVisitor: true })
  await hydrateAbout(page, frames)
  const element = page.locator(selector)
  await element.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await frames.step()
  const clip = await onScreenClip(page, element)
  await aboutShot(page, () => expect(page).toHaveScreenshot(name, { ...SNAPSHOT, clip }))
}

// The moving parts on their own, centred: every scheme and language at 390 px; light Swedish at
// 1280 px, whose full-page shots already show About in every combination.
const ABOUT_SHOTS = [
  ...['light', 'dark'].flatMap((scheme) =>
    ['sv', 'en'].map((lang) => ({ ...MOBILE_VIEWPORT, scheme, lang })),
  ),
  { width: 1280, height: 900, scheme: 'light', lang: 'sv' },
]
for (const shot of ABOUT_SHOTS) {
  for (const { part, selector } of ABOUT_PARTS) {
    const name = `stored-about-${part}-${shot.width}-${shot.scheme}-${shot.lang}.png`
    test.describe(name, () => {
      test.use({
        viewport: { width: shot.width, height: shot.height },
        colorScheme: shot.scheme,
        deviceScaleFactor: 1,
      })
      test('stored About element', async ({ page, context }) => {
        await aboutElementShot(page, context, { lang: shot.lang, selector, name })
      })
    })
  }
}

const REDUCED_MOTION = 'stored-about-barbers-390-light-sv-reduced-motion.png'
test.describe(REDUCED_MOTION, () => {
  test.use({
    viewport: MOBILE_VIEWPORT,
    colorScheme: 'light',
    deviceScaleFactor: 1,
    contextOptions: { reducedMotion: 'reduce' },
  })
  test('stored About element, reduced motion', async ({ page, context }) => {
    await aboutElementShot(page, context, {
      lang: 'sv',
      selector: BARBER_STRIP,
      name: REDUCED_MOTION,
    })
  })
})
