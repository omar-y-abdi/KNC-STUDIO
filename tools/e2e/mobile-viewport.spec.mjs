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
              const top = globalThis.getComputedStyle(surface.firstElementChild).backgroundColor
              const page = globalThis.getComputedStyle(
                view === 'home' ? surface.firstElementChild : surface,
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
    await toggle.click()
    await assertPaint('dark', 'booking')
    await page.getByRole('button', { name: 'Till startsidan' }).click()
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
      await expect(frame.locator('..')).toHaveCSS('min-height', '65px')
      await page.evaluate(() => globalThis.completeWidget())
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await assertFit()
      expect(visibleHeight - (await dialog.boundingBox()).height).toBeGreaterThan(50)
      await page.screenshot({ path: `${evidenceDir}/details-invisible-success.png` })
      await page.evaluate(() => globalThis.failWidget())
      await expect(dialog.getByRole('alert')).toHaveCount(1)
      await expect(frame.locator('..')).toHaveCSS('min-height', '0px')
      await dialog.getByRole('button', { name: 'Försök igen', exact: true }).click()
      await expect(frame.locator('..')).toHaveCSS('min-height', '65px')
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
  test(`mobile edge sampling avoids cached fullscreen sticky colors (${stored ? 'stored' : 'source'})`, async ({
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
    const edges = () =>
      page.evaluate(() => {
        // WebKit LocalFrameView::fixedContainerEdges: 4px inset; 0.9/1.05 size comparisons.
        // This models candidate classification, not Safari's private UI color extension itself.
        const sample = (bottom) => {
          let element = globalThis.document.elementFromPoint(
            globalThis.innerWidth / 2,
            bottom ? globalThis.innerHeight - 4 : 4,
          )
          while (element) {
            const style = globalThis.getComputedStyle(element)
            if (style.backdropFilter && style.backdropFilter !== 'none') return { backdrop: true }
            if (['fixed', 'sticky'].includes(style.position) && Number(style.opacity) > 0) {
              const box = element.getBoundingClientRect()
              const compare = (length, viewport) =>
                length < (viewport - 8) * 0.9
                  ? 'smaller'
                  : length < (viewport - 8) * 1.05
                    ? 'similar'
                    : 'larger'
              const width = compare(box.width, globalThis.innerWidth)
              const height = compare(box.height, globalThis.innerHeight)
              if (width !== 'smaller' && height !== 'larger')
                return {
                  viewportSized: width === 'similar' && height === 'similar',
                  color: style.backgroundColor,
                }
            }
            element = element.parentElement
          }
          return null
        }
        return { top: sample(false), bottom: sample(true) }
      })
    const assertTheme = async (color) => {
      await expect.poll(edges).toEqual({ top: { viewportSized: false, color }, bottom: null })
    }
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
              headerTop: Math.round(panel.firstElementChild.getBoundingClientRect().top),
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
      await assertTheme('rgb(244, 243, 240)')
    }
    await page.getByRole('button', { name: 'Boka tid', exact: true }).click()
    await toggle.click()
    await assertTheme('rgb(36, 36, 39)')
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
          headerTop: Math.round(panel.firstElementChild.getBoundingClientRect().top),
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
    await expect.poll(edges).toEqual({ top: { backdrop: true }, bottom: { backdrop: true } })
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
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto(`${harnessOrigin}/?mode=dark`)
    await toggle.waitFor()
    const fullStickyFrames = await page.evaluate(async () => {
      const book = [...globalThis.document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Boka tid',
      )
      return new Promise((resolve) => {
        let frames = 0
        let fullscreen = 0
        book.click()
        const inspect = () => {
          const panel = globalThis.document.querySelector('[data-knc-fold="panel"]')
          const height = panel.getBoundingClientRect().height
          if (
            globalThis.getComputedStyle(panel).position === 'sticky' &&
            height >= (globalThis.innerHeight - 8) * 0.9 &&
            height < (globalThis.innerHeight - 8) * 1.05
          )
            fullscreen++
          if (++frames < 20) globalThis.requestAnimationFrame(inspect)
          else resolve(fullscreen)
        }
        globalThis.requestAnimationFrame(inspect)
      })
    })
    expect(fullStickyFrames).toBe(0)
    await page.getByTestId('booking-barber-option').first().waitFor()
  })
