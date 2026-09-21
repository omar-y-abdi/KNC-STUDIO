import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument, EMAIL_NAMES, defaultEmailDesign } from '../../shared/cms.ts'
import { renderSitePage } from '../../shared/site-page.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'

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
  'email-preview',
  'history-review',
  'resource-lifecycle',
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
      let sourceCaptures = 0
      context.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname === '/cms-public/source' && !url.searchParams.has('preview'))
          sourceCaptures++
      })
      const seed = emptyDocument()
      if (scenario === 'email-preview') {
        seed.emails = EMAIL_NAMES.flatMap((template) =>
          ['sv', 'en'].map((lang) => {
            const copy = defaultEmailTemplate(template, lang)
            return {
              template,
              lang,
              subject: copy.subject,
              preheader: copy.preheader,
              title: copy.title,
              intro: copy.intro,
              section_title: copy.sectionTitle,
              note: copy.note,
              cta_label: copy.ctaLabel,
              contact_lead: copy.contactLead,
              design: null,
            }
          }),
        )
      }
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
      const assets = ['logo-replacement', 'resource-lifecycle'].includes(scenario)
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
      if (scenario === 'resource-lifecycle')
        assets.push({
          ...assets[0],
          id: '33333333-3333-4333-8333-333333333333',
          path: 'logo/second.webp',
          name: 'Andra logotypen',
        })
      const backend = await nativeBackend(context, seed, assets)
      if (scenario === 'resource-lifecycle')
        await context.route('**/functions/v1/cms-studio', async (route) => {
          const body = route.request().postDataJSON()
          if (body.operation !== 'asset_lifecycle') return route.fallback()
          const index = assets.findIndex((asset) => asset.id === body.id)
          assert.equal(body.version, assets[index].version)
          assets[index] = {
            ...assets[index],
            archived: body.action === 'archive',
            version: assets[index].version + 1,
          }
          return route.fulfill({
            json: { asset: assets[index] },
            headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
          })
        })
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
        if (scenario === 'resource-lifecycle') {
          await page.getByRole('button', { name: 'Resurser', exact: true }).click()
          const cards = page.locator('.cms-resource-card')
          assert.equal(await cards.count(), 2)
          for (const box of await page.locator('.cms-resource-check input').all()) await box.check()
          await page.getByRole('button', { name: 'Arkivera valda', exact: true }).click()
          await cards.first().waitFor({ state: 'detached' })
          await page.getByRole('button', { name: 'Arkiverade', exact: true }).click()
          await cards.nth(1).waitFor()
          assert.equal(
            await cards.count(),
            2,
            'Both bulk updates must survive independent API responses',
          )
          for (const box of await page.locator('.cms-resource-check input').all()) await box.check()
          await page.getByRole('button', { name: 'Återställ valda', exact: true }).click()
          await cards.first().waitFor({ state: 'detached' })
          await page.getByRole('button', { name: 'Aktiva', exact: true }).click()
          await cards.nth(1).waitFor()
          assert.ok(assets.every((asset) => !asset.archived && asset.version === 3))
          assert.deepEqual(backend.writes, [], 'Resource lifecycle must not publish page content')
        } else if (scenario === 'history-review') {
          await publish()
          await selectCopy()
          await inspector.getByLabel('Text', { exact: true }).fill('Current published copy')
          await publish()
          await page.getByRole('button', { name: 'History', exact: true }).click()
          const older = page
            .locator('.cms-history-row')
            .filter({ has: page.getByText('v2', { exact: true }) })
          await older.getByRole('button', { name: 'Granska', exact: true }).click()
          const review = page.getByRole('dialog', { name: 'Granska version 2', exact: true })
          await review.waitFor()
          await page
            .frameLocator('.cms-history-preview iframe')
            .getByText('KNC source sv', { exact: true })
            .first()
            .waitFor()
          assert.equal(backend.writes.length, 2, 'Review must not publish')
          await page.keyboard.press('Escape')
          await review.waitFor({ state: 'detached' })
          await page.getByRole('region', { name: 'Webbplatsens historik', exact: true }).waitFor()
          await older.getByRole('button', { name: 'Återställ till utkast', exact: true }).click()
          await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
          assert.equal(backend.writes.length, 2, 'Restoring history must only change the draft')
          const live = await context.newPage()
          await live.goto(base)
          await live.getByText('Current published copy', { exact: true }).waitFor()
          await publish()
          await live.reload()
          await live.getByText('KNC source sv', { exact: true }).first().waitFor()
        } else if (scenario === 'email-preview') {
          await page.getByRole('button', { name: 'Mejl', exact: true }).click()
          const modal = page.getByRole('region', { name: 'Mejl från din salong', exact: true })
          const mail = page.frameLocator('iframe[title="Mejl som skickas"]')
          for (const [template, label] of [
            ['customer_confirmation', 'Kundbekräftelse'],
            ['barber_confirmation', 'Barberarbekräftelse'],
            ['customer_cancellation', 'Kundavbokning'],
            ['barber_cancellation', 'Barberaravbokning'],
            ['customer_reminder', 'Påminnelse'],
            ['customer_booking_access', 'Kundens bokningsåtkomst'],
            ['auth_recovery', 'Återställ lösenord'],
            ['auth_email_change', 'Ändra e-post'],
            ['auth_invite', 'Inbjudan'],
          ]) {
            await modal.getByRole('button', { name: label, exact: true }).click()
            await mail
              .getByRole('heading', {
                name: defaultEmailTemplate(template, 'sv').title,
                exact: true,
              })
              .waitFor()
            assert.equal(
              await mail
                .locator('body')
                .evaluate((node) => globalThis.getComputedStyle(node).backgroundColor),
              'rgb(21, 21, 23)',
              'Undesigned email preview must use the existing outgoing dark email, not the CMS sketch',
            )
            assert.ok(!(await mail.locator('body').innerText()).includes('{customer_name}'))
          }
          await modal.getByRole('button', { name: 'Kundbekräftelse', exact: true }).click()
          await modal.getByLabel('Rubrik', { exact: true }).fill('Unpublished mail title')
          await modal.getByLabel('Intro', { exact: true }).fill('Hej {customer_name}\nAndra raden')
          await mail.getByRole('heading', { name: 'Unpublished mail title', exact: true }).waitFor()
          await mail.locator('p').filter({ hasText: 'Hej Robin Andersson' }).waitFor()
          assert.equal(
            await mail.locator('p').filter({ hasText: 'Hej Robin Andersson' }).innerText(),
            'Hej Robin Andersson\nAndra raden',
          )
          await mail.getByText('350 kr', { exact: true }).waitFor()
          await modal.getByRole('button', { name: 'Mobil', exact: true }).click()
          await page.screenshot({ path: `/tmp/cms-native-${name}-email-real-preview.png` })
          await modal.getByRole('button', { name: 'Tillbaka till sidan', exact: false }).click()
          await publish()
          const captured = sourceCaptures
          await mount()
          assert.equal(
            sourceCaptures,
            captured,
            'A complete published site must open without recapturing 24 native scenes',
          )
          await page.getByRole('button', { name: 'Mejl', exact: true }).click()
          await mail.getByRole('heading', { name: 'Unpublished mail title', exact: true }).waitFor()
          assert.deepEqual(
            backend.writes,
            ['publish'],
            'Viewing email previews must never send mail',
          )
        } else if (scenario === 'line-breaks') {
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
          await publicPhone.filter({ hasText: 'Call' }).waitFor()
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
          await page.getByRole('button', { name: 'Mobil', exact: true }).click()
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
          // Use the full-sized hero logo for replacement. Small corner lettering is covered by
          // the logos scenario; its subpixel glyph hit area varies with Linux/macOS fonts.
          const logo = frame
            .locator('[data-knc-surface="desktop-home"] svg[role="img"]')
            .filter({ hasText: 'STUDIO' })
            .first()
          const id = await logo.getAttribute('id')
          await logo.click({ position: { x: 3, y: 3 } })
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
            ['Dator', 'Startsida', '[data-knc-surface="desktop-home"] svg text', 'BNB'],
            ['Dator', 'Startsida', '[data-knc-surface="desktop-home"] svg text', 'STUDIO'],
            ['Mobil', 'Startsida', '[data-knc-surface="mobile-home"] svg text', 'STUDIO'],
            ['Mobil', 'Bokning', '[data-knc-surface="mobile-booking"] svg text', 'BNB'],
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
            await live.setViewportSize({ width: device === 'Dator' ? 1440 : 390, height: 900 })
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
          await selectCopy()
          const originalTranslate = await frame
            .getByText('KNC source sv', { exact: true })
            .first()
            .evaluate((node) => globalThis.getComputedStyle(node).translate)
          for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 })
            for (const [trigger, title] of [
              ['Resurser', 'Bilder & typsnitt'],
              ['Business / SEO', 'Företag & sökresultat'],
              ['Mejl', 'Mejl från din salong'],
              ['Leveransstatus ↗', 'Leveransstatus'],
              ['History', 'Webbplatsens historik'],
            ]) {
              if (width === 390 && trigger !== 'History')
                await page
                  .locator('.cms-mobile-tools')
                  .getByRole('button', { name: 'Sidor', exact: true })
                  .click()
              const button = page.getByRole('button', { name: trigger, exact: true })
              await button.click()
              const surface = page.getByRole('region', { name: title, exact: true })
              await surface.waitFor()
              if (title === 'Bilder & typsnitt') {
                await surface.getByLabel('Användning vid uppladdning').press('ArrowDown')
                assert.equal(
                  await frame
                    .getByText('KNC source sv', { exact: true })
                    .first()
                    .evaluate((node) => globalThis.getComputedStyle(node).translate),
                  originalTranslate,
                  'Workspace keyboard input must never nudge a hidden selected page element',
                )
              }
              if (title === 'Leveransstatus') {
                assert.equal(
                  await surface.getByRole('link').getAttribute('href'),
                  '/admin?tab=mail',
                )
              }
              const state = await surface.evaluate((view) => {
                const bounds = view.getBoundingClientRect()
                const body = view.querySelector('.cms-workspace-content')
                return {
                  focusInside: view.contains(globalThis.document.activeElement),
                  reachable: view.contains(
                    globalThis.document.elementFromPoint(bounds.x + 30, bounds.y + 30),
                  ),
                  fits:
                    bounds.left >= 0 &&
                    bounds.right <= globalThis.innerWidth &&
                    bounds.top >= 0 &&
                    bounds.bottom <= globalThis.innerHeight,
                  overflows: view.scrollWidth > view.clientWidth,
                  bodyOverflows: body.scrollWidth > body.clientWidth,
                  editorInert: globalThis.document.querySelector('.cms-editor-wrap').inert,
                }
              })
              assert.deepEqual(
                state,
                {
                  focusInside: true,
                  reachable: true,
                  fits: true,
                  overflows: false,
                  bodyOverflows: false,
                  editorInert: true,
                },
                `${title} must be a usable workspace at ${width}px`,
              )
              assert.equal(
                await page.locator('dialog[open]').count(),
                0,
                'Workspace navigation must not open a modal',
              )
              await page.screenshot({
                path: `/tmp/cms-native-${name}-workspace-${trigger.replace(/[^a-z]/gi, '')}-${width}.png`,
              })
              await page.keyboard.press('Escape')
              await surface.waitFor({ state: 'detached' })
              assert.equal(await page.locator('.cms-editor-wrap').evaluate((el) => el.inert), false)
            }
            if (width === 390)
              await page
                .locator('.cms-mobile-tools')
                .getByRole('button', { name: 'Sidor', exact: true })
                .click()
            await page.getByRole('button', { name: '+ Ny sida', exact: true }).click()
            const modal = page.getByRole('dialog', { name: 'Ny sida', exact: true })
            await modal.waitFor()
            assert.equal(await modal.evaluate((el) => el.matches(':modal')), true)
            await page.keyboard.press('Escape')
            await modal.waitFor({ state: 'detached' })
          }
        } else if (scenario === 'custom-page-styles') {
          const languageColor = await frame
            .locator('[data-knc-surface="desktop-home"]')
            .getByRole('button', { name: 'SV', exact: true })
            .evaluate((node) => globalThis.getComputedStyle(node).color)
          const library = page.locator('#cms-library')
          await library.getByRole('button', { name: '+ Ny sida', exact: true }).click()
          await page
            .getByRole('dialog', { name: 'Ny sida', exact: true })
            .getByRole('button', { name: 'Skapa sida', exact: true })
            .click()
          const main = frame.locator('main')
          await frame.locator('#cms-site-header svg[role="img"]').waitFor()
          assert.equal(
            await frame
              .locator('#cms-site-header')
              .getByRole('link', { name: 'SV', exact: true })
              .evaluate((node) => globalThis.getComputedStyle(node).color),
            languageColor,
            'Converting header controls to links must retain their original contrast',
          )
          assert.equal(
            await frame.locator('h1').count(),
            1,
            'The new page has one content title, not a blank unbranded canvas',
          )
          await frame
            .locator('#cms-site-menu')
            .getByRole('link', { name: 'Boka tid', exact: true })
            .waitFor()
          await frame
            .locator('#cms-site-footer')
            .getByRole('link', { name: 'Integritetspolicy', exact: true })
            .waitFor()
          const padding = () => main.evaluate((node) => globalThis.getComputedStyle(node).padding)
          assert.equal(
            await padding(),
            '64px 32px',
            'New-page inline styles must survive import into GrapesJS',
          )
          await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
          await page.locator('#cms-blocks').getByTitle('Text', { exact: true }).click()
          await page.getByRole('tab', { name: 'Design', exact: true }).click()
          await inspector.getByLabel('Text', { exact: true }).fill('New page extension content')
          await publish()
          const created = backend.document.presentation.pages.find(
            (item) => item.path === '/hemsida',
          )
          assert.ok(created)
          assert.ok(
            created.content.sv.html.includes('New page extension content'),
            'Added blocks belong to authored content, not shared chrome',
          )
          assert.ok(
            !created.content.sv.html.includes('cms-site-header'),
            'Shared chrome is derived, never saved as a stale copy inside page content',
          )
          await context.route(`${base}/hemsida*`, (route) => {
            const mode =
              new URL(route.request().url()).searchParams.get('mode') === 'dark' ? 'dark' : 'light'
            const page = backend.document.presentation.pages.find(
              (item) => item.path === '/hemsida',
            )
            const rendered = renderSitePage(backend.document.presentation, page, 'sv', mode)
            return route.fulfill({
              contentType: 'text/html',
              body: `<!doctype html><html><head><style>${rendered.css}</style></head><body>${rendered.html}</body></html>`,
            })
          })
          const publicPage = await context.newPage()
          await publicPage.goto(`${base}/hemsida?mode=dark`)
          await publicPage.locator('#cms-site-header svg').waitFor()
          await publicPage.getByRole('heading', { name: 'Ny sida', exact: true }).waitFor()
          await publicPage.getByText('New page extension content', { exact: true }).waitFor()
          await publicPage.reload()
          assert.equal(
            await publicPage.locator('#cms-site-header svg[role="img"]').count(),
            1,
            'The real logo remains in the public page header',
          )
          await publicPage.close()
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
          await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
          await page
            .frameLocator('.cms-live-preview iframe')
            .locator('#cms-site-header svg')
            .first()
            .waitFor()
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
          await page.getByRole('button', { name: 'Mobil', exact: true }).click()
          await comparison.locator('[data-knc-surface="desktop-home"]').waitFor()
          assert.equal(await comparison.locator('html').evaluate(() => globalThis.innerWidth), 1440)
          await frame.locator('[data-knc-surface="mobile-home"]').waitFor({ state: 'visible' })
          assert.equal(
            await frame.locator('html').evaluate(() => globalThis.innerWidth),
            390,
            'Editable canvas must switch to mobile alongside comparison',
          )
          await page.getByRole('button', { name: 'Fit', exact: true }).click()
          const bounds = await page.locator('iframe.gjs-frame').boundingBox()
          const stage = await page.locator('.cms-editor-canvas').boundingBox()
          assert.ok(
            bounds.x >= stage.x - 1 &&
              bounds.x + bounds.width <= stage.x + stage.width + 1 &&
              bounds.y >= stage.y - 1 &&
              bounds.y + bounds.height <= stage.y + stage.height + 1,
            'Fit must keep the complete mobile viewport inside its own comparison column',
          )
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
