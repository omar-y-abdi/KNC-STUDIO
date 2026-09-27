/* global getComputedStyle */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { emptyDocument, EMAIL_NAMES } from '../../shared/cms.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-reported'
const scenarioFilter = process.env.CMS_REPORTED_SCENARIO
await mkdir(out, { recursive: true })
const results = []
const seed = emptyDocument()
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

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== engineName) continue
  const browser = await engine.launch()
  let captured
  const check = async (id, run, { setup, document: initialDocument } = {}) => {
    if (scenarioFilter && id !== scenarioFilter) return
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    context.setDefaultTimeout(15000)
    const backend = await nativeBackend(context, initialDocument ?? captured ?? seed)
    if (setup) await setup(context)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const shot = async (suffix) =>
      page.screenshot({ path: `${out}/${engineName}-${id}-${suffix}.png`, animations: 'disabled' })
    try {
      await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      const frame = page.frameLocator('.gjs-frame').first()
      await frame.locator('[data-knc-surface="desktop-home"]').waitFor()
      if (!captured)
        captured = await page.evaluate(
          async () => (await import('/src/admin/cms/backup.ts')).loadBackup().document,
        )
      const details = await run({ page, frame, shot, backend })
      assert.deepEqual(errors, [], 'no unhandled browser errors')
      results.push({ engine: engineName, id, passed: true, details })
    } catch (error) {
      results.push({
        engine: engineName,
        id,
        passed: false,
        error: error.stack,
        browserErrors: errors,
      })
      await shot('failure').catch(() => {
        /* Preserve the original failure if the page closed. */
      })
    } finally {
      await context.close()
    }
  }
  const select = (page, selector) =>
    page.evaluate(async (selector) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      const component =
        selector === 'body' ? editor.getWrapper() : editor.getWrapper().find(selector)[0]
      if (!component) throw new Error(`Missing component ${selector}`)
      editor.select(component)
    }, selector)
  const create = async (page) => {
    await page.getByRole('button', { name: 'Mörk', exact: true }).click()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Ny sida', exact: true })
    await dialog.getByLabel('Sidnamn', { exact: true }).fill('Reported page')
    await dialog.getByLabel('Adress', { exact: true }).fill('/reported-page')
    await dialog.getByRole('button', { name: 'Skapa sida', exact: true }).click()
    await page
      .frameLocator('.gjs-frame')
      .getByRole('heading', { name: 'Reported page', exact: true })
      .waitFor()
  }
  const openSector = async (page, name) => {
    const sector = page.getByRole('button', { name, exact: true })
    if ((await sector.getAttribute('aria-expanded')) !== 'true') await sector.click()
    assert.equal(await sector.getAttribute('aria-expanded'), 'true')
  }
  try {
    await check('1-legal-background', async ({ page, frame, shot, backend }) => {
      await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByRole('button', { name: 'Dator', exact: true }).click()
      await page.waitForFunction(() => {
        const canvas = globalThis.document.querySelector('.gjs-frame')
        const frame = canvas?.contentWindow
        return (
          canvas?.clientWidth === 1440 &&
          frame?.innerWidth === 1440 &&
          frame.matchMedia('(min-width:769px)').matches
        )
      })
      await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
      await select(page, 'body')
      const originalDark = await frame.locator('body').evaluate((node) => ({
        background: getComputedStyle(node).backgroundColor,
        color: getComputedStyle(node).color,
        root: getComputedStyle(node.ownerDocument.documentElement).backgroundColor,
      }))
      assert.notEqual(
        originalDark.background,
        'rgb(255, 255, 255)',
        'dark legal page must not have a white body over its dark root',
      )
      assert.notEqual(
        originalDark.background,
        'rgba(0, 0, 0, 0)',
        'page background is explicit and editable',
      )
      await shot('dark')

      await page.getByRole('button', { name: 'Ljus', exact: true }).click()
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') ===
          'light',
      )
      await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
      await shot('light')
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') ===
          'dark',
      )
      await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()

      const backgroundControl = async () => {
        await select(page, 'body')
        await openSector(page, 'Yta & kanter')
        return page.getByRole('textbox', { name: 'Bakgrundsfärg', exact: true })
      }
      const waitForBackgroundControl = async (control, expected) => {
        const inputId = await control.getAttribute('id')
        await page.waitForFunction(
          ({ expected, inputId }) => {
            const inspector = globalThis.document.querySelector('#cms-inspector')
            const field = inputId
              ? globalThis.document.getElementById(inputId)
              : [...(inspector?.querySelectorAll('input') ?? [])].find(
                  (input) =>
                    input.getAttribute('aria-label') === 'Bakgrundsfärg' ||
                    [...(input.labels ?? [])].some(
                      (label) => label.textContent?.trim() === 'Bakgrundsfärg',
                    ),
                )
            return field?.value === expected
          },
          { expected, inputId },
        )
      }
      const readSelectedBackground = () =>
        page.evaluate(async () => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const selected = cmsGrapes.editors.at(-1)?.getSelected()?.getEl()
          return selected
            ? selected.ownerDocument.defaultView.getComputedStyle(selected).backgroundColor
            : null
        })
      const waitForSelectedBackground = (expected) =>
        page.waitForFunction(async (expected) => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const selected = cmsGrapes.editors.at(-1)?.getSelected()?.getEl()
          return (
            !!selected &&
            selected.ownerDocument.defaultView.getComputedStyle(selected).backgroundColor ===
              expected
          )
        }, expected)
      const editBackground = async (color) => {
        const background = await backgroundControl()
        await background.fill(color)
        await background.press('Enter')
        assert.equal(await background.inputValue(), color)
        const expected = color === '#123456' ? 'rgb(18, 52, 86)' : 'rgb(35, 69, 103)'
        await waitForSelectedBackground(expected)
        return readSelectedBackground()
      }
      const darkPixels = await editBackground('#123456')
      await shot('dark-edited')

      await page.getByRole('button', { name: 'Ljus', exact: true }).click()
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') ===
          'light',
      )
      await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
      const lightPixels = await editBackground('#234567')
      await shot('light-edited')

      const publication = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith('/functions/v1/cms-studio') &&
          response.request().method() === 'POST' &&
          response.request().postDataJSON()?.operation === 'publish',
      )
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      assert.equal((await publication).status(), 200)
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
      )

      const saved = backend.document.presentation.pages.find((item) => item.path === '/terms')
      assert.ok(saved, 'Bokningsvillkor remains present after CMS publication')
      assert.ok(saved.content.sv.css.dark.includes('#123456'))
      assert.ok(saved.content.sv.css.light.includes('#234567'))
      assert.ok(saved.content.sv.css.dark.includes('html body'))
      assert.ok(saved.content.sv.css.light.includes('html body'))
      for (const lang of ['sv', 'en']) {
        const html = saved.content[lang].html
        for (const slot of [
          'legal-business-details-sv',
          'legal-business-details-en',
          'cancellation-policy-sv',
          'cancellation-policy-en',
        ])
          assert.ok(html.includes(`id="${slot}"`), `${lang} legal content retains ${slot}`)
      }

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor()
      await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByRole('button', { name: 'Dator', exact: true }).click()
      await page.waitForFunction(() => {
        const canvas = globalThis.document.querySelector('.gjs-frame')
        const frame = canvas?.contentWindow
        return (
          canvas?.clientWidth === 1440 &&
          frame?.innerWidth === 1440 &&
          frame.matchMedia('(min-width:769px)').matches
        )
      })
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') ===
          'dark',
      )
      await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
      for (const slot of [
        'legal-business-details-sv',
        'legal-business-details-en',
        'cancellation-policy-sv',
        'cancellation-policy-en',
      ])
        await frame.locator(`#${slot}`).waitFor({ state: 'attached' })
      const darkControl = await backgroundControl()
      await waitForBackgroundControl(darkControl, '#123456')
      assert.equal(await darkControl.inputValue(), '#123456')
      await waitForSelectedBackground('rgb(18, 52, 86)')
      assert.equal(await readSelectedBackground(), 'rgb(18, 52, 86)')
      await shot('dark-reloaded')

      await page.getByRole('button', { name: 'Ljus', exact: true }).click()
      await page.waitForFunction(
        () =>
          globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') ===
          'light',
      )
      const lightControl = await backgroundControl()
      await waitForBackgroundControl(lightControl, '#234567')
      assert.equal(await lightControl.inputValue(), '#234567')
      await waitForSelectedBackground('rgb(35, 69, 103)')
      assert.equal(await readSelectedBackground(), 'rgb(35, 69, 103)')
      await shot('light-reloaded')
      return { dark: darkPixels, light: lightPixels }
    })
    await check('2-new-page-editability', async ({ page, frame, shot }) => {
      await create(page)
      const controls = await page.evaluate(async () => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        return editor
          .getWrapper()
          .find('#cms-site-header a, #cms-site-content h1')
          .map((node) => ({
            tag: node.get('tagName'),
            id: node.getId(),
            stylable: node.get('stylable'),
            draggable: node.get('draggable'),
          }))
      })
      await shot('created')
      assert.ok(controls.length >= 2, 'new page contains real site chrome and authored content')
      assert.ok(
        controls.every((node) => node.stylable !== false && node.draggable !== false),
        JSON.stringify(controls),
      )
      await select(page, '#cms-site-content h1')
      await page
        .locator('#cms-inspector')
        .getByLabel('Text', { exact: true })
        .fill('Owner edited heading')
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
      )
      await frame.getByRole('heading', { name: 'Owner edited heading', exact: true }).waitFor()
      await shot('edited')
      return controls
    })
    await check('2-owner-controls-survive-publication', async ({ page, frame, shot, backend }) => {
      await create(page)
      await select(page, '#cms-site-header > div')
      await openSector(page, 'Yta & kanter')
      const background = page.getByRole('textbox', { name: 'Bakgrundsfärg', exact: true })
      await background.fill('#123456')
      await background.press('Enter')
      await openSector(page, 'Avstånd')
      const padding = page
        .locator('.gjs-sm-property')
        .filter({ has: page.locator('.gjs-sm-label').getByText('Inre avstånd', { exact: true }) })
        .first()
      await padding.getByLabel('Ovanför', { exact: true }).fill('33')
      await padding.getByLabel('Ovanför', { exact: true }).press('Enter')
      const styled = () =>
        frame.locator('#cms-site-header > div').evaluate((node) => ({
          background: getComputedStyle(node).backgroundColor,
          padding: getComputedStyle(node).paddingTop,
        }))
      const before = await styled()
      await shot('header-styled')
      assert.deepEqual(
        before,
        { background: 'rgb(18, 52, 86)', padding: '33px' },
        'all new-page controls affect rendered pixels, including seeded header padding',
      )
      await select(page, '#cms-site-header')
      await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
      await page.getByRole('button', { name: 'Lägg till text', exact: true }).click()
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
      )
      const published = globalThis.structuredClone(
        backend.document.presentation.pages.find((item) => item.path === '/reported-page'),
      )
      await writeFile(
        `${out}/${engineName}-owner-published-page.json`,
        JSON.stringify(published, null, 2),
      )
      assert.equal(published.layout, 'independent')
      assert.ok(
        published.content.sv.html.includes('cms-site-header'),
        'header is saved, not discarded',
      )
      await page.reload()
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor()
      await page.getByRole('button', { name: 'Reported page', exact: true }).click()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      await frame.getByRole('heading', { name: 'Reported page', exact: true }).waitFor()
      await page.waitForFunction(() => {
        const iframe = globalThis.document.querySelector('.gjs-frame')
        const view = iframe?.contentDocument?.defaultView
        return (
          iframe?.clientWidth === 390 &&
          view?.innerWidth === 390 &&
          view.matchMedia('(max-width: 768px)').matches
        )
      })
      const reloaded = await styled()
      const selection = {
        theme: await page
          .getByRole('button', { name: 'Mörk', exact: true })
          .getAttribute('aria-pressed'),
        device: await page
          .getByRole('button', { name: 'Mobil', exact: true })
          .getAttribute('aria-pressed'),
      }
      await writeFile(
        `${out}/${engineName}-owner-reload-metrics.json`,
        JSON.stringify({ before, reloaded, selection }, null, 2),
      )
      assert.deepEqual(reloaded, before, 'published header edits survive reload')
      await shot('reloaded')
    })
    await check('2-legacy-page-language-preservation', async ({ page, frame, backend, shot }) => {
      await create(page)
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
      )
      // Replay a real pre-upgrade body-only record at the persistence boundary.
      const legacy = backend.document.presentation.pages.find(
        (item) => item.path === '/reported-page',
      )
      delete legacy.layout
      legacy.content = {
        sv: { html: '<main><h1>Legacy Swedish</h1></main>', css: { light: '', dark: '' } },
        en: { html: '<main><h1>Legacy English</h1></main>', css: { light: '', dark: '' } },
      }
      await page.reload()
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor()
      await page.getByRole('button', { name: 'Reported page', exact: true }).click()
      await frame.getByRole('heading', { name: 'Legacy Swedish', exact: true }).waitFor()
      await select(page, '#cms-site-content h1')
      await page
        .locator('#cms-inspector')
        .getByLabel('Text', { exact: true })
        .fill('Swedish owner edit')
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
      )
      const saved = backend.document.presentation.pages.find(
        (item) => item.path === '/reported-page',
      )
      assert.equal(saved.layout, 'independent')
      assert.ok(
        saved.content.en.html.includes('cms-site-header'),
        'editing Swedish must also preserve the unedited English layout',
      )
      await page.getByRole('button', { name: 'EN', exact: true }).click()
      await frame.getByRole('heading', { name: 'Legacy English', exact: true }).waitFor()
      await frame.locator('#cms-site-header').waitFor()
      await shot('english-preserved')
    })
    await check('2-device-switch-styles', async ({ page, frame, shot }) => {
      await create(page)
      const snapshots = []
      for (const device of ['Dator', 'Mobil', 'Dator', 'Mobil']) {
        await page.getByRole('button', { name: device, exact: true }).click()
        await page.waitForFunction(
          (width) => globalThis.document.querySelector('.gjs-frame').clientWidth === width,
          device === 'Dator' ? 1440 : 390,
        )
        await frame.getByRole('heading', { name: 'Reported page', exact: true }).waitFor()
        snapshots.push(
          await frame.locator('#cms-site-shell').evaluate((node) => {
            const rect = node.getBoundingClientRect()
            const svg = node.querySelector('svg')
            return {
              background: getComputedStyle(node).backgroundColor,
              width: rect.width,
              svgWidth: svg?.getBoundingClientRect().width,
              brandColor: getComputedStyle(node.querySelector('#cms-site-header a')).color,
            }
          }),
        )
        await shot(`${snapshots.length}-${device}`)
      }
      assert.ok(
        snapshots.every(
          (s) =>
            s.svgWidth < 240 &&
            s.brandColor !== 'rgb(0, 0, 238)' &&
            s.background !== 'rgba(0, 0, 0, 0)',
        ),
        JSON.stringify(snapshots),
      )
      return snapshots
    })
    await check('3-activate-email-design', async ({ page, shot }) => {
      await page.getByRole('button', { name: 'Mejl', exact: true }).click()
      const email = page.locator('iframe[title="Mejl som skickas"]')
      await email.waitFor()
      const before = await email.getAttribute('srcdoc')
      await shot('before')
      await page.getByRole('button', { name: 'Aktivera design', exact: true }).click()
      await page.locator('.cms-email-design').waitFor()
      const after = await email.getAttribute('srcdoc')
      await shot('after')
      assert.equal(
        after,
        before,
        'enabling design controls must preserve the delivered email markup exactly',
      )
    })
    const bookingCatalog = {
      barbers: [
        {
          id: 'cms-example',
          name: 'Exempelbarberare',
          ig: 'exempel',
          role_sv: 'Barberare',
          role_en: 'Barber',
          bio_sv: '',
          bio_en: '',
          active: true,
          sort_order: 0,
          photo_path: null,
        },
      ],
      services: Array.from({ length: 5 }, (_, index) => ({
        id: `cms-example-service-${index + 1}`,
        barber_id: 'cms-example',
        name: index === 0 ? 'Klippning' : `Exempeltjänst ${index + 1}`,
        price: 200 + index * 50,
        duration_min: 45,
        active: true,
        sort_order: index,
        available_weekdays: [0, 1, 2, 3, 4, 5, 6],
      })),
    }
    await check(
      '4-booking-full-page-scenes',
      async ({ page, frame, shot }) => {
        const legacyUpgrade = await page.evaluate(async (capturedDocument) => {
          const { ensureCorePages, needsCorePageSource } =
            await import('/src/admin/cms/corePages.ts')
          const sourceDocument = globalThis.structuredClone(capturedDocument)
          const document = globalThis.structuredClone(capturedDocument)
          const page = document.presentation.pages.find((item) => item.path === '/booking')
          if (!page || !sourceDocument.presentation.pages.some((item) => item.path === '/booking'))
            throw new Error('Captured booking source is missing')
          for (const lang of ['sv', 'en']) {
            const tree = new globalThis.DOMParser().parseFromString(
              page.content[lang].html,
              'text/html',
            )
            for (const surface of ['desktop-booking', 'mobile-booking']) {
              const flow = tree.querySelector(
                `[data-knc-surface="${surface}"] [data-knc-fold="booking-flow"]`,
              )
              if (!flow?.getAttribute('data-knc-source'))
                throw new Error(`Captured ${lang} ${surface} has no stable booking source identity`)
              flow.removeAttribute('data-knc-fold')
              flow.id = `legacy-${lang}-${surface}`
              flow.textContent = `Owner ${lang} booking edit`
            }
            page.content[lang].html = tree.body.innerHTML
            for (const mode of ['light', 'dark'])
              page.content[lang].css[mode] +=
                `\n#legacy-${lang}-desktop-booking{border:2px solid rgb(12,34,56)}`
          }
          const beforeInput = globalThis.structuredClone(document.presentation.pages)
          const missingBefore = needsCorePageSource(document)
          const upgraded = ensureCorePages(document, sourceDocument.presentation.pages)
          const booking = upgraded.presentation.pages.find((item) => item.path === '/booking')
          if (!booking) throw new Error('Upgraded booking page is missing')
          return {
            missingBefore,
            missingAfter: needsCorePageSource(upgraded),
            inputUnchanged:
              JSON.stringify(document.presentation.pages) === JSON.stringify(beforeInput),
            ownerCssUnchanged:
              JSON.stringify(booking.content.sv.css) === JSON.stringify(page.content.sv.css) &&
              JSON.stringify(booking.content.en.css) === JSON.stringify(page.content.en.css),
            ownerEditKept: ['sv', 'en'].every((lang) =>
              ['desktop-booking', 'mobile-booking'].every((surface) => {
                const tree = new globalThis.DOMParser().parseFromString(
                  booking.content[lang].html,
                  'text/html',
                )
                const flow = tree.querySelector(
                  `[data-knc-surface="${surface}"] [data-knc-fold="booking-flow"]`,
                )
                return (
                  flow?.textContent === `Owner ${lang} booking edit` &&
                  flow.id === `legacy-${lang}-${surface}`
                )
              }),
            ),
            markers: ['sv', 'en'].map((lang) => {
              const html = booking.content[lang].html
              const tree = new globalThis.DOMParser().parseFromString(html, 'text/html')
              return ['desktop-booking', 'mobile-booking'].map((surface) => {
                const shell = tree.querySelector(`[data-knc-surface="${surface}"]`)
                const flow = shell.querySelector('[data-knc-fold="booking-flow"]')
                return {
                  surface,
                  marker: Boolean(flow),
                  ownerText: flow?.textContent,
                  previewId: flow?.id,
                }
              })
            }),
          }
        }, captured)
        assert.equal(
          legacyUpgrade.missingBefore,
          true,
          'legacy booking shells require source upgrade',
        )
        assert.equal(
          legacyUpgrade.missingAfter,
          false,
          'both booking shell markers should be restored',
        )
        assert.equal(
          legacyUpgrade.inputUnchanged,
          true,
          'upgrade must not mutate the owner document',
        )
        assert.equal(
          legacyUpgrade.ownerCssUnchanged,
          true,
          'marker upgrade must preserve owner styles',
        )
        assert.equal(
          legacyUpgrade.ownerEditKept,
          true,
          'stable source-ID upgrade must preserve owner markup',
        )
        assert.deepEqual(legacyUpgrade.markers, [
          [
            {
              surface: 'desktop-booking',
              marker: true,
              ownerText: 'Owner sv booking edit',
              previewId: 'legacy-sv-desktop-booking',
            },
            {
              surface: 'mobile-booking',
              marker: true,
              ownerText: 'Owner sv booking edit',
              previewId: 'legacy-sv-mobile-booking',
            },
          ],
          [
            {
              surface: 'desktop-booking',
              marker: true,
              ownerText: 'Owner en booking edit',
              previewId: 'legacy-en-desktop-booking',
            },
            {
              surface: 'mobile-booking',
              marker: true,
              ownerText: 'Owner en booking edit',
              previewId: 'legacy-en-mobile-booking',
            },
          ],
        ])
        await page.getByRole('button', { name: 'Bokning', exact: true }).click()
        await page.getByRole('button', { name: 'Mörk', exact: true }).click()
        const checks = []
        for (const [scene, label] of [
          ['booking-options', 'Välj en dag'],
          ['booking-details', 'Dina uppgifter'],
          ['booking-confirmation', 'Tack — din tid är bokad!'],
        ]) {
          await page.getByLabel('Visa i editorn', { exact: true }).selectOption(scene)
          await frame.getByText(label, { exact: true }).waitFor({ state: 'visible' })
          for (const device of ['Dator', 'Mobil']) {
            await page.getByRole('button', { name: device, exact: true }).click()
            await page.waitForFunction(
              (width) => globalThis.document.querySelector('.gjs-frame').clientWidth === width,
              device === 'Dator' ? 1440 : 390,
            )
            const surface = device === 'Dator' ? 'desktop-booking' : 'mobile-booking'
            const shell = frame.locator(`[data-knc-surface="${surface}"]`)
            const flow = shell.locator('[data-knc-fold="booking-flow"]')
            const stage = flow.locator(`[data-knc-surface="${scene}"]`)
            await shell.waitFor({ state: 'visible' })
            await flow.waitFor({ state: 'visible' })
            await stage.waitFor({ state: 'visible' })
            if (scene !== 'booking-options')
              await flow
                .locator('[data-knc-surface="booking-options"]')
                .waitFor({ state: 'visible' })
            const pageFrame = await shell.evaluate((node, currentScene) => {
              const doc = node.ownerDocument
              const shellHeader = node.querySelector(
                'button[aria-label*="språk"],button[aria-label*="language"]',
              )
              const flow = node.querySelector('[data-knc-fold="booking-flow"]')
              return {
                headerControl: Boolean(shellHeader),
                hero: Boolean(node.querySelector('main,[data-knc-fold="panel"]')),
                flow: Boolean(flow),
                sceneRoots: doc.querySelectorAll(`[data-knc-surface="${currentScene}"]`).length,
              }
            }, scene)
            assert.equal(
              pageFrame.headerControl,
              true,
              `${device} ${scene} must retain the site header controls`,
            )
            assert.equal(pageFrame.hero, true, `${device} ${scene} must retain the page layout`)
            assert.equal(pageFrame.flow, true, `${device} ${scene} must retain the booking flow`)
            assert.equal(pageFrame.sceneRoots, 1, `${device} ${scene} must render once`)
            if (scene === 'booking-options') {
              const lastTime = frame.getByRole('button', { name: '12:00', exact: true })
              await lastTime.waitFor({ state: 'visible' })
              await shot(`${scene}-${device}-before-scroll`)
              await shell.evaluate((node, isMobile) => {
                if (isMobile) node.scrollTop = 0
                else node.ownerDocument.defaultView?.scrollTo(0, 0)
              }, device === 'Mobil')
              const scroll = await lastTime.evaluate((button, isMobile) => {
                const doc = button.ownerDocument
                const win = doc.defaultView
                const root = isMobile
                  ? doc.querySelector('[data-knc-surface="mobile-booking"]')
                  : doc.scrollingElement
                if (!win || !root) throw new Error('Booking page scroll root is missing')
                const before = button.getBoundingClientRect()
                button.scrollIntoView({ block: 'end', inline: 'nearest' })
                const after = button.getBoundingClientRect()
                return {
                  beforeBottom: before.bottom,
                  afterTop: after.top,
                  afterBottom: after.bottom,
                  viewportHeight: doc.documentElement.clientHeight,
                  scrollHeight: root.scrollHeight,
                  scrollTop: root.scrollTop,
                  overflowY: win.getComputedStyle(root).overflowY,
                }
              }, device === 'Mobil')
              if (device === 'Mobil')
                assert.ok(
                  scroll.beforeBottom > scroll.viewportHeight,
                  'mobile last time control must start below the fold: ' + JSON.stringify(scroll),
                )
              assert.ok(
                scroll.afterTop >= -1 && scroll.afterBottom <= scroll.viewportHeight + 1,
                `${device} last time control must remain reachable: ${JSON.stringify(scroll)}`,
              )
              assert.ok(
                scroll.scrollHeight >= scroll.afterBottom &&
                  scroll.scrollTop > 0 &&
                  (device !== 'Mobil' || scroll.overflowY === 'auto'),
                `${device} booking page must scroll to its last time: ${JSON.stringify(scroll)}`,
              )
              await shot(`${scene}-${device}-after-scroll`)
              checks.push({ scene, device, scroll })
            } else {
              await shot(`${scene}-${device}`)
              checks.push({ scene, device, fullPage: true })
            }
          }
        }
        return checks
      },
      {
        document: globalThis.structuredClone(seed),
        setup: async (context) => {
          const cors = {
            'Access-Control-Allow-Origin': new URL(base).origin,
            'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          }
          await context.route('**/rest/v1/rpc/public_booking_catalog', async (route) => {
            if (route.request().method() === 'OPTIONS')
              return route.fulfill({ status: 204, headers: cors })
            return route.fulfill({ status: 200, headers: cors, json: bookingCatalog })
          })
        },
      },
    )
    await check('5-comparison-font-parity', async ({ page, frame, shot }) => {
      await frame.locator('[data-knc-surface="desktop-home"] [data-knc-surface="about"]').waitFor()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      const appearance = (locator) =>
        locator.evaluate(async (node) => {
          await node.ownerDocument.fonts.ready
          const css = getComputedStyle(node)
          const range = node.ownerDocument.createRange()
          range.selectNodeContents(node)
          const view = node.ownerDocument.defaultView
          const documentElement = node.ownerDocument.documentElement
          return {
            family: css.fontFamily,
            weight: css.fontWeight,
            size: css.fontSize,
            loaded: node.ownerDocument.fonts.check(`${css.fontSize} ${css.fontFamily}`),
            viewport: {
              innerWidth: view.innerWidth,
              clientWidth: documentElement.clientWidth,
              innerHeight: view.innerHeight,
              clientHeight: documentElement.clientHeight,
            },
            scrollbarGutter: view.innerWidth - documentElement.clientWidth,
            blockWidth: node.getBoundingClientRect().width,
            textLines: Array.from(range.getClientRects(), (rect) => [rect.width, rect.height]),
          }
        })
      await page.waitForFunction(
        () => globalThis.document.querySelector('.gjs-frame').clientWidth === 390,
      )
      const expected = await appearance(frame.locator('[data-knc-surface="about"] h2').first())
      await page.getByRole('button', { name: 'Dator', exact: true }).click()
      await page.getByRole('button', { name: 'Jämför', exact: true }).click()
      const comparison = page.frameLocator('iframe[title="Jämförelsevy"]')
      await comparison.locator('[data-knc-surface="about"] h2').first().waitFor()
      await page.waitForFunction(async () => {
        const iframe = globalThis.document.querySelector('iframe[title="Jämförelsevy"]')
        const doc = iframe?.contentDocument
        if (!doc?.defaultView) return false
        const first = {
          innerWidth: doc.defaultView.innerWidth,
          clientWidth: doc.documentElement.clientWidth,
          innerHeight: doc.defaultView.innerHeight,
          clientHeight: doc.documentElement.clientHeight,
        }
        await new Promise((resolve) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
        )
        const view = doc.defaultView
        const root = doc.documentElement
        return (
          view.innerWidth === first.innerWidth &&
          root.clientWidth === first.clientWidth &&
          view.innerHeight === first.innerHeight &&
          root.clientHeight === first.clientHeight
        )
      })
      const actual = await appearance(comparison.locator('[data-knc-surface="about"] h2').first())
      await shot('comparison')
      await writeFile(
        `${out}/${engineName}-comparison-font-metrics.json`,
        JSON.stringify({ expected, actual }, null, 2),
      )
      assert.deepEqual(
        { width: actual.viewport.innerWidth, height: actual.viewport.innerHeight },
        { width: expected.viewport.innerWidth, height: expected.viewport.innerHeight },
        'comparison must use the same iframe viewport',
      )
      assert.equal(
        actual.viewport.clientWidth - actual.blockWidth,
        expected.viewport.clientWidth - expected.blockWidth,
        'comparison must preserve layout inset within each content viewport',
      )
      assert.equal(expected.loaded, true, 'editor must load the requested font')
      assert.equal(actual.loaded, true, 'comparison must load the requested font')
      assert.deepEqual(
        { family: actual.family, weight: actual.weight, size: actual.size, loaded: actual.loaded },
        {
          family: expected.family,
          weight: expected.weight,
          size: expected.size,
          loaded: expected.loaded,
        },
        'comparison must load same font face and style',
      )
      assert.deepEqual(
        actual.textLines,
        expected.textLines,
        'comparison must preserve text geometry',
      )
      return { expected, actual }
    })
  } finally {
    await browser.close()
  }
}
if (scenarioFilter && results.length === 0)
  throw new Error(`No reported CMS scenario matched CMS_REPORTED_SCENARIO=${scenarioFilter}`)
await writeFile(`${out}/reported-results.json`, JSON.stringify(results, null, 2))
for (const result of results)
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ${result.engine}/${result.id}${result.error ? `\n${result.error}` : ''}`,
  )
assert.equal(results.filter((r) => !r.passed).length, 0, 'owner-reported CMS defects remain')
