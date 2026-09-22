import { parse, walk, generate } from 'css-tree'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_BROWSER && process.env.CMS_BROWSER !== name) continue
  const browser = await engine.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    context.setDefaultTimeout(15000)
    const backend = await nativeBackend(context)
    const page = await context.newPage()
    const frame = page.frameLocator('.gjs-frame').first()
    const mount = async () => {
      await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
    }
    const publish = async () => {
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
      )
    }
    await mount()
    await page.getByRole('button', { name: 'Om oss', exact: true }).click()
    const reviews = frame.getByRole('heading', { name: 'Omdömen', exact: true })
    await reviews.click()
    const id = await reviews.getAttribute('id')
    await page
      .getByRole('button', { name: 'Flytta åt höger', exact: true })
      .click({ modifiers: ['Shift'] })
    await publish()
    const css = backend.document.presentation.pages.find((p) => p.path === '/about').content.sv.css
    let desktopRule = false
    walk(parse(css.light), {
      visit: 'Rule',
      enter(rule) {
        if (
          generate(rule.prelude) === `#${id}` &&
          generate(rule.block).includes('translate:10px 0px')
        )
          desktopRule = generate(this.atrule.prelude) === '(min-width:769px)'
      },
    })
    assert.ok(desktopRule, 'Desktop edits must apply above 768px, including wide screens')
    assert.match(css.dark, /translate:10px 0px/, 'Layout must survive a theme switch')
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame').clientWidth === 390,
    )
    assert.equal(
      await reviews.evaluate((n) => globalThis.getComputedStyle(n).translate),
      'none',
      'Desktop nudge must not move mobile',
    )
    await reviews.click()
    await page.getByRole('button', { name: 'Flytta åt vänster', exact: true }).click()
    await page
      .locator('#cms-inspector')
      .getByLabel('Text', { exact: true })
      .fill('Gemensamma omdömen')
    await publish()
    await page.getByRole('button', { name: 'Startsida', exact: true }).click()
    const homeReviews = frame
      .getByRole('heading', { name: 'Gemensamma omdömen', exact: true })
      .last()
    await homeReviews.waitFor({ state: 'attached' })
    // Use an actual wheel gesture in unlocked editing mode; no programmatic scrollIntoView.
    const canvas = await page.locator('.gjs-frame').boundingBox()
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + Math.min(260, canvas.height / 2))
    for (let i = 0; i < 7; i++) await page.mouse.wheel(0, 450)
    await page.waitForTimeout(500)
    assert.ok(
      await homeReviews.evaluate((n) => {
        const r = n.getBoundingClientRect()
        return r.top < globalThis.innerHeight && r.bottom > 0
      }),
      'Mobile editing must scroll to Reviews without locking',
    )
    await mount()
    await page.getByRole('button', { name: 'Om oss', exact: true }).click()
    assert.equal(await frame.locator(`#${id}`).textContent(), 'Gemensamma omdömen')
    assert.equal(
      await frame.locator(`#${id}`).evaluate((n) => globalThis.getComputedStyle(n).translate),
      '10px',
      'Desktop layout must survive reload',
    )
    // Simulate the server's initial CSS. The mounted app must take ownership so stale initial
    // rules cannot override a different theme/device after hydration.
    await context.route(`${base}/?*`, async (route) => {
      const response = await route.fetch()
      const html = (await response.text()).replace(
        '</head>',
        `<style id="cms-page-light">#${id}{translate:999px!important}</style><style id="cms-theme">:root{--knc-background:#ff0000}</style></head>`,
      )
      await route.fulfill({ response, body: html })
    })
    // Render through the real public App and native projection, not the editor HTML.
    for (const width of [390, 1440, 1920]) {
      for (const mode of ['light', 'dark']) {
        const publicPage = await context.newPage()
        await publicPage.setViewportSize({ width, height: 900 })
        await publicPage.goto(`${base}/?lang=sv&mode=${mode}`)
        await publicPage.locator(`#${id}`).waitFor({ state: 'attached' })
        assert.equal(await publicPage.locator(`#${id}`).textContent(), 'Gemensamma omdömen')
        assert.equal(
          await publicPage
            .locator(`#${id}`)
            .evaluate((n) => globalThis.getComputedStyle(n).translate),
          width < 769 ? '-1px' : '10px',
          `${width}px ${mode} public layout`,
        )
        await publicPage.close()
      }
    }
    await page.getByRole('button', { name: 'Webbplatsens stil', exact: true }).click()
    await page.getByLabel('Bakgrund hex', { exact: true }).fill('#f0e4d4')
    await page.getByLabel('Bakgrund hex', { exact: true }).press('Tab')
    await page.getByLabel('Text hex', { exact: true }).fill('#273749')
    await page.getByLabel('Text hex', { exact: true }).press('Tab')
    await page
      .getByRole('region', { name: 'Webbplatsens stilinställningar' })
      .getByLabel('Typsnitt', { exact: true })
      .selectOption('Georgia, serif')
    const themePreview = page.frameLocator('.cms-theme-preview iframe')
    await themePreview.locator('[data-knc-surface="desktop-home"]').waitFor()
    await page.waitForFunction(() => {
      const d = globalThis.document.querySelector('.cms-theme-preview iframe')?.contentDocument
      return (
        d &&
        d.defaultView.getComputedStyle(d.querySelector('[data-knc-surface="desktop-home"]'))
          .backgroundColor === 'rgb(240, 228, 212)'
      )
    })
    await page.screenshot({ path: `/tmp/cms-theme-${name}.png` })
    await publish()
    assert.equal(backend.document.presentation.themes.light.background, '#f0e4d4')
    for (const mode of ['light', 'dark']) {
      const live = await context.newPage()
      await live.goto(`${base}/?lang=sv&mode=${mode}`)
      const surface = live.locator('[data-knc-surface="desktop-home"]')
      await surface.waitFor()
      await live.waitForFunction(
        () => globalThis.document.querySelectorAll('[data-knc-surface]').length > 0,
      )
      assert.equal(
        await surface.evaluate((n) => globalThis.getComputedStyle(n).backgroundColor),
        mode === 'light' ? 'rgb(240, 228, 212)' : 'rgb(28, 28, 30)',
        `${mode} persisted global background`,
      )
      if (mode === 'light')
        assert.match(
          await surface.evaluate((n) => globalThis.getComputedStyle(n).fontFamily),
          /Georgia/,
        )
      await live.close()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.getByLabel('Bakgrund hex', { exact: true }).isVisible())
    assert.ok(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      'Style panel fits narrow screen',
    )
    await page.getByRole('button', { name: 'Återställ ljust tema', exact: true }).click()
    await publish()
    assert.deepEqual(backend.document.presentation.themes.light, {})
    console.log(
      `PASS ${name}: independent device layout, both themes, shared text, Home composition, unlocked mobile scrolling, published App at 390/1440/1920px`,
    )
  } finally {
    await browser.close()
  }
}
