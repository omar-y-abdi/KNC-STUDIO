import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import {
  installPublicBackend,
  installStoredBackend,
  storedPresentationResponse,
} from './public-fixtures.mjs'

const presentation = storedPresentationResponse().presentation

test.describe('mobile viewport chrome', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })

  test('explicit themes paint both viewport edges across home and booking', async ({
    page,
    context,
  }) => {
    await installStoredBackend(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=dark`)
    const toggle = page.getByRole('button', { name: 'Växla ljust/mörkt' })
    await toggle.waitFor()
    const assertPaint = async (mode, view) => {
      await expect
        .poll(() =>
          page.evaluate(
            ({ mode, view }) => {
              const root = globalThis.document.documentElement
              const body = globalThis.document.body
              const surface = globalThis.document.querySelector(
                `[data-knc-surface="mobile-${view}"]`,
              )
              if (!surface) return null
              const top = globalThis.getComputedStyle(
                surface.querySelector('[data-knc-fold="panel"]'),
              ).backgroundColor
              const page = globalThis.getComputedStyle(
                view === 'home' ? surface.querySelector('[data-knc-fold="panel"]') : surface,
              ).backgroundColor
              const metas = [...globalThis.document.querySelectorAll('meta[name="theme-color"]')]
              return {
                top,
                html: globalThis.getComputedStyle(root).backgroundColor,
                body: globalThis.getComputedStyle(body).backgroundColor,
                page,
                scheme: globalThis.getComputedStyle(root).colorScheme,
                declaredScheme: globalThis.document.querySelector('meta[name="color-scheme"]')
                  ?.content,
                themeMatches:
                  metas.length === 1 && !metas[0].hasAttribute('media') && metas[0].content === top,
                expected: mode,
              }
            },
            { mode, view },
          ),
        )
        .toEqual(
          expect.objectContaining({
            html:
              view === 'home'
                ? mode === 'light'
                  ? 'rgb(244, 243, 240)'
                  : 'rgb(36, 36, 39)'
                : mode === 'light'
                  ? 'rgb(255, 255, 255)'
                  : 'rgb(28, 28, 30)',
            body:
              view === 'home'
                ? mode === 'light'
                  ? 'rgb(244, 243, 240)'
                  : 'rgb(36, 36, 39)'
                : mode === 'light'
                  ? 'rgb(255, 255, 255)'
                  : 'rgb(28, 28, 30)',
            scheme: mode,
            declaredScheme: mode,
            themeMatches: true,
          }),
        )
    }
    await assertPaint('dark', 'home')
    await toggle.click()
    await assertPaint('light', 'home')
    await page.getByRole('button', { name: 'Boka tid', exact: true }).click()
    await assertPaint('light', 'booking')
    const scroll = page.getByTestId('mobile-site-scroll')
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(732)
    // Hit the already visible control. Locator auto-scroll can move an inner scroller to a
    // sticky descendant's normal-flow position before issuing the pointer event.
    const toggleBox = await toggle.boundingBox()
    expect(toggleBox.y).toBeGreaterThanOrEqual(0)
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(112)
    await page.mouse.click(toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2)
    await assertPaint('dark', 'booking')
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(732)
    const back = page.getByRole('button', { name: 'Till startsidan' })
    await back.focus()
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(732)
    await back.press('Enter')
    await assertPaint('dark', 'home')
  })
})

for (const mode of ['light', 'dark'])
  for (const stored of [false, true])
    test(`details content fits without a blank tail (${mode}, ${stored ? 'stored' : 'source'})`, async ({
      page,
      evidenceDir,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
      await page.evaluate(
        async ({ presentation, mode, stored }) => {
          const [
            { h, render },
            { DetailsDialog },
            { ConfirmationDialog },
            { Turnstile },
            { buildBookingStyles, palette },
            { bookingStrings },
            { NativeSiteProvider },
          ] = await Promise.all([
            import('/tools/e2e/admin-harness.tsx'),
            import('/modules/public-web/src/booking/DetailsDialog.tsx'),
            import('/modules/public-web/src/booking/ConfirmationDialog.tsx'),
            import('/modules/public-web/src/booking/Turnstile.tsx'),
            import('/modules/public-web/src/booking/bookingStyles.ts'),
            import('/modules/public-web/src/i18n/index.ts'),
            import('/modules/public-web/src/cms/NativeSurface.tsx'),
          ])
          const noop = () => undefined
          globalThis.widgetHeight = 65
          let widgetContainer
          globalThis.window.turnstile = {
            render(container, options) {
              const frame = globalThis.document.createElement('iframe')
              frame.title = 'Verifiering'
              frame.style.cssText = `width:300px;height:${globalThis.widgetHeight}px;border:0;display:block`
              widgetContainer = container
              frame.addEventListener(
                'load',
                () => {
                  const verify = frame.contentDocument.createElement('button')
                  verify.textContent = 'Verifiera'
                  verify.addEventListener('click', () => options.callback('fixture'))
                  frame.contentDocument.body.appendChild(verify)
                },
                { once: true },
              )
              container.appendChild(frame)
              globalThis.completeWidget = () => options.callback('fixture')
              globalThis.failWidget = () => options['error-callback']()
              return 'fixture'
            },
            remove: () => widgetContainer?.replaceChildren(),
          }
          globalThis.renderDetails = (errors = false, verifier = false, resetNonce = 0) => {
            const dialog = h(DetailsDialog, {
              cms: { surface: 'booking-details', lang: 'sv', mode },
              t: {
                ...bookingStrings('sv'),
                policy: bookingStrings('sv')
                  .policy.replace('{hours}', '24')
                  .replace('{businessName}', 'Blade & Blend Studio'),
              },
              s: buildBookingStyles(palette(mode === 'dark'), false, false),
              closeLabel: 'Stäng',
              sumBarber: 'k',
              sumWhen: 'Fredag 13 november, 09:00',
              sumService: 'Hårklippning',
              sumPrice: '350 kr',
              nameValue: '',
              phoneValue: '',
              emailValue: '',
              bookDisabled: false,
              fieldErrors: { name: errors, phone: errors, email: errors },
              submitError: errors ? 'Bokningen kunde inte genomföras. Försök igen.' : null,
              onName: noop,
              onPhone: noop,
              onEmail: noop,
              onBook: noop,
              onClose: noop,
              onBackdropClick: noop,
              turnstile: verifier
                ? h(Turnstile, { action: 'booking', lang: 'sv', onToken: noop, resetNonce })
                : null,
            })
            render(
              stored ? h(NativeSiteProvider, { presentation }, dialog) : dialog,
              globalThis.document.querySelector('#root'),
            )
          }
          globalThis.renderConfirmation = () => {
            const dialog = h(ConfirmationDialog, {
              cms: { surface: 'booking-confirmation', lang: 'sv', mode },
              t: bookingStrings('sv'),
              s: buildBookingStyles(palette(mode === 'dark'), false, false),
              closeLabel: 'Stäng',
              confirmSentLine: 'Bekräftelsen har skickats.',
              customerAccessNote: 'Hantera tiden via länken i ditt mejl.',
              sumBarber: 'k',
              sumWhen: 'Fredag 13 november, 09:00',
              sumService: 'Hårklippning',
              sumPrice: '350 kr',
              icsHref: '/calendar.ics',
              gcalHref: 'https://calendar.google.com/',
              mapsHref: 'https://maps.example/',
              showDirections: true,
              calRowHover: '',
              onReset: noop,
              onMyBookings: noop,
              myBookingsLabel: 'Mina bokningar',
              onBackdropClick: noop,
            })
            render(
              stored ? h(NativeSiteProvider, { presentation }, dialog) : dialog,
              globalThis.document.querySelector('#root'),
            )
          }
          globalThis.renderDetails(false, true)
        },
        { presentation, mode, stored },
      )
      const dialog = page.getByRole('dialog')
      const book = dialog.getByRole('button', { name: 'Boka tid', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('iframe[title="Verifiering"]')).toHaveCount(1)
      await page.evaluate(() => globalThis.document.fonts.ready)
      const assertFit = async () => {
        await book.scrollIntoViewIfNeeded()
        const metrics = await dialog.evaluate((card) => {
          card.scrollTop = card.scrollHeight
          const rect = card.getBoundingClientRect()
          const button = [...card.querySelectorAll('button')].at(-1).getBoundingClientRect()
          return {
            tail: rect.bottom - button.bottom,
            top: rect.top,
            bottom: rect.bottom,
            viewport: globalThis.innerHeight,
            overflow: globalThis.getComputedStyle(card).overflowY,
          }
        })
        expect(metrics.tail).toBeLessThanOrEqual(20)
        expect(metrics.tail).toBeGreaterThanOrEqual(0)
        expect(metrics.top).toBeGreaterThanOrEqual(0)
        expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewport)
        expect(metrics.overflow).toBe('auto')
        await expect(book).toBeInViewport()
      }
      const frame = dialog.locator('iframe[title="Verifiering"]')
      await expect(frame).toHaveCSS('height', '65px')
      const pendingHeight = (await dialog.boundingBox()).height
      await frame.scrollIntoViewIfNeeded()
      await expect(frame).toBeInViewport()
      const verify = dialog
        .frameLocator('iframe[title="Verifiering"]')
        .getByRole('button', { name: 'Verifiera' })
      await expect(verify).toBeVisible()
      // The dialog uses CSS zoom; translate iframe-local CSS coordinates into screen coordinates.
      const buttonPoint = await verify.evaluate((button) => {
        const box = button.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      })
      const frameBox = await frame.boundingBox()
      const scale = frameBox.width / 300
      await page.mouse.click(frameBox.x + buttonPoint.x * scale, frameBox.y + buttonPoint.y * scale)
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await expect(frame).toBeVisible()
      expect((await dialog.boundingBox()).height).toBeCloseTo(pendingHeight, 0)
      await assertFit()
      const visibleHeight = (await dialog.boundingBox()).height
      await page.evaluate(() => {
        globalThis.widgetHeight = 0
        globalThis.renderDetails(false, true, 1)
      })
      await expect(frame).toHaveCSS('height', '0px')
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await page.evaluate(() => globalThis.completeWidget())
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await assertFit()
      expect(visibleHeight - (await dialog.boundingBox()).height).toBeGreaterThan(50)
      await page.screenshot({ path: `${evidenceDir}/details-invisible-success.png` })
      await page.evaluate(() => globalThis.failWidget())
      await expect(dialog.getByRole('alert')).toHaveCount(1)
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await dialog.getByRole('button', { name: 'Försök igen', exact: true }).click()
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await page.evaluate(() => globalThis.completeWidget())
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await expect(dialog.getByRole('alert')).toHaveCount(0)
      await page.setViewportSize({ width: 320, height: 568 })
      await page.evaluate(() => globalThis.renderDetails(true, true, 1))
      await expect(dialog.getByRole('alert')).toHaveCount(4)
      await assertFit()
      // A shortened viewport exercises the scroll constraint used when browser UI/keyboard reduces room.
      await page.setViewportSize({ width: 390, height: 420 })
      await dialog.locator('input').last().focus()
      await assertFit()
      await page.evaluate(() => globalThis.renderConfirmation())
      const reset = dialog.getByRole('button', { name: 'Boka en ny tid', exact: true })
      await reset.scrollIntoViewIfNeeded()
      await expect(reset).toBeInViewport()
      await expect(
        dialog.getByRole('button', { name: 'Mina bokningar', exact: true }),
      ).toBeInViewport()
      expect(
        await dialog.evaluate((card) => {
          const box = card.getBoundingClientRect()
          return (
            box.top >= 0 &&
            box.bottom <= globalThis.innerHeight &&
            globalThis.getComputedStyle(card).overflowY === 'auto'
          )
        }),
      ).toBe(true)
    })

test('new live children keep source anchors without undoing owner edits', async ({ page }) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const [{ h, render }, { nativeTree, projectNativeTree }] = await Promise.all([
      import('/tools/e2e/admin-harness.tsx'),
      import('/modules/public-web/src/cms/NativeSurface.tsx'),
    ])
    const Runtime = () => h('span', null, 'verification')
    const source = (active) =>
      nativeTree(
        h(
          'main',
          null,
          h('p', { key: 'first' }, 'first'),
          active ? h(Runtime, { key: 'verification' }) : null,
          active ? h('p', { key: 'error' }, 'error') : null,
          h('button', { key: 'book', onClick: () => undefined }, 'book'),
          h('p', { key: 'deleted' }, 'deleted'),
          active ? h('p', { key: 'last' }, 'last') : null,
        ),
        'ordering',
      )
    const before = source(false)
    const capture = globalThis.document.createElement('div')
    render(before.tree, capture)
    const template = capture.firstElementChild.cloneNode(true)
    for (const element of [template, ...template.querySelectorAll('*')]) {
      element.setAttribute(
        'data-knc-baseline',
        JSON.stringify({
          children: JSON.stringify(
            [...element.children].map(
              (child) =>
                child.getAttribute('data-knc-source') ?? child.getAttribute('data-knc-slot'),
            ),
          ),
          text: element.children.length ? '' : element.textContent,
        }),
      )
    }
    const deleted = [...template.children].find((child) => child.textContent === 'deleted')
    deleted.remove()
    const book = template.querySelector('button')
    // The owner moved Book before First and inserted their own copy. Keep that ordering.
    template.prepend(book)
    const authored = globalThis.document.createElement('p')
    authored.textContent = 'owner copy'
    template.insertBefore(authored, book.nextSibling)
    const output = globalThis.document.createElement('div')
    render(projectNativeTree(source(true), template), output)
    return [...output.querySelector('main').children].map((child) => child.textContent)
  })
  expect(result).toEqual(['verification', 'error', 'book', 'owner copy', 'first', 'last'])
})

for (const stored of [false, true])
  test(`mobile theme toggles repaint the header while the sticky panel folds with the scroll (${stored ? 'stored' : 'source'})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await (stored ? installStoredBackend : installPublicBackend)(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=dark`)
    const toggle = page.getByRole('button', { name: 'Växla ljust/mörkt' })
    await toggle.waitFor()
    // The header inherits the folding panel's colour and never pins on its own. Once the panel is
    // folded, that inherited colour is what sits at the top edge of the viewport.
    const assertTheme = async (color, pinned = false) => {
      await expect
        .poll(() =>
          page.locator('[data-knc-fold="panel"]').evaluate((panel) => {
            const style = globalThis.getComputedStyle(
              panel.querySelector('[data-knc-fold="controls"]').parentElement,
            )
            return {
              position: style.position,
              top: style.top,
              bottom: style.bottom,
              color: style.backgroundColor,
            }
          }),
        )
        .toEqual(
          pinned
            ? { position: 'relative', top: '0px', bottom: '0px', color }
            : expect.objectContaining({ position: 'relative', top: '0px', bottom: '0px' }),
        )
    }
    await assertTheme('rgb(36, 36, 39)')
    const themeFrames = await page.evaluate(async () => {
      const root = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
      const toggle = globalThis.document.querySelector('[aria-label="Växla ljust/mörkt"]')
      toggle.click()
      const frames = []
      for (let i = 0; i < 5; i++) {
        await new Promise(globalThis.requestAnimationFrame)
        const header = globalThis.document.querySelector('[data-knc-fold="controls"]').parentElement
        frames.push({
          scroll: root.scrollTop,
          header: globalThis.getComputedStyle(header).backgroundColor,
          position: globalThis.getComputedStyle(header).position,
          body: globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
          html: globalThis.getComputedStyle(globalThis.document.documentElement).backgroundColor,
          scheme: globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme,
          theme: globalThis.document.querySelector('meta[name="theme-color"]').content,
        })
      }
      return frames
    })
    for (const frame of themeFrames)
      expect(frame).toEqual({
        scroll: 0,
        header: 'rgb(244, 243, 240)',
        position: 'relative',
        body: 'rgb(244, 243, 240)',
        html: 'rgb(244, 243, 240)',
        scheme: 'light',
        theme: stored ? 'rgb(244, 243, 240)' : '#f4f3f0',
      })
    await assertTheme('rgb(244, 243, 240)')
    await toggle.focus()
    await toggle.press('Space')
    await assertTheme('rgb(36, 36, 39)')
    await toggle.click()
    await assertTheme('rgb(244, 243, 240)')
    const scroll = page.getByTestId('mobile-site-scroll')
    for (const amount of [1, 100, 500, 732, 900, 0]) {
      await scroll.evaluate((element, amount) => {
        element.scrollTop = amount
      }, amount)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const panel = globalThis.document.querySelector('[data-knc-fold="panel"]')
            const spacer = globalThis.document.querySelector('[data-knc-fold="spacer"]')
            const root = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
            const box = panel.getBoundingClientRect()
            return {
              top: Math.round(box.top),
              headerTop: Math.round(
                panel
                  .querySelector('[data-knc-fold="controls"]')
                  .parentElement.getBoundingClientRect().top,
              ),
              height: Math.round(box.height),
              spacerBottom: Math.round(spacer.getBoundingClientRect().bottom),
              scroll: root.scrollTop,
            }
          }),
        )
        .toEqual({
          top: 0,
          headerTop: 0,
          height: Math.max(112, 844 - amount),
          spacerBottom: 844 - amount,
          scroll: amount,
        })
      await assertTheme('rgb(244, 243, 240)', amount > 0)
    }
    await page.getByRole('button', { name: 'Boka tid', exact: true }).click()
    await toggle.click()
    await assertTheme('rgb(36, 36, 39)', true)
    await page.getByRole('button', { name: 'Till startsidan' }).click()
    await toggle.click()
    await assertTheme('rgb(244, 243, 240)')
    await page
      .getByRole('button', { name: 'Hantera integritetsinställningar', exact: true })
      .click()
    await expect(page.locator('#privacy-preferences')).toBeVisible()
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await assertTheme('rgb(244, 243, 240)')
    await scroll.evaluate((element) => {
      element.scrollTop = 100
    })
    await expect
      .poll(() =>
        page.locator('[data-knc-fold="panel"]').evaluate((panel) => ({
          top: Math.round(panel.getBoundingClientRect().top),
          headerTop: Math.round(
            panel.querySelector('[data-knc-fold="controls"]').parentElement.getBoundingClientRect()
              .top,
          ),
          height: Math.round(panel.getBoundingClientRect().height),
        })),
      )
      .toEqual({ top: -100, headerTop: -100, height: 844 })
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await assertTheme('rgb(244, 243, 240)')
    await page.getByRole('button', { name: 'Spara val', exact: true }).click()
    await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Stäng', exact: true }).click()
    await assertTheme('rgb(244, 243, 240)')
    if (stored) {
      const custom = globalThis.structuredClone(storedPresentationResponse())
      custom.presentation.themes.light.surface = '#e9dfcc'
      custom.presentation.themes.dark.surface = '#303b4c'
      await context.route(
        (url) => url.pathname === '/api/cms/presentation',
        (route) => route.fulfill({ json: custom }),
      )
      await page.goto(`${harnessOrigin}/?mode=light`)
      await assertTheme('rgb(233, 223, 204)')
      await toggle.click()
      await assertTheme('rgb(48, 59, 76)')
    }
  })

for (const stored of [false, true])
  test(`Boka tid tweens the sticky panel to the compact header and scrolling back restores the hero (${stored ? 'stored' : 'source'})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' })
    await (stored ? installStoredBackend : installPublicBackend)(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=dark`)
    await page.getByRole('button', { name: 'Växla ljust/mörkt' }).waitFor()
    // Sample every animation frame from the click: the scroll position jumps to the fold limit at
    // once while the panel height tweens down to meet it and the hero fades underneath.
    const frames = await page.evaluate(async () => {
      const root = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
      const panel = root.querySelector('[data-knc-fold="panel"]')
      const hero = root.querySelector('[data-knc-fold="hero"]')
      const book = [...hero.querySelectorAll('button')].find(
        (button) => button.textContent === 'Boka tid',
      )
      const frames = []
      const start = globalThis.performance.now()
      book.click()
      while (globalThis.performance.now() - start < 1200) {
        await new Promise(globalThis.requestAnimationFrame)
        const style = globalThis.getComputedStyle(panel)
        const morph = root.querySelector('[data-knc-brand-runtime]')
        frames.push({
          at: globalThis.performance.now() - start,
          scroll: root.scrollTop,
          height: panel.getBoundingClientRect().height,
          properties: style.transitionProperty,
          durations: style.transitionDuration,
          hero: globalThis.getComputedStyle(hero).opacity,
          fade: globalThis.getComputedStyle(hero).transitionDuration,
          morph: morph ? globalThis.getComputedStyle(morph).display : 'none',
        })
      }
      return frames
    })
    expect(frames.length).toBeGreaterThan(10)
    for (const frame of frames) expect(frame.scroll).toBe(732)
    expect(frames[0].height).toBeGreaterThan(300)
    for (let index = 1; index < frames.length; index++)
      expect(frames[index].height).toBeLessThanOrEqual(frames[index - 1].height + 0.5)
    expect(frames.some((frame) => frame.height > 112 && frame.height < 844)).toBe(true)
    const compact = frames.findIndex((frame) => frame.height <= 112.5)
    expect(compact).toBeGreaterThan(0)
    expect(frames[compact].at).toBeGreaterThanOrEqual(250)
    // Firefox and WebKit snap the tweened height to eighth pixels, so the compact frame can land on
    // exactly 112.5, which Math.round would carry to 113; hold the compact threshold itself.
    for (const frame of frames.slice(compact))
      expect(Math.abs(frame.height - 112)).toBeLessThanOrEqual(0.5)
    expect(
      frames.some(
        (frame) => frame.properties.includes('height') && frame.durations.includes('0.66s'),
      ),
    ).toBe(true)
    expect(frames.at(-1).properties.includes('height')).toBe(false)
    expect(frames.some((frame) => frame.fade.includes('0.34s'))).toBe(true)
    expect(frames.some((frame) => Number(frame.hero) > 0 && Number(frame.hero) < 1)).toBe(true)
    expect(frames.some((frame) => frame.hero === '0' && frame.height > 112)).toBe(true)
    expect(frames.some((frame) => frame.height > 112 && frame.morph !== 'none')).toBe(true)
    const scroll = page.getByTestId('mobile-site-scroll')
    const panel = page.locator('[data-knc-fold="panel"]')
    const book = page
      .locator('[data-knc-fold="hero"]')
      .getByRole('button', { name: 'Boka tid', exact: true })
    await expect(page.getByTestId('booking-barber-option').first()).toBeAttached()
    await scroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect
      .poll(() => panel.evaluate((panel) => panel.getBoundingClientRect().bottom))
      .toBe(844)
    await expect(book).toBeVisible()
    await expect(page.locator('[data-knc-brand-runtime]')).toHaveCSS('display', 'none')
    await expect(page.getByTestId('booking-barber-option').first()).toBeAttached()
    await book.click()
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(732)
    await expect
      .poll(() => panel.evaluate((panel) => panel.getBoundingClientRect().height))
      .toBe(112)
  })
