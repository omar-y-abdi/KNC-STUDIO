import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument, EMAIL_NAMES, defaultEmailDesign } from '../../shared/cms.ts'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const failures = []
const scenarios = [
  'duplicate',
  'add-block',
  'revert-reload',
  'selection',
  'compare',
  'literal-text',
  'undo-redo',
  'edit-during-save',
  'dialogs',
  'custom-page-styles',
  'logos',
  'privacy-appearance',
  'logo-replacement',
  'legacy-preview-repair',
  'live-preview',
  'line-breaks',
].filter(
  (scenario) => !process.env.CMS_OWNER_SCENARIO || scenario === process.env.CMS_OWNER_SCENARIO,
)

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  const browser = await engine.launch()
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        reducedMotion: 'reduce',
      })
      context.setDefaultTimeout(10000)
      const seed = emptyDocument()
      if (scenario === 'dialogs') {
        seed.emails = EMAIL_NAMES.flatMap((template) =>
          ['sv', 'en'].map((lang) => ({
            template,
            lang,
            subject: 'Ditt besök hos Blade & Blend',
            preheader: 'Information om din bokning',
            title: 'Välkommen till salongen',
            intro: 'Här hittar du uppgifterna för ditt besök.',
            section_title: 'Bokningsuppgifter',
            note: 'Kontakta salongen om du har frågor.',
            cta_label: 'Visa bokningen',
            contact_lead: 'Hör av dig till salongen.',
            design: defaultEmailDesign(),
          })),
        )
      }
      const assets =
        scenario === 'logo-replacement'
          ? [
              {
                id: '22222222-2222-4222-8222-222222222222',
                bucket: 'gallery',
                path: 'logo/22222222-2222-4222-8222-222222222222.webp',
                name: 'Ny logotyp',
                alt: 'Vald logotyp',
                mime: 'image/webp',
                bytes: 100,
                width: 300,
                height: 200,
                archived: false,
                version: 1,
              },
            ]
          : []
      const backend = await nativeBackend(context, seed, assets)
      if (assets.length)
        await context.route('**/storage/v1/object/public/**', (route) =>
          route.fulfill({
            contentType: 'image/png',
            path: 'public/og-image.png',
          }),
        )
      const page = await context.newPage()
      const frame = page.frameLocator('.gjs-frame').first()
      const inspector = page.locator('#cms-inspector')
      const mount = async (expected = 'KNC source sv') => {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () => {
          const harness = await import('/tools/e2e/admin-harness.tsx')
          harness.mountCmsStudioHarness()
        })
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        await frame.getByText(expected, { exact: true }).first().waitFor()
        await frame.locator('html').evaluate(async () => {
          await globalThis.document.fonts.ready
        })
        await page.getByRole('button', { name: 'Fit', exact: true }).click()
      }
      const selectCopy = async () => {
        const copy = frame.getByText('KNC source sv', { exact: true }).first()
        const id = await copy.getAttribute('id')
        await copy.click()
        await inspector.getByLabel('Text', { exact: true }).waitFor()
        return id
      }
      const publish = async () => {
        await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
        )
      }
      try {
        await mount()
        if (scenario === 'line-breaks') {
          const id = await selectCopy()
          const text = inspector.getByLabel('Text', { exact: true })
          await text.fill('First line')
          await text.press('End')
          await text.press('Shift+Enter')
          await text.pressSequentially('Second <literal> line')
          await text.press('Tab')
          const copy = frame.locator(`[id="${id}"]`)
          assert.equal(await copy.innerText(), 'First line\nSecond <literal> line')
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.locator(`[id="${id}"]`).waitFor()
          assert.equal(
            await live.locator(`[id="${id}"]`).innerText(),
            'First line\nSecond <literal> line',
          )
          await live.reload()
          assert.equal(
            await live.locator(`[id="${id}"]`).innerText(),
            'First line\nSecond <literal> line',
          )
          // Direct rich-text editing must keep the same line break semantics.
          await copy.dblclick()
          await copy.press('ControlOrMeta+A')
          await copy.pressSequentially('Direct first line')
          await copy.press('Shift+Enter')
          await copy.pressSequentially('Direct second line')
          await inspector.getByRole('button', { name: 'Förälder', exact: true }).click()
          assert.equal(await copy.innerText(), 'Direct first line\nDirect second line')
          await publish()
          await live.reload()
          assert.equal(
            await live.locator(`[id="${id}"]`).innerText(),
            'Direct first line\nDirect second line',
          )
          await copy.click()
          assert.equal(
            await inspector.getByLabel('Text', { exact: true }).inputValue(),
            'Direct first line\nDirect second line',
          )
          const phone = frame.locator('a[href^="tel:"]').first()
          const phoneHref = await phone.getAttribute('href')
          await phone.click()
          await inspector.getByLabel('Text', { exact: true }).fill('Call\nnow')
          await inspector.getByLabel('Text', { exact: true }).press('Tab')
          assert.equal(await phone.innerText(), 'Call\nnow')
          assert.equal(await phone.locator('img').count(), 1, 'Multiline text must retain its icon')
          await publish()
          await live.reload()
          const publicPhone = live.locator('a[href^="tel:"]').first()
          assert.equal(await publicPhone.innerText(), 'Call\nnow')
          assert.equal(await publicPhone.getAttribute('href'), phoneHref)
          assert.equal(await publicPhone.locator('img').count(), 1)
        } else if (scenario === 'live-preview') {
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Unpublished preview text')
          await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
          const preview = page.frameLocator('.cms-live-preview iframe')
          await preview.getByText('Unpublished preview text', { exact: true }).waitFor()
          await preview.getByRole('button', { name: 'Boka tid', exact: true }).click()
          await preview.locator('[data-knc-surface="desktop-booking"]').waitFor()
          await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
          await frame.getByText('Unpublished preview text', { exact: true }).waitFor()
          await page.getByRole('button', { name: '390', exact: true }).click()
          const cookies = await context.cookies()
          await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
          const mobile = page.frameLocator('.cms-live-preview iframe')
          await mobile
            .getByRole('button', { name: 'Hantera integritetsinställningar', exact: true })
            .click()
          await mobile.getByRole('button', { name: 'Spara val', exact: true }).click()
          assert.deepEqual(
            await context.cookies(),
            cookies,
            'Preview consent controls must not change live cookies',
          )
          const scroll = mobile.getByTestId('mobile-site-scroll')
          await scroll.hover()
          await page.mouse.wheel(0, 900)
          await page.waitForFunction(() => {
            const doc = globalThis.document.querySelector(
              '.cms-live-preview iframe',
            )?.contentDocument
            const root = doc?.querySelector('[data-testid="mobile-site-scroll"]')
            const panel = root?.firstElementChild
            return root?.scrollTop > 100 && panel?.getBoundingClientRect().height < 250
          })
          assert.equal(
            await mobile.locator('[data-gjs-type]').count(),
            0,
            'Locked preview must contain no editor selection layer',
          )
          assert.deepEqual(
            backend.writes,
            [],
            'Preview must never publish, book, send email, or submit a review',
          )
          await page.screenshot({ path: `/tmp/cms-native-${name}-live-mobile-preview.png` })
        } else if (scenario === 'logo-replacement') {
          const logo = frame.locator('[data-knc-surface="desktop-home"] svg[role="img"]').first()
          const id = await logo.getAttribute('id')
          await logo.locator('text').filter({ hasText: /^BNB$/ }).click()
          await inspector.getByRole('button', { name: 'Förälder', exact: true }).click()
          await inspector
            .getByRole('button', { name: 'Byt logotyp från biblioteket', exact: true })
            .click()
          const picker = page.getByRole('dialog', { name: 'Välj bild', exact: true })
          assert.equal(await picker.evaluate((node) => node.matches(':modal')), true)
          await picker.getByRole('button', { name: 'Vald logotyp Ny logotyp', exact: true }).click()
          await picker.waitFor({ state: 'detached' })
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByAltText('Vald logotyp', { exact: true }).waitFor()
          await live.reload()
          await live.getByAltText('Vald logotyp', { exact: true }).waitFor()
          assert.equal(await live.locator(`[id="${id}"]`).evaluate((node) => node.localName), 'img')
        } else if (scenario === 'legacy-preview-repair') {
          const result = await page.evaluate(async () => {
            const { emptyDocument } = await import('/shared/cms.ts')
            const { ensureCorePages } = await import('/src/admin/cms/corePages.ts')
            const oldHtml =
              '<div data-knc-native="1"><p data-knc-source="owned">Owner text</p><div data-knc-slot="opaque"><img src="/og-image.png"></div></div>'
            const sourceHtml =
              '<div data-knc-native="1"><p data-knc-source="owned">Source text</p><div data-knc-slot="opaque"><img src="/og-image.png" data-knc-baseline="{}" data-knc-light="width:210px"></div></div>'
            const variant = (html) => ({ html, css: { light: '', dark: '' } })
            const page = {
              id: '10000000-0000-4000-8000-000000000001',
              path: '/',
              kind: 'page',
              name: { sv: 'Hem', en: 'Home' },
              title: { sv: '', en: '' },
              description: { sv: '', en: '' },
              inMenu: true,
              content: { sv: variant(oldHtml), en: variant(oldHtml) },
            }
            const document = emptyDocument()
            document.presentation.pages = [page]
            const source = [
              { ...page, content: { sv: variant(sourceHtml), en: variant(sourceHtml) } },
            ]
            const repaired = ensureCorePages(document, source)
            return {
              html: repaired.presentation.pages[0].content.sv.html,
              stable:
                JSON.stringify(ensureCorePages(repaired, source)) === JSON.stringify(repaired),
              originalUntouched: document.presentation.pages[0].content.sv.html === oldHtml,
            }
          })
          assert.ok(result.html.includes('Owner text') && !result.html.includes('Source text'))
          assert.ok(result.html.includes('width:210px'))
          assert.ok(result.stable && result.originalUntouched)
        } else if (scenario === 'logos') {
          const edits = []
          for (const [device, title, selector, text] of [
            ['1440', 'Startsida', '[data-knc-surface="desktop-home"] svg text', 'BNB'],
            ['1440', 'Startsida', '[data-knc-surface="desktop-home"] svg text', 'STUDIO'],
            ['390', 'Startsida', '[data-knc-surface="mobile-home"] svg text', 'STUDIO'],
            ['390', 'Bokning', '[data-knc-surface="mobile-booking"] svg text', 'BNB'],
          ]) {
            await page
              .locator('#cms-library')
              .getByRole('button', { name: title, exact: true })
              .click()
            await page.getByRole('button', { name: device, exact: true }).click()
            await page.getByRole('button', { name: 'Fit', exact: true }).click()
            const lettering = frame
              .locator(selector)
              .filter({ hasText: text === 'BNB' ? /^BNB$/ : /^STUDIO$/ })
              .first()
            const id = await lettering.getAttribute('id')
            const replacement = `${text} ${edits.length + 1}`
            const logo = await lettering.evaluate((node) => ({
              id: node.ownerSVGElement.id,
              textIndex: [...node.ownerSVGElement.querySelectorAll('text')].indexOf(node) + 1,
            }))
            await frame.locator(`[id="${logo.id}"]`).click({ position: { x: 3, y: 3 } })
            await inspector
              .getByLabel(`Logotyptext ${logo.textIndex}`, { exact: true })
              .fill(replacement)
            const advanced = inspector.locator('.cms-advanced')
            if ((await advanced.getAttribute('open')) === null)
              await advanced.locator('summary').click()
            await advanced.getByLabel('Egenskap', { exact: true }).fill('fill')
            await advanced.getByLabel('Värde', { exact: true }).fill('rgb(100, 30, 60)')
            await advanced.getByRole('button', { name: 'Tillämpa', exact: true }).click()
            await publish()
            edits.push({ id, replacement, device, title })
          }
          const live = await context.newPage()
          for (const { id, replacement, device, title } of edits) {
            await live.setViewportSize({ width: Number(device), height: 900 })
            await live.goto(`${base}${title === 'Bokning' ? '/booking' : '/'}`)
            await live.locator(`[id="${id}"]`).filter({ hasText: replacement }).waitFor()
            await live.reload()
            const lettering = live.locator(`[id="${id}"]`).filter({ hasText: replacement })
            await lettering.waitFor()
            assert.equal(
              await lettering.evaluate((node) => globalThis.getComputedStyle(node).fill),
              'rgb(100, 30, 60)',
            )
          }
        } else if (scenario === 'privacy-appearance') {
          const button = frame
            .getByRole('button', { name: 'Hantera integritetsinställningar', exact: true })
            .first()
          const style = (locator) =>
            locator.evaluate((node) => {
              const css = globalThis.getComputedStyle(node)
              return Object.fromEntries(
                [
                  'position',
                  'border-radius',
                  'padding',
                  'font-size',
                  'background-color',
                  'color',
                ].map((key) => [key, css.getPropertyValue(key)]),
              )
            })
          const preview = await style(button)
          assert.equal(preview.position, 'absolute')
          assert.equal(preview['border-radius'], '999px')
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Privacy style parity')
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByRole('button', { name: 'Avvisa valfri lagring', exact: true }).click()
          const publicButton = live.getByRole('button', {
            name: 'Hantera integritetsinställningar',
            exact: true,
          })
          await publicButton.waitFor()
          assert.deepEqual(
            await style(publicButton),
            preview,
            'Preview and actual privacy control must have the same styling',
          )
          await publicButton.click()
          await live.getByRole('button', { name: 'Spara val', exact: true }).waitFor()
        } else if (scenario === 'dialogs') {
          for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            for (const [trigger, title] of [
              ['Resurser', 'Resurser'],
              ['Business / SEO', 'Business / SEO'],
              ['Mejl', 'Mejl'],
              ['Leveransstatus ↗', 'Leveransstatus'],
              ['History', 'Historik'],
            ]) {
              if (width === 390 && ['Business / SEO', 'Mejl', 'Leveransstatus ↗'].includes(trigger))
                await page.getByRole('button', { name: 'Sidor', exact: true }).click()
              const button = page.getByRole('button', { name: trigger, exact: true })
              await button.click()
              const modal = page.locator('dialog.cms-dialog')
              await modal.waitFor()
              if (title === 'Leveransstatus') {
                const href = await modal.getByRole('link').getAttribute('href')
                const target = await page.evaluate(async (href) => {
                  const { tabFromAdminUrl } = await import('/src/admin/navigationState.ts')
                  return tabFromAdminUrl(
                    new URL(href, globalThis.location.origin).href,
                    ['mail', 'schedule'],
                    'schedule',
                  )
                }, href)
                assert.equal(
                  target,
                  'mail',
                  'Delivery status must reach the existing mail admin tab',
                )
              }
              const state = await modal.evaluate((dialog) => {
                const bounds = dialog.getBoundingClientRect()
                const body = dialog.querySelector('.cms-dialog-body').getBoundingClientRect()
                return {
                  modal: dialog.matches(':modal'),
                  focusInside: dialog.contains(globalThis.document.activeElement),
                  reachable: dialog.contains(
                    globalThis.document.elementFromPoint(
                      body.x + body.width / 2,
                      body.y + Math.min(70, body.height / 2),
                    ),
                  ),
                  fits:
                    bounds.left >= 0 &&
                    bounds.right <= globalThis.innerWidth &&
                    bounds.top >= 0 &&
                    bounds.bottom <= globalThis.innerHeight,
                  overflows: dialog.scrollWidth > dialog.clientWidth,
                  bodyOverflows:
                    dialog.querySelector('.cms-dialog-body').scrollWidth >
                    dialog.querySelector('.cms-dialog-body').clientWidth,
                }
              })
              assert.deepEqual(
                state,
                {
                  modal: true,
                  focusInside: true,
                  reachable: true,
                  fits: true,
                  overflows: false,
                  bodyOverflows: false,
                },
                `${title} must be above the editor and usable at ${width}px`,
              )
              await page.screenshot({
                path: `/tmp/cms-native-${name}-dialog-${trigger.replace(/[^a-z]/gi, '')}-${width}.png`,
              })
              await page.keyboard.press('Escape')
              await modal.waitFor({ state: 'detached' })
              assert.equal(
                await button.evaluate((el) => el === globalThis.document.activeElement),
                true,
                'Closing restores focus to the opener',
              )
              if (width === 390 && ['Business / SEO', 'Mejl', 'Leveransstatus ↗'].includes(trigger))
                await page.getByRole('button', { name: 'Sidor', exact: true }).click()
            }
          }
        } else if (scenario === 'custom-page-styles') {
          const library = page.locator('#cms-library')
          await library.getByRole('button', { name: '+ Skapa sida', exact: true }).click()
          const main = frame.locator('main')
          const padding = () => main.evaluate((node) => globalThis.getComputedStyle(node).padding)
          assert.equal(
            await padding(),
            '64px 32px',
            'New-page inline styles must survive import into GrapesJS',
          )
          await publish()
          await library.getByRole('button', { name: 'Startsida', exact: true }).click()
          await library.getByRole('button', { name: 'Ny sida', exact: true }).click()
          assert.equal(
            await padding(),
            '64px 32px',
            'Styles must survive page switches after publication',
          )
          await page.getByRole('button', { name: 'Mörk', exact: true }).click()
          assert.equal(
            await padding(),
            '64px 32px',
            'Unedited dark variant must retain authored inline styles',
          )
        } else if (scenario === 'duplicate') {
          await selectCopy()
          await inspector.getByRole('button', { name: 'Duplicera', exact: true }).click()
          await inspector.getByLabel('Text', { exact: true }).fill('Owner duplicated the real site')
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText('Owner duplicated the real site', { exact: true }).waitFor()
          await live.getByText('KNC source sv', { exact: true }).first().waitFor()
          await live.reload()
          await live.getByText('Owner duplicated the real site', { exact: true }).waitFor()
        } else if (scenario === 'add-block') {
          await inspector.getByRole('tab', { name: 'Lägg till', exact: true }).click()
          await page.locator('#cms-blocks').getByTitle('Rubrik', { exact: true }).click()
          await frame.getByRole('heading', { name: 'Ny rubrik', exact: true }).waitFor()
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByRole('heading', { name: 'Ny rubrik', exact: true }).waitFor()
          await live.reload()
          await live.getByRole('heading', { name: 'Ny rubrik', exact: true }).waitFor()
        } else if (scenario === 'revert-reload') {
          await publish()
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Discard this owner edit')
          await page.waitForFunction(() =>
            globalThis.document.querySelector('.cms-status')?.textContent?.includes('Opublicerade'),
          )
          await page.getByRole('button', { name: 'Revert', exact: true }).click()
          await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
          await mount()
          assert.equal(await frame.getByText('Discard this owner edit', { exact: true }).count(), 0)
        } else if (scenario === 'selection') {
          const id = await selectCopy()
          const library = page.locator('#cms-library')
          await library.getByRole('button', { name: 'Om oss', exact: true }).click()
          await library.getByRole('button', { name: 'Startsida', exact: true }).click()
          await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
          await page.waitForFunction(
            (selectedId) =>
              globalThis.document
                .querySelector('.cms-selection-head')
                ?.textContent?.includes(selectedId),
            id,
          )
        } else if (scenario === 'compare') {
          await page.getByRole('button', { name: 'Mörk', exact: true }).click()
          await page.getByRole('button', { name: 'Jämför', exact: true }).click()
          const expected = await frame
            .locator('[data-knc-surface="mobile-home"]')
            .evaluate((node) => globalThis.getComputedStyle(node).backgroundColor)
          const comparison = page.frameLocator('.cms-compare-pane iframe')
          const actual = await comparison
            .locator('[data-knc-surface="mobile-home"]')
            .evaluate((node) => ({
              color: globalThis.getComputedStyle(node).backgroundColor,
              width: globalThis.innerWidth,
            }))
          assert.equal(actual.width, 390, 'Compare must use the opposite device viewport')
          assert.equal(actual.color, expected, 'Compare must render the selected dark theme')
          await page.getByRole('button', { name: '390', exact: true }).click()
          await comparison.locator('[data-knc-surface="desktop-home"]').waitFor()
          assert.equal(await comparison.locator('html').evaluate(() => globalThis.innerWidth), 1440)
        } else if (scenario === 'undo-redo') {
          await publish()
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Recover the owner edit')
          await page.getByRole('button', { name: 'Ångra', exact: true }).click()
          await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
          await page.getByRole('button', { name: 'Gör om', exact: true }).click()
          await frame.getByText('Recover the owner edit', { exact: true }).waitFor()
          await mount('Recover the owner edit')
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText('Recover the owner edit', { exact: true }).waitFor()
        } else if (scenario === 'edit-during-save') {
          await publish()
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Submitted owner edit')
          let release
          const gate = new Promise((resolve) => (release = resolve))
          const isPublish = (request) =>
            request.method() === 'POST' && request.postDataJSON().operation === 'publish'
          const holdPublish = async (route) => {
            if (!isPublish(route.request())) return route.fallback()
            const body = route.request().postDataJSON()
            const home = body.document.presentation.pages.find((item) => item.path === '/')
            // Simulate serialization normalization; the real shared validators still run.
            home.content.sv.html += '\n'
            await gate
            await route.fallback({ postData: JSON.stringify(body) })
          }
          await context.route('**/functions/v1/cms-studio', holdPublish)
          try {
            const started = page.waitForRequest(
              (request) => request.url().endsWith('/cms-studio') && isPublish(request),
            )
            await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
            await started
            await inspector.getByLabel('Text', { exact: true }).fill('Newer unsaved owner edit')
          } finally {
            release()
          }
          await page.waitForFunction(() =>
            globalThis.document.querySelector('.cms-status')?.textContent?.includes('Opublicerade'),
          )
          await frame.getByText('Newer unsaved owner edit', { exact: true }).waitFor()
          const saved = backend.document.presentation.pages.find((item) => item.path === '/')
          assert.ok(saved.content.sv.html.includes('Submitted owner edit'))
          assert.ok(!saved.content.sv.html.includes('Newer unsaved owner edit'))
          await context.unroute('**/functions/v1/cms-studio', holdPublish)
          await mount('Newer unsaved owner edit')
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText('Newer unsaved owner edit', { exact: true }).waitFor()
          await live.reload()
          await live.getByText('Newer unsaved owner edit', { exact: true }).waitFor()
        } else {
          await selectCopy()
          const text = 'KNC <strong>literal</strong> & text'
          await inspector.getByLabel('Text', { exact: true }).fill(text)
          await frame.getByText(text, { exact: true }).waitFor()
          await publish()
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText(text, { exact: true }).waitFor()
        }
        await page.screenshot({ path: `/tmp/cms-native-${name}-owner-${scenario}.png` })
        console.log(`PASS owner ${name}: ${scenario}`)
      } catch (error) {
        failures.push(`${name}/${scenario}: ${error.message}`)
        console.error(`FAIL owner ${name}: ${scenario}`, error)
        console.error('OWNER_EDITOR', (await page.locator('body').innerText()).slice(0, 3000))
        await page.screenshot({ path: `/tmp/cms-native-${name}-owner-${scenario}-failure.png` })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
assert.deepEqual(failures, [], 'Owner workflows must work beyond the initial green smoke test')
