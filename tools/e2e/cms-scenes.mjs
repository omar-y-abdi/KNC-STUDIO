import assert from 'node:assert/strict'
import fs from 'node:fs'
import { emptyDocument } from '../../shared/cms.ts'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_BROWSER && process.env.CMS_BROWSER !== name) continue
  const browser = await engine.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    })
    context.setDefaultTimeout(15000)
    const seed = emptyDocument()
    if (process.env.CMS_PRESENTATION_FILE)
      seed.presentation = JSON.parse(
        fs
          .readFileSync(process.env.CMS_PRESENTATION_FILE, 'utf8')
          .replaceAll('https://soktgawvexeumqvtyhda.supabase.co', 'https://admin-harness.invalid'),
      ).presentation
    const backend = await nativeBackend(context, seed)
    await context.route('https://challenges.cloudflare.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: 'window.turnstile={render:(_node,options)=>{queueMicrotask(()=>options.callback("local-test-token"));return "local"},remove:()=>{},reset:()=>{}}',
      }),
    )
    const page = await context.newPage()
    page.on('pageerror', (error) => console.error('PAGE_ERROR', error.message))
    const mount = async () => {
      await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    }
    try {
      await mount()
      const frame = page.frameLocator('.gjs-frame').first()
      await page.getByRole('button', { name: 'Bokning', exact: true }).click()
      for (const [scene, label] of [
        ['booking-options', 'Välj en dag'],
        ['booking-details', 'Dina uppgifter'],
        ['booking-confirmation', 'Tack — din tid är bokad!'],
      ]) {
        await page.getByLabel('Visa i editorn', { exact: true }).selectOption(scene)
        const text = frame.getByText(label, { exact: true })
        await text.waitFor({ state: 'visible' })
        if (scene === 'booking-options')
          await frame
            .getByRole('button', { name: '10:30', exact: true })
            .waitFor({ state: 'visible' })
        if (scene === 'booking-options') {
          await page.getByRole('button', { name: 'Mörk', exact: true }).click()
          await page.waitForTimeout(300)
          const colors = await frame
            .locator('[data-knc-surface="booking-options"]')
            .evaluate((n) => ({
              background: globalThis.getComputedStyle(n).backgroundColor,
              color: globalThis.getComputedStyle(n).color,
              font: globalThis.getComputedStyle(n).fontFamily,
            }))
          assert.equal(colors.background, 'rgb(28, 28, 30)')
          assert.equal(colors.color, 'rgb(245, 245, 247)')
          assert.ok(colors.font.includes('Inter'))
          await page.screenshot({ path: `/tmp/cms-scenes-${name}-dark-options.png` })
          await page.getByRole('button', { name: 'Ljus', exact: true }).click()
        }
        await text.click()
        await page
          .locator('#cms-inspector')
          .getByLabel('Text', { exact: true })
          .fill(`${label} CMS`)
        if (scene === 'booking-details') {
          await frame.getByPlaceholder('För- och efternamn', { exact: true }).click()
          await page
            .locator('#cms-inspector')
            .getByLabel('Platshållartext', { exact: true })
            .fill('Ditt fullständiga namn')
        }
      }
      await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
      await page.getByLabel('Visa i editorn', { exact: true }).selectOption('my-bookings-list')
      await frame.getByText('Kommande', { exact: true }).waitFor({ state: 'visible' })
      await frame.getByText('Barberare', { exact: true }).click()
      await page
        .locator('#cms-inspector')
        .getByLabel('Text', { exact: true })
        .fill('Din barberare CMS')
      await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
      )
      assert.equal(backend.writes.filter((x) => x === 'publish').length, 1)
      await mount()
      await page.getByRole('button', { name: 'Bokning', exact: true }).click()
      await page.getByLabel('Visa i editorn', { exact: true }).selectOption('booking-options')
      await frame.getByText('Välj en dag CMS', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Startsida', exact: true }).click()
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      const mobile = frame.locator('[data-knc-surface="mobile-home"]')
      const panel = mobile.locator('[data-knc-fold="panel"]')
      const mark = mobile.locator('[data-knc-fold="mark"]')
      await page.waitForFunction(
        () => globalThis.document.querySelector('.gjs-frame').clientWidth === 390,
      )
      const modelSnapshot = () =>
        page.evaluate(async () => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const editor = cmsGrapes.editors.at(-1)
          return {
            html: editor.getHtml({ cleanId: false }),
            css: editor.getCss({ keepUnusedStyles: true }),
          }
        })
      const beforeMotion = await modelSnapshot()
      const rect = await page.locator('.gjs-frame').boundingBox()
      await page.mouse.move(rect.x + rect.width / 2, rect.y + Math.min(200, rect.height / 2))
      for (let n = 0; n < 4; n++) await page.mouse.wheel(0, 400)
      await page.waitForTimeout(700)
      assert.equal(await mark.evaluate((n) => globalThis.getComputedStyle(n).opacity), '1')
      assert.ok(
        await panel.evaluate((n) => Math.abs(n.getBoundingClientRect().height - 112) < 2),
        'Editor header must fold to the same compact height',
      )
      assert.ok(await mobile.locator('[data-knc-fold="return"]').isVisible())
      assert.deepEqual(
        await modelSnapshot(),
        beforeMotion,
        'Scroll state must never enter the persisted editor model',
      )
      await mark.locator('text').first().click()
      await page
        .locator('#cms-inspector')
        .getByLabel('Text', { exact: true })
        .waitFor({ state: 'visible' })
      // Read-only runtime of the same selected scene must display the published edit too.
      await page.getByRole('button', { name: 'Bokning', exact: true }).click()
      await page.getByRole('button', { name: 'Dator', exact: true }).click()
      await page.getByLabel('Visa i editorn', { exact: true }).selectOption('booking-details')
      await page.getByRole('button', { name: 'Jämför', exact: true }).click()
      await page
        .frameLocator('iframe[title="Jämförelsevy"]')
        .getByText('Dina uppgifter CMS', { exact: true })
        .waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Jämför', exact: true }).click()
      await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
      await page
        .frameLocator('iframe[title="Förhandsvisning av sidan"]')
        .getByText('Dina uppgifter CMS', { exact: true })
        .waitFor({ state: 'visible' })
      // Independent real customer rows must consume the shared card template with unique IDs.
      await page.goto(base)
      await page.evaluate(async (presentation) => {
        const { h, render } = await import('/tools/e2e/admin-harness.tsx')
        const { NativeSiteProvider } = await import('/src/cms/NativeSurface.tsx')
        const { MyBookingsDialog } = await import('/src/mybookings/MyBookingsDialog.tsx')
        const { previewCustomerPort } = await import('/src/cms/PreviewPorts.ts')
        const port = {
          ...previewCustomerPort,
          list: async () => ({
            ok: true,
            authority: 'verified',
            profile: {
              name: 'Runtime customer',
              phone: '0701111111',
              email: 'runtime@example.test',
            },
            bookings: {
              past: [],
              upcoming: [1, 2].map((i) => ({
                id: `actual-${i}`,
                barber: { id: `runtime-${i}`, name: `Runtime barber ${i}`, ig: '' },
                serviceName: `Runtime service ${i}`,
                price: 420,
                durationMin: 45,
                start: new Date('2030-10-10T10:30:00'),
                whenLabel: `Runtime appointment ${i}`,
              })),
            },
          }),
        }
        render(
          h(
            NativeSiteProvider,
            { presentation },
            h(MyBookingsDialog, { mode: 'light', lang: 'sv', port, onClose: () => undefined }),
          ),
          globalThis.document.getElementById('root'),
        )
      }, backend.document.presentation)
      for (let i = 1; i <= 2; i++) {
        await page.getByRole('button', { name: `Runtime appointment ${i}` }).click()
        await page.getByText(`Runtime barber ${i}`, { exact: true }).waitFor()
        await page.getByText('Din barberare CMS', { exact: true }).waitFor()
      }
      const duplicates = await page.evaluate(() => {
        const ids = [...globalThis.document.querySelectorAll('[id]')].map((n) => n.id)
        return ids.filter((id, index) => ids.indexOf(id) !== index)
      })
      assert.deepEqual(duplicates, [])
      assert.ok(!(await page.locator('body').innerText()).includes('Exempelbarberare'))
      await page.evaluate(async (presentation) => {
        const { h, render } = await import('/tools/e2e/admin-harness.tsx')
        const { NativeSiteProvider } = await import('/src/cms/NativeSurface.tsx')
        const { BookingFlow } = await import('/src/booking/BookingFlow.tsx')
        const barber = { id: 'runtime-barber', name: 'Runtime barber', ig: 'runtime' }
        const service = { id: 'runtime-service', name: 'Runtime haircut', price: 420, dur: 45 }
        const port = {
          availability: async () => ['10:30'],
          submit: async (booking) => ({
            ok: true,
            booking,
            links: { icsHref: '#', gcalHref: '#', mapsHref: '#' },
            customerAccess: 'ready',
          }),
        }
        render(
          h(
            NativeSiteProvider,
            { presentation },
            h(BookingFlow, {
              mode: 'light',
              defaultLang: 'sv',
              port,
              barbersPort: { listActive: async () => [{ barber, copy: null, photoUrl: null }] },
              servicesPort: { listForBarber: async () => [service] },
              clock: () => new Date('2030-05-03T08:00:00'),
              onMyBookings: () => undefined,
            }),
          ),
          globalThis.document.getElementById('root'),
        )
      }, backend.document.presentation)
      await page.getByRole('button', { name: /Runtime barber/ }).click()
      await page.getByText('Välj en dag CMS', { exact: true }).waitFor()
      assert.equal(
        await page
          .locator('[data-knc-surface="booking-options"] button[aria-label][aria-pressed]')
          .count(),
        31,
        'Changing the runtime month must preserve every calendar day',
      )
      await page.locator('button[aria-label][aria-pressed="false"]:not([disabled])').first().click()
      await page.getByRole('button', { name: /Runtime haircut/ }).click()
      await page.getByRole('button', { name: '10:30', exact: true }).click()
      await page.getByText('Dina uppgifter CMS', { exact: true }).waitFor()
      await page
        .getByPlaceholder('Ditt fullständiga namn', { exact: true })
        .fill('Runtime customer')
      await page.getByLabel('Telefon', { exact: true }).fill('0701111111')
      await page.getByLabel('E-post', { exact: true }).fill('runtime@example.test')
      await page.getByRole('button', { name: 'Boka tid', exact: true }).click()
      await page.getByText('Tack — din tid är bokad! CMS', { exact: true }).waitFor()
      assert.ok((await page.locator('body').innerText()).includes('runtime@example.test'))
      assert.ok(!(await page.locator('body').innerText()).includes('kund@example.test'))

      console.log(
        `PASS ${name}: scene edit/publish/reload, mobile fold, locked preview, live calendar/form/confirmation, independent customer rows without fixture leakage`,
      )
    } catch (error) {
      console.error((await page.locator('body').innerText()).slice(-3500))
      await page.screenshot({ path: `/tmp/cms-scenes-${name}-failure.png` })
      throw error
    }
  } finally {
    await browser.close()
  }
}
