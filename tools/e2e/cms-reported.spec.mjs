import { routeApi } from './route-api.mjs'
import { barberFixture, documentFixture } from './builders.mjs'
/* global getComputedStyle */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { EMAIL_NAMES } from '../../packages/content-contracts/src/cms.ts'
import {
  SITE_PAGE_CSS,
  createSitePage,
  dropFrozenChrome,
  renderSitePage,
} from '../../packages/content-contracts/src/site-page.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'
import { nativeBackend } from './cms-backend.mjs'
import { loadWorker, renderPublicDocument, routeWorkerDocuments } from './cms-render.mjs'
import { expect, test as baseTest } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
const base = harnessOrigin
const SOURCE_SHELL = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const seed = documentFixture()
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
// One uploaded font in the published head, so the canvas carries its @font-face sheet.
const UPLOADED_FONT_ID = '6f1d2c3b-4a5e-4f70-8a9b-0c1d2e3f4a5b'
const fontSeed = globalThis.structuredClone(seed)
fontSeed.presentation.fonts = {
  [UPLOADED_FONT_ID]: {
    ref: { bucket: 'cms-library', path: 'fonts/reload-check.woff2' },
    name: 'Reload Check',
  },
}
const gate = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const test = baseTest.extend({
  catalogFixture: [false, { option: true }],
  fontFixture: [false, { option: true }],
  productionFixture: [false, { option: true }],
  studio: async (
    { page, context, browserName, evidenceDir, catalogFixture, fontFixture, productionFixture },
    use,
    info,
  ) => {
    page.setDefaultTimeout(15000)
    const document = globalThis.structuredClone(fontFixture ? fontSeed : seed)
    if (productionFixture)
      document.presentation = JSON.parse(
        gunzipSync(readFileSync(new URL('./fixtures/presentation.json.gz', import.meta.url))),
      ).presentation
    const options = {}
    const backend = await nativeBackend(context, document, [], undefined, options)
    if (catalogFixture) {
      await routeApi(context, [
        [
          '**/rest/v1/rpc/public_booking_catalog',
          (route, headers) => route.fulfill({ status: 200, headers, json: bookingCatalog }),
        ],
      ])
    }
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.locator('[data-knc-surface="desktop-home"]').waitFor()
    // Stored pages open before optional capture completes. These upgrade cases need the
    // Contact page that successful capture actually adopts, within the existing test deadline.
    if (productionFixture)
      await page.getByRole('button', { name: 'Kontakt', exact: true }).waitFor({
        timeout: info.timeout,
      })
    const shot = (suffix) =>
      page.screenshot({
        path: `${evidenceDir}/${browserName}-${info.title}-${suffix}.png`,
        animations: 'disabled',
      })
    // Export also reads pristine drafts, which intentionally have no automatic backup.
    const capture = async () => {
      const panel = page.getByRole('dialog', { name: 'Utkast & backup', exact: true })
      const opened = await panel.isVisible()
      if (!opened) await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        panel.getByRole('button', { name: 'Export', exact: true }).click(),
      ])
      const path = await download.path()
      if (!path) throw new Error('The exported draft has no local file')
      const document = JSON.parse(readFileSync(path, 'utf8'))
      if (!opened) await panel.getByRole('button', { name: 'Stäng panel', exact: true }).click()
      return document
    }
    // From now on the backend holds every `operation` request until the returned `done` is released.
    const hold = (operation) => {
      options.delay = { operation, started: gate(), done: gate() }
      return options.delay
    }
    await use({ backend, frame, shot, capture, hold })
    assert.deepEqual(errors, [], 'no unhandled browser errors')
  },
})
const select = (page, selector) =>
  page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const component =
      selector === 'body' ? editor.getWrapper() : editor.getWrapper().find(selector)[0]
    if (!component) throw new Error(`Missing component ${selector}`)
    editor.select(component)
  }, selector)
const create = async (page, { name = 'Reported page', path = '/reported-page' } = {}) => {
  await page.getByRole('button', { name: 'Mörk', exact: true }).click()
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ny sida', exact: true })
  await dialog.getByLabel('Sidnamn', { exact: true }).fill(name)
  await dialog.getByLabel('Adress', { exact: true }).fill(path)
  await dialog.getByRole('button', { name: 'Skapa sida', exact: true }).click()
  await page.frameLocator('.gjs-frame').getByRole('heading', { name, exact: true }).waitFor()
}
// Contact-named ids on an ordinary page are plain content; the Worker fills them only on /contact.
const VISIT_BODY =
  '<main><h2 id="contact-title">Besöksadress</h2><p id="contact-details">Telefon <span>031-555 12 34</span></p><h3 id="contact-hours">Öppettider</h3><h3 id="owner-heading">Ägarens rubrik</h3></main>'
const VISIT_SLOTS = [
  '#contact-title',
  '#contact-details',
  '#contact-details span',
  '#contact-hours',
  '#owner-heading',
]
const CONTACT_SLOTS = ['#contact-title', '#contact-details', '#contact-hours']
// A historical Contact body: the three ids without the managed marker or the business spans.
const HISTORICAL_CONTACT_BODY =
  '<main><h1 id="contact-title">Kontakt till salongen</h1><div id="contact-details"><p>Telefon 031-555 12 34</p></div><h2 id="contact-hours">Öppettider</h2></main>'
// The name and city spans as GrapesJS exports them. The Worker fills them on /contact, marked or
// not, and serves them as authored on every other page.
const BUSINESS_SPANS =
  '<p>Hitta <span data-business-name="">Ägarens visningsnamn</span> i <span data-business-city="">Ägarens ort</span></p>'
const BUSINESS_SLOTS = ['[data-business-name]', '[data-business-city]']
const HISTORICAL_CONTACT_SPANS_BODY = HISTORICAL_CONTACT_BODY.replace(
  '</h1>',
  `</h1>${BUSINESS_SPANS}`,
)
// Imported or copied Contact markup that keeps its marker on another page, on the body itself and
// on a nested section.
const MARKED_VISIT_BODY = `<main data-business-contact-page="1"><h1 id="contact-title">Besök</h1>${BUSINESS_SPANS}</main>`
const MARKED_SECTION_BODY = `<main><section data-business-contact-page="1"><h2>Hitta hit</h2>${BUSINESS_SPANS}</section></main>`
// The inspector can keep a previous selection's state, so prove the selection changed first.
const isSelected = (page, selector) =>
  page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    return editor.getSelected() === editor.getWrapper().find(selector)[0]
  }, selector)
const expectContactSlotsLocked = async (page) => {
  const inspector = page.locator('#cms-inspector')
  for (const selector of CONTACT_SLOTS) {
    await select(page, selector)
    expect(await isSelected(page, selector)).toBe(true)
    await expect(
      inspector.getByText('Uppgiften hämtas från Företag & SEO', { exact: false }),
    ).toBeVisible()
    await expect(inspector.getByLabel('Text', { exact: true })).toHaveCount(0)
    await expect(inspector.getByRole('button', { name: 'Ta bort', exact: true })).toBeDisabled()
  }
  const editable = await page.evaluate(async (selectors) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    return selectors.map((selector) => editor.getWrapper().find(selector)[0].get('editable'))
  }, CONTACT_SLOTS)
  expect(editable).toEqual(CONTACT_SLOTS.map(() => false))
}
// [editable, removable, copyable] of the name span, the city span and the paragraph holding them.
const businessFlags = (page) =>
  page.evaluate(async (selectors) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const spans = selectors.map((selector) => editor.getWrapper().find(selector)[0])
    return [...spans, spans[0].parent()].map((node) => [
      node.get('editable'),
      node.get('removable'),
      node.get('copyable'),
    ])
  }, BUSINESS_SLOTS)
const selectBusinessParagraph = (page) =>
  page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const paragraph = editor.getWrapper().find('[data-business-name]')[0].parent()
    editor.select(paragraph)
    return editor.getSelected() === paragraph
  })
// `state` is 'locked' where the Worker fills the spans and 'editable' where it serves them as authored.
const expectBusinessSpans = async (page, state) => {
  const locked = state === 'locked'
  expect(await businessFlags(page)).toEqual([0, 1, 2].map(() => [!locked, !locked, !locked]))
  const inspector = page.locator('#cms-inspector')
  const remove = inspector.getByRole('button', { name: 'Ta bort', exact: true })
  const copy = inspector.getByRole('button', { name: 'Duplicera', exact: true })
  for (const selector of BUSINESS_SLOTS) {
    await select(page, selector)
    expect(await isSelected(page, selector)).toBe(true)
    if (locked) {
      await expect(
        inspector.getByText('Uppgiften hämtas från Företag & SEO', { exact: false }),
      ).toBeVisible()
      await expect(inspector.getByLabel('Text', { exact: true })).toHaveCount(0)
      await expect(remove).toBeDisabled()
      await expect(copy).toBeDisabled()
    } else {
      await expect(inspector.getByText(/Uppgiften hämtas|Funktionsblocket är skyddat/)).toHaveCount(
        0,
      )
      await expect(inspector.getByLabel('Text', { exact: true })).toBeVisible()
      await expect(remove).toBeEnabled()
      await expect(copy).toBeEnabled()
    }
  }
  // The holding paragraph edits its own words either way, one field per text node.
  expect(await selectBusinessParagraph(page)).toBe(true)
  await expect(inspector.getByLabel(/^Text( \d)?$/).first()).toBeVisible()
  if (locked) {
    await expect(remove).toBeDisabled()
    await expect(copy).toBeDisabled()
  } else {
    await expect(inspector.getByText(/Uppgiften hämtas|Funktionsblocket är skyddat/)).toHaveCount(0)
    await expect(remove).toBeEnabled()
    await expect(copy).toBeEnabled()
  }
}
// The Studio JSON import, as the Contact tests below use it: it replaces the draft.
const importDocument = async (page, document, name) => {
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click()
}
const openSector = async (page, name) => {
  const sector = page.getByRole('button', { name, exact: true })
  if ((await sector.getAttribute('aria-expanded')) !== 'true') await sector.click()
  assert.equal(await sector.getAttribute('aria-expanded'), 'true')
}
// 2 × max per-case nearest-rank p95 of passing durations across the supplied full reports.
// Limiting sample: durations-cms.json:4589 (42607 ms); budget = 42607 × 2.
test.describe.configure({ timeout: 85_214 })

test.use({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
  contextOptions: { reducedMotion: 'reduce' },
})

for (const partial of [false, true])
  test(`legacy owner Contact ${partial ? 'with a partial business slot' : 'without business slots'} survives validation and publication`, async ({
    page,
    context,
  }) => {
    const document = documentFixture()
    const html =
      '<main class="owner-contact"><h1>Owner contact</h1>' +
      (partial ? '<p><span data-business-name="">Ägarens namn</span></p>' : '') +
      '<p>Ägarens tidigare kontakttext</p></main>'
    const variant = {
      html,
      css: { light: '.owner-contact{padding:24px}', dark: '.owner-contact{padding:24px}' },
    }
    const contact = {
      id: '90000000-0000-4000-8000-000000000007',
      path: '/contact',
      kind: 'page',
      layout: 'independent',
      name: { sv: 'Tidigare kontakt', en: 'Earlier contact' },
      title: { sv: 'Ägarens kontakt', en: 'Owner contact' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: { sv: globalThis.structuredClone(variant), en: globalThis.structuredClone(variant) },
    }
    document.presentation.pages = [contact]
    const backend = await nativeBackend(context, document)
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    // This is the same shared validation pipeline used by the real cms-studio validate/publish
    // handlers. An arbitrary legacy body must not depend on capturing a replacement template.
    const validated = await page.evaluate(async (document) => {
      const { cmsApi } = await import('/modules/studio/src/api.ts')
      return cmsApi.validate(document)
    }, document)
    expect(validated.document.presentation.pages[0].content).toEqual(contact.content)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'Tidigare kontakt', exact: true }).click()
    await page
      .frameLocator('.gjs-frame')
      .first()
      .getByRole('heading', { name: 'Owner contact' })
      .waitFor()
    expect(backend.writes).toEqual([])
    await page
      .locator('.cms-page-meta')
      .getByLabel('Namn', { exact: true })
      .fill('Kontakt efter uppgradering')
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
    const published = backend.document.presentation.pages.find((item) => item.path === '/contact')
    expect(published.content).toEqual(contact.content)
    expect(published.id).toBe(contact.id)
    expect(published.name.sv).toBe('Kontakt efter uppgradering')
    expect(backend.writes).toEqual(['publish'])
    expect(backend.requests.map(({ operation }) => operation)).toContain('validate')
    expect(backend.requests.map(({ operation }) => operation)).toContain('publish')
  })

test('locked information previews match the editor and Worker layout, fonts and background in both modes', async ({
  page,
  context,
  studio,
}) => {
  const document = await studio.capture()
  const rendering = await loadWorker()
  const visitor = await context.newPage()
  const pages = [
    ['/contact', 'Kontakt'],
    ['/privacy', 'Integritetspolicy'],
    ['/terms', 'Bokningsvillkor'],
  ]
  const paint = (main) =>
    main.evaluate((element) => {
      const doc = element.ownerDocument
      const style = getComputedStyle(element)
      const heading = getComputedStyle(element.querySelector('h1'))
      const backgrounds = []
      for (let current = element; current; current = current.parentElement)
        backgrounds.push(getComputedStyle(current).backgroundColor)
      return {
        scheme: getComputedStyle(doc.documentElement).colorScheme,
        background: backgrounds.find(
          (color) => !['transparent', 'rgba(0, 0, 0, 0)'].includes(color),
        ),
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        maxWidth: style.maxWidth,
        padding: style.padding,
        lineHeight: style.lineHeight,
        headingSize: heading.fontSize,
      }
    })
  const loadedFonts = (main) =>
    main.evaluate((element) => element.ownerDocument.fonts.ready.then(() => undefined))
  try {
    await routeWorkerDocuments(visitor, {
      origin: new URL(base).origin,
      paths: pages.map(([path]) => path),
      worker: rendering.worker,
      presentation: document.presentation,
      shell: SOURCE_SHELL,
    })
    await page.bringToFront()
    for (const [path, name] of pages) {
      await page.getByRole('button', { name, exact: true }).click()
      for (const [name, mode] of [
        ['Mörk', 'dark'],
        ['Ljus', 'light'],
      ]) {
        await page.getByRole('button', { name, exact: true }).click()
        const editorMain = studio.frame.locator('main.bb-doc')
        await editorMain.waitFor()
        await loadedFonts(editorMain)
        await expect
          .poll(() => paint(editorMain))
          .toMatchObject({
            scheme: mode,
            maxWidth: '736px',
            background: mode === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)',
          })
        const reference = await paint(editorMain)
        expect(reference.fontFamily).toContain('Inter Variable')
        await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
        const preview = page.frameLocator('.cms-live-preview iframe').locator('main.bb-doc')
        await preview.waitFor()
        await loadedFonts(preview)
        await expect
          .poll(() => paint(preview), { message: `locked ${path} in ${mode}` })
          .toEqual(reference)
        await visitor.goto(`${base}${path}?mode=${mode}`, { waitUntil: 'load' })
        const publicMain = visitor.locator('#root main.bb-doc')
        await loadedFonts(publicMain)
        await expect
          .poll(() => paint(publicMain), { message: `public ${path} in ${mode}` })
          .toEqual(reference)
        await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
      }
    }
    expect(studio.backend.writes).toEqual([])
  } finally {
    await visitor.close()
    await rendering.close()
  }
})

test.describe('contact upgrade', () => {
  test.use({ productionFixture: true })
  test('contact import upgrades the production fixture once and preserves an existing contact', async ({
    page,
    studio,
  }, testInfo) => {
    const fixture = JSON.parse(
      gunzipSync(readFileSync(new URL('./fixtures/presentation.json.gz', import.meta.url))),
    ).presentation
    const source = await studio.capture()
    const result = await page.evaluate(
      async ({ fixture, source }) => {
        const { ensureCorePages, hasCorePageLayouts, needsCorePageSource } =
          await import('/modules/studio/src/corePages.ts')
        const { emptyDocument } = await import('/packages/content-contracts/src/cms.ts')
        const document = emptyDocument()
        document.presentation = fixture
        const before = JSON.stringify(document)
        const completeBefore = hasCorePageLayouts(document)
        const missingContact = globalThis.structuredClone(source)
        missingContact.presentation.pages = missingContact.presentation.pages.filter(
          (item) => item.path !== '/contact',
        )
        const needsContactSource = needsCorePageSource(missingContact)
        // The production About layout can still need optional gallery fold metadata. Contact
        // import guarantees stored core layouts, not completion of every older native upgrade.
        const storedLayoutsComplete = hasCorePageLayouts(source)
        const upgraded = ensureCorePages(document, source.presentation.pages)
        const contact = upgraded.presentation.pages.find((item) => item.path === '/contact')
        if (!contact) throw new Error('The Studio source did not import /contact')
        const repeated = ensureCorePages(upgraded, source.presentation.pages)
        const ownerDocument = globalThis.structuredClone(upgraded)
        const ownerContact = ownerDocument.presentation.pages.find(
          (item) => item.path === '/contact',
        )
        ownerContact.title.sv = 'Ägarens kontakt'
        ownerContact.content.sv.html += '\n<p  class="owner-copy">Ägarens text</p>\n'
        ownerContact.content.en.css.dark = '.owner-copy { margin: 2rem; }'
        const ownerBefore = JSON.stringify(ownerContact)
        const preserved = ensureCorePages(ownerDocument, source.presentation.pages)
        return {
          completeBefore,
          needsContactSource,
          storedLayoutsComplete,
          completeAfter: hasCorePageLayouts(upgraded),
          inputUnchanged: JSON.stringify(document) === before,
          count: repeated.presentation.pages.filter((item) => item.path === '/contact').length,
          stable: JSON.stringify(repeated) === JSON.stringify(upgraded),
          existingUnchanged:
            JSON.stringify(
              preserved.presentation.pages.find((item) => item.path === '/contact'),
            ) === ownerBefore,
          contact,
          bytes: {
            before: new globalThis.TextEncoder().encode(before).byteLength,
            after: new globalThis.TextEncoder().encode(JSON.stringify(upgraded)).byteLength,
            contact: new globalThis.TextEncoder().encode(JSON.stringify(contact)).byteLength,
          },
        }
      },
      { fixture, source },
    )
    expect(result.completeBefore).toBe(false)
    expect(result.needsContactSource).toBe(true)
    expect(result.storedLayoutsComplete).toBe(true)
    expect(result.completeAfter).toBe(true)
    expect(result.inputUnchanged).toBe(true)
    expect(result.count).toBe(1)
    expect(result.stable).toBe(true)
    expect(result.existingUnchanged).toBe(true)
    for (const variant of Object.values(result.contact.content)) {
      expect(variant.html).toContain('class="bb-page bb-doc"')
      expect(variant.html).toContain('data-business-contact-page="1"')
      expect(variant.html).toContain('data-business-name')
      expect(variant.html).toContain('id="contact-details"')
      expect(variant.html).toContain('id="contact-hours"')
      expect(variant.html).not.toMatch(/<script|<link|<html|<body/)
      expect(variant.css).toEqual({ light: '', dark: '' })
    }
    expect(result.contact.title).toEqual({ sv: '', en: '' })
    expect(result.contact.content.en.html).toContain('Visiting')
    expect(result.contact.content.sv.html).toContain('Besöksadress')
    testInfo.annotations.push({
      type: 'contact-upgrade-bytes',
      description: JSON.stringify(result.bytes),
    })
    await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
    await studio.frame.locator('#contact-title').waitFor()
    for (const [name, mode] of [
      ['Mörk', 'dark'],
      ['Ljus', 'light'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const doc = globalThis.document.querySelector('.gjs-frame').contentDocument
            return {
              sheets: [...doc.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
                link.getAttribute('href'),
              ),
              mode: doc.documentElement.style.colorScheme,
            }
          }),
        )
        .toEqual({ sheets: ['/tokens.css', '/info.css'], mode })
    }
  })

  for (const overlapping of [false, true])
    test(`contact upgrade preserves a backup contact edit after ${overlapping ? 'resolving a settings conflict' : 'a server-only settings edit'}`, async ({
      page,
      studio,
    }) => {
      const backup = await savedBackup(page)
      expect(backup.base.presentation.pages.some((item) => item.path === '/contact')).toBe(false)
      const draft = globalThis.structuredClone(backup.document)
      const contact = draft.presentation.pages.find((item) => item.path === '/contact')
      contact.content.sv.html += '<p>Ägarens sparade kontakttext</p>'
      if (overlapping) draft.settings.business_legal_name = 'Ägarens AB'
      studio.backend.document.settings.business_legal_name = 'Serverns AB'
      // Reload before seeding: the mounted Studio saves its own draft on pagehide.
      await page.reload()
      await page.evaluate(
        async ({ backup, draft }) => {
          const session = await (await import('/modules/studio/src/backup.ts')).cmsBackups()
          session.schedule({
            document: draft,
            base: backup.base,
            revision: backup.revision,
            fingerprint: backup.fingerprint,
          })
          await session.flush()
        },
        { backup, draft },
      )
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      if (overlapping) {
        await page
          .getByRole('button', { name: 'Använd serverns konfliktändringar', exact: true })
          .click()
        await page.getByText('Konflikten är löst i utkastet. Granska före publicering.').waitFor()
      } else await page.getByText('Ett lokalt utkast från', { exact: false }).waitFor()
      await expect
        .poll(async () => {
          const recovered = await studio.capture()
          return {
            contacts: recovered.presentation.pages.filter((item) => item.path === '/contact'),
            legalName: recovered.settings.business_legal_name,
          }
        })
        .toEqual({ contacts: [contact], legalName: 'Serverns AB' })
      await expect(
        page.getByText('Publicering är blockerad tills konflikten är löst.', { exact: true }),
      ).not.toBeVisible()
      expect(
        studio.backend.document.presentation.pages.some((item) => item.path === '/contact'),
      ).toBe(false)
    })
})

test('contact remains core after import with another id, a name edit and menu visibility', async ({
  page,
  studio,
}) => {
  const document = await studio.capture()
  const contact = document.presentation.pages.find((item) => item.path === '/contact')
  if (!contact) throw new Error('Missing imported contact')
  contact.id = '90000000-0000-4000-8000-000000000007'
  contact.inMenu = true
  contact.layout = 'independent'
  document.presentation.pages.push({
    ...globalThis.structuredClone(contact),
    id: '90000000-0000-4000-8000-000000000008',
    path: '/review-created',
    name: { sv: 'Skapad sida', en: 'Created page' },
  })
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'contact-another-id.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click()
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  await expect(studio.frame.locator('#cms-site-shell')).toHaveCount(0)
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    cmsGrapes.editors.at(-1).select()
  })
  const meta = page.locator('.cms-page-meta')
  await expect(meta.getByLabel('Adress', { exact: true })).toBeDisabled()
  await expect(meta.getByLabel('Adress', { exact: true })).toHaveValue('/contact')
  await expect(meta.getByRole('button', { name: 'Ta bort', exact: true })).toHaveCount(0)
  await expect(meta.getByRole('button', { name: 'Duplicera', exact: true })).toHaveCount(0)
  await meta.getByLabel('Namn', { exact: true }).fill('Kontakt till salongen')
  const edited = await studio.capture()
  expect(edited.presentation.pages.filter((item) => item.path === '/contact')).toHaveLength(1)
  expect(edited.presentation.pages.find((item) => item.id === contact.id)?.path).toBe('/contact')
  await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
  const creation = page.getByRole('dialog', { name: 'Ny sida', exact: true })
  await creation.getByLabel('Sidnamn', { exact: true }).fill('Kontaktkopia')
  await creation.getByLabel('Adress', { exact: true }).fill('/contact')
  await creation.getByRole('button', { name: 'Skapa sida', exact: true }).click()
  await expect(creation.getByRole('alert')).toContainText('Ange en unik, giltig adress')
  await creation.getByRole('button', { name: 'Avbryt', exact: true }).click()
  const links = await page.evaluate(async (presentation) => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { NativeSiteProvider } = await import('/modules/public-web/src/cms/NativeSurface.tsx')
    const { SitePageLinks } = await import('/modules/public-web/src/cms/SitePageLinks.tsx')
    const { menuLinks } = await import('/packages/content-contracts/src/site-page.ts')
    const { isNativePublicPath } = await import('/modules/public-web/src/site/routeMetadata.ts')
    const host = globalThis.document.createElement('div')
    try {
      render(
        h(NativeSiteProvider, { presentation }, h(SitePageLinks, { lang: 'sv', mode: 'light' })),
        host,
      )
      return {
        native: isNativePublicPath('/contact'),
        spa: [...host.querySelectorAll('a')].map(
          (link) => new URL(link.getAttribute('href'), globalThis.location.origin).pathname,
        ),
        derived: menuLinks(presentation, 'sv', 'light').map((link) => link.href.split('?')[0]),
      }
    } finally {
      render(null, host)
    }
  }, edited.presentation)
  expect(links.native).toBe(false)
  // Contact can be in the menu, as on main (owner decision, 2026-11-03): Visa i meny lists it with
  // the created pages, in presentation order.
  expect(links.spa).toEqual(['/contact', '/review-created'])
  expect(links.derived).toEqual(['/', '/booking', '/about', '/contact', '/review-created'])
  await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
  const preview = page.locator('.cms-live-preview iframe')
  await expect(preview).toHaveAttribute('sandbox', 'allow-same-origin')
  await expect(preview).not.toHaveAttribute('src', /cms-public\/source/)
  await expect(
    page.frameLocator('.cms-live-preview iframe').locator('#contact-title'),
  ).toBeVisible()
  await expect(
    page.frameLocator('.cms-live-preview iframe').locator('#cms-site-shell'),
  ).toHaveCount(0)
})

// Visa i meny is offered only where it has an effect: on created pages and on Contact.
test('Visa i meny shows only on Contact and created pages, and puts Contact in the live header', async ({
  page,
  studio,
}) => {
  await create(page, { name: 'Besök', path: '/visit' })
  const meta = page.locator('.cms-page-meta')
  const menu = meta.getByLabel('Visa i meny', { exact: true })
  const open = async (name, path) => {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: 'Sidinställningar', exact: true }).click()
    await expect(meta.getByLabel('Adress', { exact: true })).toHaveValue(path)
  }
  // Om oss has no page of its own here: it is edited on Startsida.
  for (const [name, path] of [
    ['Startsida', '/'],
    ['Bokning', '/booking'],
    ['Mina bokningar', '/my-bookings'],
    ['Integritetspolicy', '/privacy'],
    ['Bokningsvillkor', '/terms'],
  ]) {
    await open(name, path)
    await expect(menu).toHaveCount(0)
  }
  await open('Besök', '/visit')
  await expect(menu).toBeChecked()
  await studio.frame.locator('#cms-site-menu a[href^="/visit?"]').waitFor()
  await expect(studio.frame.locator('#cms-site-menu a[href^="/contact?"]')).toHaveCount(0)
  await open('Kontakt', '/contact')
  await expect(menu).not.toBeChecked()
  await menu.check()
  await open('Besök', '/visit')
  await expect(studio.frame.locator('#cms-site-menu a[href^="/contact?"]')).toHaveText('Kontakt')
})

test('contact slots are server-owned in Studio and the locked preview fills them', async ({
  page,
  studio,
}) => {
  const document = await studio.capture()
  Object.assign(document.settings, {
    business_name: 'Salongen Kontakt',
    business_phone_display: '031-555 12 34',
    business_phone_tel: '+46315551234',
  })
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'contact-slots.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click()
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  const inspector = page.locator('#cms-inspector')
  for (const selector of ['#contact-title', '#contact-details']) {
    await select(page, selector)
    await expect(
      inspector.getByText('Uppgiften hämtas från Företag & SEO', { exact: false }),
    ).toBeVisible()
    await expect(inspector.getByLabel('Text', { exact: true })).toHaveCount(0)
    await expect(inspector.getByRole('button', { name: 'Ta bort', exact: true })).toBeDisabled()
  }
  await select(page, '#contact-booking-title')
  await expect(inspector.getByLabel('Text', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    editor.select(editor.getWrapper().find('[data-business-name]')[0].parent())
  })
  await expect(inspector.getByLabel(/^Text( \d)?$/).first()).toBeVisible()
  const models = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const find = (selector) => editor.getWrapper().find(selector)[0]
    return {
      title: find('#contact-title').get('editable'),
      name: find('[data-business-name]').get('editable'),
      paragraph: find('[data-business-name]').parent().get('editable'),
      detail: find('#contact-details dd').get('editable'),
      booking: find('#contact-booking-title').get('editable'),
    }
  })
  expect(models.title).toBe(false)
  expect(models.name).toBe(false)
  expect(models.paragraph).toBe(false)
  expect(models.detail).toBe(false)
  expect(models.booking).not.toBe(false)
  await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
  const preview = page.frameLocator('.cms-live-preview iframe')
  await expect(preview.locator('#contact-title')).toHaveText('Kontakta Salongen Kontakt')
  await expect(preview.locator('#contact-details')).toContainText('031-555 12 34')
  await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
  // Företag & SEO fills the legal name spans too (owner decision, 2026-11-03), so they lock.
  await page.getByRole('button', { name: 'Integritetspolicy', exact: true }).click()
  await studio.frame.locator('[data-business-name]').first().waitFor()
  const legal = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    return editor
      .getWrapper()
      .find('[data-business-name]')
      .map((node) => node.get('editable'))
  })
  expect(legal.length).toBeGreaterThan(0)
  expect(legal.every((editable) => editable === false)).toBe(true)
})

// The locked preview fills the legal slots from the draft's business, as Contact's does (owner
// decision, 2026-11-03). The draft holds no cancellation window, so those slots show what is
// stored. No default or fixture carries this business, so only a fill can show it.
const LEGAL_PREVIEW_BUSINESS = {
  business_name: 'Ateljé Väst & Co',
  business_legal_name: 'Väst <Juridik> AB',
  business_org_number: '559123-4567',
  business_email: 'vast@example.test',
  business_phone_display: '0303-98 76 54',
  business_phone_tel: '+46303987654',
  business_street: 'Strandgatan 3',
  business_postal_code: '442 31',
  business_city: 'Kungälv',
}

test('the locked preview fills every legal slot from the draft except the cancellation window', async ({
  page,
  studio,
}) => {
  const document = await studio.capture()
  Object.assign(document.settings, LEGAL_PREVIEW_BUSINESS)
  const terms = document.presentation.pages.find((item) => item.path === '/terms')
  if (!terms) throw new Error('Missing terms page')
  for (const lang of ['sv', 'en']) {
    terms.content[lang].html = terms.content[lang].html
      .replace(/(<p id="cancellation-policy-sv"[^>]*>)[^<]*/, '$1Lagrad avbokningstext')
      .replace(/(<p id="cancellation-policy-en"[^>]*>)[^<]*/, '$1Stored cancellation text')
    expect(terms.content[lang].html).toContain('>Lagrad avbokningstext</p>')
    expect(terms.content[lang].html).toContain('>Stored cancellation text</p>')
  }
  await importDocument(page, document, 'legal-preview.json')
  const business = LEGAL_PREVIEW_BUSINESS
  const details = [
    business.business_name,
    business.business_legal_name,
    business.business_org_number,
    `${business.business_street}, ${business.business_postal_code} ${business.business_city}`,
    business.business_email,
    business.business_phone_display,
  ]
  const preview = page.frameLocator('.cms-live-preview iframe')
  for (const [name, names, contacts] of [
    ['Integritetspolicy', 4, 2],
    ['Bokningsvillkor', 1, 1],
  ]) {
    await page.getByRole('button', { name, exact: true }).click()
    await studio.frame.getByRole('heading', { name, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
    await expect(preview.locator('[data-business-name]')).toHaveText(
      Array.from({ length: names }, () => business.business_name),
    )
    const contact = preview.locator('[data-business-contact] a')
    await expect(contact).toHaveText(
      Array.from({ length: contacts }, () => business.business_email),
    )
    for (let index = 0; index < contacts; index++)
      await expect(contact.nth(index)).toHaveAttribute('href', `mailto:${business.business_email}`)
    for (const lang of ['sv', 'en'])
      for (const value of details)
        await expect(preview.locator(`#legal-business-details-${lang}`)).toContainText(value)
    if (name === 'Integritetspolicy')
      await expect(preview.locator('[data-business-controller]')).toHaveText([
        business.business_legal_name,
        business.business_legal_name,
      ])
    else {
      await expect(preview.locator('#cancellation-policy-sv')).toHaveText('Lagrad avbokningstext')
      await expect(preview.locator('#cancellation-policy-en')).toHaveText(
        'Stored cancellation text',
      )
    }
    await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
  }
})

// Undo, Redo and Återställ stay available in the locked preview and change the draft under it. A
// created page's live menu there must follow the draft, as the saved document and the Worker do.
// Every menu starts with the three native pages; Contact is not in the seed's menu.
const NATIVE_MENU = ['Hem', 'Boka tid', 'Om oss']
// The menu labels of a page the Worker served.
const servedMenu = (html) => {
  const nav = html.match(/<nav id="cms-site-menu"[^>]*>([\s\S]*?)<\/nav>/)
  if (!nav) throw new Error('The served page has no site menu')
  return [...nav[1].matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((link) => link[1])
}
const renamePage = async (page, name) => {
  await page.getByRole('button', { name: 'Sidinställningar', exact: true }).click()
  await page.locator('.cms-page-meta').getByLabel('Namn', { exact: true }).fill(name)
}

test('a locked preview follows Undo and Redo of a rename, as the draft and the Worker do', async ({
  page,
  studio,
}) => {
  await create(page, { name: 'Original', path: '/original' })
  await renamePage(page, 'Changed')
  await expect(studio.frame.locator('#cms-site-menu a[href^="/original?"]')).toHaveText('Changed')
  await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
  const menu = page.frameLocator('.cms-live-preview iframe').locator('#cms-site-menu a')
  await expect(menu).toHaveText([...NATIVE_MENU, 'Changed'])
  const rendering = await loadWorker()
  try {
    for (const [action, name, revision] of [
      ['Ångra', 'Original', 2],
      ['Gör om', 'Changed', 3],
    ]) {
      await page.getByRole('button', { name: action, exact: true }).click()
      // Studio's page list reads the draft.
      await expect(
        page.locator('.cms-page-list').getByRole('button', { name, exact: true }),
      ).toBeVisible()
      await expect(menu).toHaveText([...NATIVE_MENU, name])
      // Publish with the preview still open: the saved document and the Worker's page agree.
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.getByText(`Publicerad · rev ${revision}`, { exact: true }).waitFor()
      const saved = globalThis.structuredClone(studio.backend.document.presentation)
      expect(saved.pages.find((item) => item.path === '/original')?.name.sv).toBe(name)
      const served = await renderPublicDocument(rendering.worker, {
        url: `${base}/original?lang=sv&mode=dark`,
        presentation: saved,
        shell: SOURCE_SHELL,
      })
      expect(served.status).toBe(200)
      expect(servedMenu(served.body)).toEqual([...NATIVE_MENU, name])
      await expect(menu).toHaveText([...NATIVE_MENU, name])
    }
  } finally {
    await rendering.close()
  }
})

test('a locked preview follows Återställ back to the published page', async ({ page, studio }) => {
  await create(page, { name: 'Sommar', path: '/sommar' })
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
  await renamePage(page, 'Vinter')
  await expect(studio.frame.locator('#cms-site-menu a[href^="/sommar?"]')).toHaveText('Vinter')
  await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
  const menu = page.frameLocator('.cms-live-preview iframe').locator('#cms-site-menu a')
  await expect(menu).toHaveText([...NATIVE_MENU, 'Vinter'])
  await page.locator('.cms-revert').click()
  await expect(
    page.locator('.cms-page-list').getByRole('button', { name: 'Sommar', exact: true }),
  ).toBeVisible()
  await expect(menu).toHaveText([...NATIVE_MENU, 'Sommar'])
})

test('a locked preview follows Undo and Redo of menu visibility and of a page deletion', async ({
  page,
  studio,
}) => {
  await create(page, { name: 'Kvar', path: '/kvar' })
  await create(page, { name: 'Borttagen', path: '/borttagen' })
  const meta = page.locator('.cms-page-meta')
  await page.getByRole('button', { name: 'Sidinställningar', exact: true }).click()
  await meta.getByRole('button', { name: 'Ta bort', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Ta bort Borttagen?', exact: true })
  await confirm.getByRole('button', { name: 'Ta bort sidan', exact: true }).click()
  await confirm.waitFor({ state: 'detached' })
  const pageList = page.locator('.cms-page-list')
  await pageList.getByRole('button', { name: 'Kvar', exact: true }).click()
  await studio.frame.getByRole('heading', { name: 'Kvar', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sidinställningar', exact: true }).click()
  const inMenu = meta.getByLabel('Visa i meny', { exact: true })
  await inMenu.uncheck()
  await expect(studio.frame.locator('#cms-site-menu a[href^="/kvar?"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
  const menu = page.frameLocator('.cms-live-preview iframe').locator('#cms-site-menu a')
  await expect(menu).toHaveText(NATIVE_MENU)
  // History: create Kvar, create Borttagen, delete Borttagen, hide Kvar from the menu.
  for (const [action, links, listed, shown] of [
    ['Ångra', [...NATIVE_MENU, 'Kvar'], 0, true],
    ['Ångra', [...NATIVE_MENU, 'Kvar', 'Borttagen'], 1, true],
    ['Gör om', [...NATIVE_MENU, 'Kvar'], 0, true],
    ['Gör om', NATIVE_MENU, 0, false],
  ]) {
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(pageList.getByRole('button', { name: 'Borttagen', exact: true })).toHaveCount(
      listed,
    )
    await expect(inMenu).toBeChecked({ checked: shown })
    await expect(menu).toHaveText(links)
  }
})

// While locked, every change of the draft is validated as locking validates it. Until that
// validation answers, the preview shows the last validated document whole: page, menu, business
// and fonts. If it fails, Studio unlocks and the owner reads the server's reason.
test.describe('a locked preview with an uploaded font', () => {
  test.use({ fontFixture: true })
  // The uploaded font file again under a second id: a new placement of the same file.
  const COPY_FONT_ID = '0b9e6a4d-2c7f-4e1a-9d3b-5f8c7a6e4d21'
  const ARCHIVED_FONT =
    'Filen reload-check.woff2 är arkiverad och kan inte läggas till på en ny plats. Återställ den under Resurser först.'
  // A created page as the preview's document holds it: the live menu, the page heading, the
  // header's phone link and the uploaded font faces.
  const shown = (html) => ({
    menu: servedMenu(html),
    heading: html.match(/<h1 [^>]*>([^<]*)<\/h1>/)?.[1] ?? null,
    phone: html.match(/class="cms-site-phone" href="([^"]*)"/)?.[1] ?? null,
    fonts: [...html.matchAll(/@font-face\{font-family:"CMSFont-([^"]+)"/g)].map((face) => face[1]),
  })

  test('a locked preview keeps its validated snapshot while the rebuild validates, and unlocks when it fails', async ({
    page,
    studio,
  }) => {
    await create(page, { name: 'Sommarkurs', path: '/sommarkurs' })
    // One import renames the page, rewrites its heading, sets the business phone and adds a font
    // placement, so Ångra and Gör om move every part of the draft at once.
    const changed = await studio.capture()
    const course = changed.presentation.pages.find((item) => item.path === '/sommarkurs')
    if (!course) throw new Error('Missing created course page')
    const rewritten = course.content.sv.html.replace('>Sommarkurs</h1>', '>Vinterkursen</h1>')
    if (rewritten === course.content.sv.html) throw new Error('The course page has no heading')
    course.name.sv = 'Vinterkurs'
    course.content.sv.html = rewritten
    changed.settings.business_phone_display = '031-123 45 67'
    changed.settings.business_phone_tel = '0311234567'
    changed.presentation.fonts[COPY_FONT_ID] = {
      ...changed.presentation.fonts[UPLOADED_FONT_ID],
      name: 'Reload Check kopia',
    }
    await importDocument(page, changed, 'vinterkurs.json')
    const pageList = page.locator('.cms-page-list')
    await pageList.getByRole('button', { name: 'Vinterkurs', exact: true }).click()
    await studio.frame.getByRole('heading', { name: 'Vinterkursen', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Ångra', exact: true }).click()
    await studio.frame.getByRole('heading', { name: 'Sommarkurs', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
    // The seed has no business settings, so the header links the default phone.
    const snapshot = {
      menu: [...NATIVE_MENU, 'Sommarkurs'],
      heading: 'Sommarkurs',
      phone: 'tel:0793043671',
      fonts: [UPLOADED_FONT_ID],
    }
    const previewFrame = page.frameLocator('.cms-live-preview iframe')
    await expect(previewFrame.locator('#cms-site-menu a')).toHaveText(snapshot.menu)
    await expect(previewFrame.locator('main h1')).toHaveText(snapshot.heading)
    const preview = page.locator('.cms-live-preview iframe')
    expect(shown((await preview.getAttribute('srcdoc')) ?? '')).toEqual(snapshot)

    // Another client archives the font file: validation now refuses its second placement.
    const font = studio.backend.assets.find((asset) => asset.path === 'fonts/reload-check.woff2')
    if (!font) throw new Error('The uploaded font is not registered')
    await page.evaluate(
      async (asset) => {
        const { cmsApi } = await import('/modules/studio/src/api.ts')
        await cmsApi.assetLifecycle(asset, 'archive')
      },
      { id: font.id, version: font.version },
    )
    expect(studio.backend.assets.find((asset) => asset.id === font.id)?.archived).toBe(true)
    const validations = () =>
      studio.backend.requests.filter((request) => request.operation === 'validate')
    const sent = validations().length
    // Locking's own validation has answered; the next one waits until it is released.
    const validation = studio.hold('validate')
    await page.getByRole('button', { name: 'Gör om', exact: true }).click()
    await expect(pageList.getByRole('button', { name: 'Vinterkurs', exact: true })).toBeVisible()
    const redone = () =>
      validations()
        .slice(sent)
        .some(
          (request) =>
            request.document.presentation.pages.find((item) => item.path === '/sommarkurs')?.name
              .sv === 'Vinterkurs',
        )
    await expect.poll(redone, { message: 'Gör om sends the rebuild validation' }).toBe(true)
    // That validation left after the render of the redone draft. The preview's document is still
    // the locked snapshot, every part of it, and Studio stays locked.
    expect(shown((await preview.getAttribute('srcdoc')) ?? '')).toEqual(snapshot)
    await expect(previewFrame.locator('main h1')).toHaveText(snapshot.heading)
    await expect(page.getByRole('button', { name: 'Lås upp', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    validation.done.release()
    await expect(page.getByRole('alert').filter({ hasText: ARCHIVED_FONT })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lås vy', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.locator('.cms-live-preview')).toHaveCount(0)
    // The draft keeps the change the preview could not show.
    await expect(pageList.getByRole('button', { name: 'Vinterkurs', exact: true })).toBeVisible()
    await expect(
      studio.frame.getByRole('heading', { name: 'Vinterkursen', exact: true }),
    ).toBeVisible()
  })
})

test('contact-named ids on an ordinary page stay editable, removable and copyable', async ({
  page,
  studio,
}) => {
  await create(page, { name: 'Besök', path: '/visit' })
  const document = await studio.capture()
  const visit = document.presentation.pages.find((item) => item.path === '/visit')
  if (!visit) throw new Error('Missing created visit page')
  visit.content.sv.html = VISIT_BODY
  visit.content.en.html = VISIT_BODY
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'visit-contact-ids.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click()
  await page.getByRole('button', { name: 'Besök', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  const inspector = page.locator('#cms-inspector')
  for (const selector of VISIT_SLOTS) {
    await select(page, selector)
    expect(await isSelected(page, selector)).toBe(true)
    await expect(inspector.getByLabel(/^Text( \d)?$/).first()).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Ta bort', exact: true })).toBeEnabled()
    await expect(inspector.getByRole('button', { name: 'Duplicera', exact: true })).toBeEnabled()
    await expect(inspector.getByText(/Uppgiften hämtas|Funktionsblocket är skyddat/)).toHaveCount(0)
  }
  const flags = await page.evaluate(async (selectors) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    return selectors.map((selector) => {
      const node = editor.getWrapper().find(selector)[0]
      return [node.get('editable'), node.get('removable'), node.get('copyable')]
    })
  }, VISIT_SLOTS)
  expect(flags).toEqual(VISIT_SLOTS.map(() => [true, true, true]))
})

test('a marked Contact keeps its heading, details and hours locked', async ({ page, studio }) => {
  const document = await studio.capture()
  const contact = document.presentation.pages.find((item) => item.path === '/contact')
  if (!contact) throw new Error('Missing Contact page')
  expect(contact.content.sv.html).toContain('data-business-contact-page="1"')
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  await expectContactSlotsLocked(page)
})

test('an unmarked historical Contact keeps its heading, details and hours locked', async ({
  page,
  studio,
}) => {
  const document = await studio.capture()
  const contact = document.presentation.pages.find((item) => item.path === '/contact')
  if (!contact) throw new Error('Missing Contact page')
  contact.content.sv.html = HISTORICAL_CONTACT_BODY
  contact.content.en.html = HISTORICAL_CONTACT_BODY
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'historical-contact.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click()
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  await expectContactSlotsLocked(page)
})

test('a marked Contact locks its name and city spans, and the legal pages lock their name spans', async ({
  page,
  studio,
}) => {
  const document = await studio.capture()
  const contact = document.presentation.pages.find((item) => item.path === '/contact')
  if (!contact) throw new Error('Missing Contact page')
  expect(contact.content.sv.html).toContain('data-business-contact-page="1"')
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  await expectBusinessSpans(page, 'locked')
  // The Worker fills these spans on the legal pages too, from the same Företag & SEO name, so the
  // owner never enters it page by page (owner decision, 2026-11-03).
  await page.getByRole('button', { name: 'Integritetspolicy', exact: true }).click()
  await studio.frame.locator('[data-business-name]').first().waitFor()
  const inspector = page.locator('#cms-inspector')
  await select(page, '[data-business-name]')
  expect(await isSelected(page, '[data-business-name]')).toBe(true)
  await expect(inspector.getByLabel('Text', { exact: true })).toHaveCount(0)
  await expect(inspector.locator('.cms-lock-note')).toContainText(
    'Uppgiften hämtas från Företag & SEO.',
  )
  await expect(inspector.getByRole('button', { name: 'Ta bort', exact: true })).toBeDisabled()
  await expect(inspector.getByRole('button', { name: 'Duplicera', exact: true })).toBeDisabled()
  const legal = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    return cmsGrapes.editors
      .at(-1)
      .getWrapper()
      .find('[data-business-name]')
      .map((node) => node.get('editable'))
  })
  expect(legal.length).toBeGreaterThan(0)
  expect(legal.every((editable) => editable === false)).toBe(true)
})

test('an unmarked historical Contact also locks its name and city spans', async ({
  page,
  studio,
}) => {
  const document = await studio.capture()
  const contact = document.presentation.pages.find((item) => item.path === '/contact')
  if (!contact) throw new Error('Missing Contact page')
  contact.content.sv.html = HISTORICAL_CONTACT_SPANS_BODY
  contact.content.en.html = HISTORICAL_CONTACT_SPANS_BODY
  await importDocument(page, document, 'historical-contact-spans.json')
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  await expectBusinessSpans(page, 'locked')
  await expectContactSlotsLocked(page)
})

for (const nested of [false, true])
  test(`marked Contact markup ${nested ? 'in a nested section ' : ''}on another page stays editable, removable and copyable`, async ({
    page,
    studio,
  }) => {
    await create(page, { name: 'Besök', path: '/visit' })
    const document = await studio.capture()
    const visit = document.presentation.pages.find((item) => item.path === '/visit')
    if (!visit) throw new Error('Missing created visit page')
    const body = nested ? MARKED_SECTION_BODY : MARKED_VISIT_BODY
    visit.content.sv.html = body
    visit.content.en.html = body
    await importDocument(page, document, 'visit-contact-marker.json')
    await page.getByRole('button', { name: 'Besök', exact: true }).click()
    await studio.frame.locator('[data-business-name]').waitFor()
    await expectBusinessSpans(page, 'editable')
  })

// Elements the Worker regenerates inside the Contact slots, and the slots it keeps with their
// attributes, generated style ids included.
const CONTACT_SLOT_CHILDREN = [
  '#contact-details dl',
  '#contact-details dd',
  '#contact-details dd a',
  '#contact-hours p',
]
const CONTACT_STYLE_ROOTS = [...CONTACT_SLOTS, ...BUSINESS_SLOTS]
// The scheme the information-page canvas pins; it follows the Ljus and Mörk buttons.
const canvasScheme = (page) => () =>
  page.evaluate(
    () =>
      globalThis.document.querySelector('.gjs-frame').contentDocument.documentElement.style
        .colorScheme,
  )

test('Contact slot children offer no styling while the slots themselves stay stylable', async ({
  page,
  studio,
}) => {
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  const stylable = (selectors) =>
    page.evaluate(async (selectors) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      return selectors.map((selector) => editor.getWrapper().find(selector)[0].get('stylable'))
    }, selectors)
  // The Worker regenerates every child, so a style on one, generated id included, reaches nobody.
  expect(await stylable(CONTACT_SLOT_CHILDREN)).toEqual(CONTACT_SLOT_CHILDREN.map(() => false))
  expect(await stylable(CONTACT_STYLE_ROOTS)).toEqual(CONTACT_STYLE_ROOTS.map(() => true))
  const inspector = page.locator('#cms-inspector')
  const sectors = inspector.locator('#cms-styles .gjs-sm-sector-title:visible')
  const advanced = inspector.getByText('Avancerad CSS', { exact: true })
  const nudge = inspector.getByRole('button', { name: 'Flytta åt vänster', exact: true })
  const note = inspector.locator('.cms-lock-note')
  for (const selector of CONTACT_SLOT_CHILDREN) {
    await select(page, selector)
    expect(await isSelected(page, selector)).toBe(true)
    await expect(sectors).toHaveCount(0)
    await expect(advanced).toBeHidden()
    await expect(nudge).toBeHidden()
    await expect(note).toContainText('Uppgiften hämtas från Företag & SEO')
    // The note may name the slot to style instead, but never offers this element's appearance.
    await expect(note).not.toContainText('Utseendet får ändras.')
  }
  for (const selector of CONTACT_STYLE_ROOTS) {
    await select(page, selector)
    expect(await isSelected(page, selector)).toBe(true)
    await expect(sectors.first()).toBeVisible()
    await expect(advanced).toBeVisible()
  }
})

test('Contact slot styling survives export, the locked preview and the Worker in both modes', async ({
  page,
  context,
  studio,
}) => {
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  // Geometry is shared by both schemes and appearance is per scheme, so one padding edit holds in
  // both modes while each mode keeps its own background.
  const modes = [
    ['Ljus', 'light', '#123456', { padding: '33px', background: 'rgb(18, 52, 86)' }],
    ['Mörk', 'dark', '#654321', { padding: '33px', background: 'rgb(101, 67, 33)' }],
  ]
  const measure = async (scope) => ({
    padding: await scope
      .locator('#contact-details')
      .evaluate((node) => getComputedStyle(node).paddingTop),
    background: await scope
      .locator('[data-business-name]')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  })
  await page.getByRole('button', { name: 'Ljus', exact: true }).click()
  await expect.poll(canvasScheme(page)).toBe('light')
  await select(page, '#contact-details')
  await openSector(page, 'Avstånd')
  const padding = page
    .locator('.gjs-sm-property')
    .filter({ has: page.locator('.gjs-sm-label').getByText('Inre avstånd', { exact: true }) })
    .first()
  await padding.getByLabel('Ovanför', { exact: true }).fill('33')
  await padding.getByLabel('Ovanför', { exact: true }).press('Enter')
  for (const [name, mode, colour, expected] of modes) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect.poll(canvasScheme(page)).toBe(mode)
    await select(page, '[data-business-name]')
    await openSector(page, 'Yta & kanter')
    const background = page.getByRole('textbox', { name: 'Bakgrundsfärg', exact: true })
    await background.fill(colour)
    await background.press('Enter')
    await expect
      .poll(() => measure(studio.frame), { message: `canvas in ${mode}` })
      .toEqual(expected)
  }
  const exported = await studio.capture()
  const rendering = await loadWorker()
  const visitor = await context.newPage()
  try {
    await routeWorkerDocuments(visitor, {
      origin: new URL(base).origin,
      paths: ['/contact'],
      worker: rendering.worker,
      presentation: exported.presentation,
      shell: SOURCE_SHELL,
    })
    await page.bringToFront()
    for (const [name, mode, , expected] of modes) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
      const preview = page.frameLocator('.cms-live-preview iframe')
      await preview.locator('#contact-details').waitFor()
      await expect
        .poll(() => measure(preview), { message: `locked preview in ${mode}` })
        .toEqual(expected)
      await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
      await visitor.goto(`${base}/contact?mode=${mode}`, { waitUntil: 'load' })
      await expect.poll(() => measure(visitor), { message: `Worker in ${mode}` }).toEqual(expected)
    }
    expect(studio.backend.writes).toEqual([])
  } finally {
    await visitor.close()
    await rendering.close()
  }
})

test('stored styling on Contact slot children looks the same in Studio, the locked preview and the Worker', async ({
  page,
  context,
  studio,
}) => {
  const document = await studio.capture()
  const contact = document.presentation.pages.find((item) => item.path === '/contact')
  if (!contact) throw new Error('Missing Contact page')
  // Styling a draft can already hold on slot children: an id rule, a class rule and an inline
  // style. The descendant rule scoped to the slot keeps its target through rendering.
  const html = contact.content.sv.html
    .replace('<dd><a href="tel:', '<dd id="owner-phone"><a href="tel:')
    .replace('<dd>Geijersgatan 10', '<dd class="owner-detail">Geijersgatan 10')
    .replace('<p>Se aktuella tider', '<p style="letter-spacing:5px">Se aktuella tider')
  expect(html.match(/id="owner-phone"|class="owner-detail"|letter-spacing:5px/g)).toHaveLength(3)
  const css =
    '#owner-phone{font-size:47px}.owner-detail{color:#ff0000}#contact-details dt{text-transform:uppercase}'
  const sheets = contact.content.sv.css
  contact.content.sv = { html, css: { light: sheets.light + css, dark: sheets.dark + css } }
  await importDocument(page, document, 'contact-child-styles.json')
  await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  const measure = async (scope) => {
    const details = scope.locator('#contact-details dd')
    return {
      address: await details.nth(0).evaluate((node) => getComputedStyle(node).color),
      phone: await details.nth(1).evaluate((node) => getComputedStyle(node).fontSize),
      hours: await scope
        .locator('#contact-hours p')
        .evaluate((node) => getComputedStyle(node).letterSpacing),
      label: await scope
        .locator('#contact-details dt')
        .first()
        .evaluate((node) => getComputedStyle(node).textTransform),
    }
  }
  const exported = await studio.capture()
  const rendering = await loadWorker()
  const visitor = await context.newPage()
  try {
    await routeWorkerDocuments(visitor, {
      origin: new URL(base).origin,
      paths: ['/contact'],
      worker: rendering.worker,
      presentation: exported.presentation,
      shell: SOURCE_SHELL,
    })
    await page.bringToFront()
    for (const [name, mode] of [
      ['Ljus', 'light'],
      ['Mörk', 'dark'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect.poll(canvasScheme(page)).toBe(mode)
      await expect.poll(async () => (await measure(studio.frame)).label).toBe('uppercase')
      const canvas = await measure(studio.frame)
      await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
      const preview = page.frameLocator('.cms-live-preview iframe')
      await preview.locator('#contact-details').waitFor()
      await expect
        .poll(() => measure(preview), { message: `locked preview in ${mode}` })
        .toEqual(canvas)
      await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
      await visitor.goto(`${base}/contact?mode=${mode}`, { waitUntil: 'load' })
      await expect.poll(() => measure(visitor), { message: `Worker in ${mode}` }).toEqual(canvas)
    }
    expect(studio.backend.writes).toEqual([])
  } finally {
    await visitor.close()
    await rendering.close()
  }
})

// Företag & SEO fills every legal business slot on every page that needs it, so the owner never
// enters it page by page (owner decision, 2026-11-03). Studio locks exactly the slots the Worker
// fills, from the same definitions (modules/public-web/src/site/businessSlots.ts), and only on /privacy and /terms.
const LEGAL_PAGES = [
  [
    'Integritetspolicy',
    '/privacy',
    [
      '[data-business-name]',
      '[data-business-controller]',
      '[data-business-contact]',
      '#legal-business-details-sv',
      '#legal-business-details-en',
    ],
  ],
  [
    'Bokningsvillkor',
    '/terms',
    [
      '[data-business-name]',
      '[data-business-contact]',
      '#legal-business-details-sv',
      '#legal-business-details-en',
      '#cancellation-policy-sv',
      '#cancellation-policy-en',
    ],
  ],
]
// The note names the setting that fills the slot; the cancellation window is a booking setting.
const legalSource = (selector) =>
  selector.startsWith('#cancellation-policy')
    ? 'Uppgiften hämtas från Avbokningsfrist under Inställningar.'
    : 'Uppgiften hämtas från Företag & SEO.'

for (const [name, , slots] of LEGAL_PAGES)
  test(`${name} locks every business slot the Worker fills and names its setting`, async ({
    page,
    studio,
  }) => {
    await page.getByRole('button', { name, exact: true }).click()
    await studio.frame.locator('[data-business-name]').first().waitFor()
    const inspector = page.locator('#cms-inspector')
    const remove = inspector.getByRole('button', { name: 'Ta bort', exact: true })
    const copy = inspector.getByRole('button', { name: 'Duplicera', exact: true })
    for (const selector of slots) {
      await select(page, selector)
      expect(await isSelected(page, selector)).toBe(true)
      await expect(inspector.locator('.cms-lock-note')).toContainText(legalSource(selector))
      await expect(inspector.getByLabel('Text', { exact: true })).toHaveCount(0)
      await expect(remove).toBeDisabled()
      await expect(copy).toBeDisabled()
    }
    // Every match in both languages is locked, and the Worker regenerates its children, so only
    // the slot itself takes styling.
    const flags = await page.evaluate(async (selectors) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const wrapper = cmsGrapes.editors.at(-1).getWrapper()
      return selectors.flatMap((selector) =>
        wrapper.find(selector).flatMap((slot) =>
          [slot, ...slot.find('*')].map((node) => ({
            selector,
            root: node === slot,
            editable: node.get('editable'),
            stylable: node.get('stylable'),
          })),
        ),
      )
    }, slots)
    expect(flags.some(({ root }) => !root)).toBe(true)
    for (const flag of flags)
      expect(flag).toEqual({ ...flag, editable: false, stylable: flag.root })
    // The paragraph around a span keeps the owner's own words, one field per text node.
    expect(await selectBusinessParagraph(page)).toBe(true)
    await expect(inspector.getByLabel(/^Text( \d)?$/).first()).toBeVisible()
    await expect(remove).toBeDisabled()
    await expect(copy).toBeDisabled()
  })

test('the Worker fills every business slot of the legal pages Studio exports', async ({
  studio,
}) => {
  const exported = await studio.capture()
  const rendering = await loadWorker()
  try {
    // The harness serves empty business settings, so the Worker fills in the default business.
    const name = 'Blade &amp; Blend Studio'
    const email = 'booking@mail.bladeblendstudio.se'
    for (const [, path] of LEGAL_PAGES) {
      const { status, body } = await renderPublicDocument(rendering.worker, {
        url: `${base}${path}`,
        presentation: exported.presentation,
        shell: SOURCE_SHELL,
      })
      expect(status).toBe(200)
      expect(body).toContain('data-cms-public="1"')
      expect(body).toContain(`<span data-business-name="">${name}</span>`)
      expect(body).not.toMatch(new RegExp(`<span data-business-name="">(?!${name}<)`))
      expect(body).toContain(
        `<span data-business-contact=""><a href="mailto:${email}">${email}</a></span>`,
      )
      expect(body).not.toContain('kontaktuppgifterna på startsidan / home page contact details')
      expect(body).toContain(
        `<div id="legal-business-details-sv"><dl><dt>Salong</dt><dd>${name}</dd>`,
      )
      expect(body).toContain(
        `<div id="legal-business-details-en"><dl><dt>Salon</dt><dd>${name}</dd>`,
      )
      if (path === '/privacy')
        for (const lang of ['sv', 'en'])
          expect(body).toContain(`<span data-business-controller="${lang}">${name}</span>`)
      else {
        expect(body).toContain(
          '<p id="cancellation-policy-sv">Avboka senast 24 timmar före den bokade tiden.</p>',
        )
        expect(body).toContain(
          '<p id="cancellation-policy-en">Cancel at least 24 hours before your appointment.</p>',
        )
      }
    }
  } finally {
    await rendering.close()
  }
})

// Legal markup on a created page is the owner's own content: the Worker serves it as authored.
const LEGAL_VISIT_BODY =
  '<main><p>Hos <span data-business-name="">Ägarens namn</span> och <span data-business-controller="sv">Ägarens bolag</span></p><div id="legal-business-details-sv">Ägarens uppgifter</div><p id="cancellation-policy-sv">Ägarens avbokning</p><p><span data-business-contact="">Ägarens kontakt</span></p></main>'
const LEGAL_VISIT_SLOTS = [
  '[data-business-name]',
  '[data-business-controller]',
  '#legal-business-details-sv',
  '#cancellation-policy-sv',
  '[data-business-contact]',
]

test('legal slot markup on a created page stays editable, removable and copyable', async ({
  page,
  studio,
}) => {
  await create(page, { name: 'Besök', path: '/visit' })
  const document = await studio.capture()
  const visit = document.presentation.pages.find((item) => item.path === '/visit')
  if (!visit) throw new Error('Missing created visit page')
  visit.content.sv.html = LEGAL_VISIT_BODY
  visit.content.en.html = LEGAL_VISIT_BODY
  await importDocument(page, document, 'visit-legal-slots.json')
  await page.getByRole('button', { name: 'Besök', exact: true }).click()
  await studio.frame.locator('#legal-business-details-sv').waitFor()
  const inspector = page.locator('#cms-inspector')
  for (const selector of LEGAL_VISIT_SLOTS) {
    await select(page, selector)
    expect(await isSelected(page, selector)).toBe(true)
    await expect(inspector.getByLabel('Text', { exact: true })).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Ta bort', exact: true })).toBeEnabled()
    await expect(inspector.getByRole('button', { name: 'Duplicera', exact: true })).toBeEnabled()
    await expect(inspector.getByText(/Uppgiften hämtas|Funktionsblocket är skyddat/)).toHaveCount(0)
  }
  const flags = await page.evaluate(async (selectors) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    return selectors.map((selector) => {
      const node = editor.getWrapper().find(selector)[0]
      return [node.get('editable'), node.get('removable'), node.get('copyable')]
    })
  }, LEGAL_VISIT_SLOTS)
  expect(flags).toEqual(LEGAL_VISIT_SLOTS.map(() => [true, true, true]))
})

// Two owners' businesses, each different from the default business the seed publishes.
const NORD_BUSINESS = {
  name: 'Ateljé Nord A',
  street: 'Storgatan 1',
  postalCode: '753 20',
  city: 'Uppsala',
  phone: '018-12 34 56',
  tel: '+4618123456',
  email: 'nord@example.test',
  maps: 'https://maps.example.test/uppsala',
}
const SYD_BUSINESS = {
  name: 'Studio Syd B',
  street: 'Lilla Torg 2',
  postalCode: '211 34',
  city: 'Lund',
  phone: '046-765 43 21',
  tel: '+46467654321',
  email: 'syd@example.test',
  maps: 'https://maps.example.test/lund',
}
const businessSettings = (business) => ({
  business_name: business.name,
  business_street: business.street,
  business_postal_code: business.postalCode,
  business_city: business.city,
  business_phone_display: business.phone,
  business_phone_tel: business.tel,
  business_email: business.email,
  business_maps_href: business.maps,
})
const businessAddress = (business) => `${business.street}, ${business.postalCode} ${business.city}`
// A preview's Contact page shows `own` business, and neither the default nor `other`.
const expectPreviewContact = async (frame, lang, own, other) => {
  await expect(frame.locator('#contact-title')).toHaveText(
    `${lang === 'sv' ? 'Kontakta' : 'Contact'} ${own.name}`,
  )
  await expect(frame.locator('[data-business-name]')).toHaveText(own.name)
  await expect(frame.locator('[data-business-city]')).toHaveText(own.city)
  const details = frame.locator('#contact-details')
  for (const value of [businessAddress(own), own.phone, own.email])
    await expect(details).toContainText(value)
  for (const value of ['Geijersgatan 10', businessAddress(other)])
    await expect(details).not.toContainText(value)
}
// A preview's created page carries the live header with `own` phone and directions.
const expectPreviewHeader = async (frame, own) => {
  const phone = frame.locator('#cms-site-header .cms-site-phone')
  await expect(phone).toHaveText(own.phone)
  await expect(phone).toHaveAttribute('href', `tel:${own.tel}`)
  await expect(frame.locator('#cms-site-header .cms-site-directions')).toHaveAttribute(
    'href',
    own.maps,
  )
}

// The captured document with a created page carrying the live header, once with each business.
const businessDocuments = async (studio) => {
  const captured = await studio.capture()
  const visit = createSitePage({
    id: '90000000-0000-4000-8000-000000000011',
    path: '/visit',
    name: { sv: 'Besök', en: 'Visit' },
  })
  const withBusiness = (business) => {
    const document = globalThis.structuredClone(captured)
    Object.assign(document.settings, businessSettings(business))
    document.presentation.pages.push(globalThis.structuredClone(visit))
    return document
  }
  return { today: withBusiness(NORD_BUSINESS), older: withBusiness(SYD_BUSINESS) }
}
const PREVIEW_PAGES = {
  sv: { contact: 'Kontakt', visit: 'Besök' },
  en: { contact: 'Contact', visit: 'Visit' },
}
// Imports the draft in `lang`. The editor's locked preview already reads the draft's business.
const openBusinessDraft = async (page, studio, document, lang) => {
  await importDocument(page, document, 'business-today.json')
  await page.getByRole('button', { name: lang.toUpperCase(), exact: true }).click()
  await page.getByRole('button', { name: PREVIEW_PAGES[lang].contact, exact: true }).click()
  await studio.frame.locator('#contact-title').waitFor()
  await page.getByRole('button', { name: 'Lås vy', exact: true }).click()
  await expectPreviewContact(
    page.frameLocator('.cms-live-preview iframe'),
    lang,
    NORD_BUSINESS,
    SYD_BUSINESS,
  )
  await page.getByRole('button', { name: 'Lås upp', exact: true }).click()
}

for (const lang of ['sv', 'en']) {
  test(`the style preview shows the draft's business (${lang})`, async ({ page, studio }) => {
    const { today } = await businessDocuments(studio)
    await openBusinessDraft(page, studio, today, lang)
    await page.getByRole('button', { name: 'Webbplatsens stil', exact: true }).click()
    const style = page.getByRole('region', { name: 'Stilförhandsvisning', exact: true })
    const preview = page.frameLocator('.cms-theme-preview iframe')
    await style
      .getByLabel('Sida', { exact: true })
      .selectOption({ label: PREVIEW_PAGES[lang].contact })
    await expectPreviewContact(preview, lang, NORD_BUSINESS, SYD_BUSINESS)
    await style
      .getByLabel('Sida', { exact: true })
      .selectOption({ label: PREVIEW_PAGES[lang].visit })
    await expectPreviewHeader(preview, NORD_BUSINESS)
    expect(studio.backend.writes).toEqual([])
    expect(studio.backend.requests.map(({ operation }) => operation)).not.toContain('publish')
  })

  test(`the history preview shows each revision's own business (${lang})`, async ({
    page,
    context,
    studio,
  }) => {
    const { today, older } = await businessDocuments(studio)
    // The older revision also holds the Desktop breakpoint earlier Studio builds stored. The
    // preview shows a created page's sheet as it is given, so the review repairs what it reads.
    const stored = older.presentation.pages.find((item) => item.path === '/visit').content[lang]
    const legacy = '@media(max-width:1440px){#legacy-offset{translate:12px 0!important}}'
    stored.css = { light: stored.css.light + legacy, dark: stored.css.dark + legacy }
    // Revision 9 holds today's draft and revision 7 an older business. This route answers both
    // history reads; every other request reaches the native backend.
    const revisions = new Map([
      [9, today],
      [7, older],
    ])
    await routeApi(context, [
      [
        '**/functions/v1/cms-studio',
        (route, headers) => {
          const body = route.request().postDataJSON()
          if (body.operation === 'history')
            return route.fulfill({
              headers,
              json: [...revisions.keys()].map((revision) => ({
                revision,
                created_at: '2026-10-30T12:00:00Z',
                summary: 'Publicerat sidinnehåll',
              })),
            })
          if (body.operation === 'revision')
            return route.fulfill({ headers, json: { document: revisions.get(body.revision) } })
          return route.fallback()
        },
      ],
    ])
    await openBusinessDraft(page, studio, today, lang)
    const names = PREVIEW_PAGES[lang]
    await page.getByRole('button', { name: 'Historik', exact: true }).click()
    for (const [revision, own, other] of [
      [7, SYD_BUSINESS, NORD_BUSINESS],
      [9, NORD_BUSINESS, SYD_BUSINESS],
    ]) {
      await page
        .locator('.cms-history-row')
        .filter({ has: page.getByText(`v${revision}`, { exact: true }) })
        .getByRole('button', { name: 'Granska', exact: true })
        .click()
      const review = page.getByRole('dialog', { name: `Granska version ${revision}`, exact: true })
      const preview = page.frameLocator('.cms-history-preview iframe')
      // The label wraps the select, so its text includes every option: select it by its class.
      const pages = review.locator('.cms-history-page-select select')
      await pages.selectOption({ label: names.contact })
      await expectPreviewContact(preview, lang, own, other)
      await pages.selectOption({ label: names.visit })
      await expectPreviewHeader(preview, own)
      const sheet = await page.locator('.cms-history-preview iframe').getAttribute('srcdoc')
      expect(sheet.includes('max-width:1440px'), `revision ${revision}`).toBe(false)
      expect(
        sheet.includes('@media (min-width:769px){#legacy-offset{translate:12px 0!important}}'),
        `revision ${revision}`,
      ).toBe(revision === 7)
      await page.keyboard.press('Escape')
      await review.waitFor({ state: 'detached' })
    }
    expect(studio.backend.writes).toEqual([])
    expect(studio.backend.requests.map(({ operation }) => operation)).not.toContain('publish')
  })
}

test('the live footer stays locked through a rebuild and out of the stored body', async ({
  page,
  studio,
}) => {
  await create(page)
  const locks = () =>
    page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const footer = cmsGrapes.editors.at(-1).Components.getById('cms-site-footer')
      return [footer, ...footer.components().models].flatMap((node) =>
        ['selectable', 'editable', 'droppable', 'removable'].map((name) => node.get(name)),
      )
    })
  const footer = studio.frame.locator('#cms-site-footer')
  await footer.getByRole('link', { name: 'Integritetspolicy', exact: true }).waitFor()
  expect(new Set(await locks())).toEqual(new Set([false]))
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await footer.getByRole('link', { name: 'Privacy policy', exact: true }).waitFor()
  expect(new Set(await locks())).toEqual(new Set([false]))
  await select(page, '#cms-site-content h1')
  await page
    .locator('#cms-inspector')
    .getByLabel('Text', { exact: true })
    .fill('Owner edited heading')
  const document = await studio.capture()
  const created = document.presentation.pages.find((item) => item.path === '/reported-page')
  expect(created.content.en.html).toContain('Owner edited heading')
  expect(created.content.en.html).not.toContain('cms-site-footer')
})

// The published legal page as the Worker serves it to a visitor who has not picked a mode: the
// owner's background for each scheme, the browser chrome in the same colour, and no app bundle.
async function expectPublicBackgrounds(context, presentation) {
  const rendering = await loadWorker()
  const visitor = await context.newPage()
  try {
    const scripts = []
    const errors = []
    visitor.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request.url())
    })
    visitor.on('pageerror', (error) => errors.push(error.message))
    await routeWorkerDocuments(visitor, {
      origin: new URL(base).origin,
      paths: ['/terms'],
      worker: rendering.worker,
      presentation,
      shell: SOURCE_SHELL,
    })
    const paint = () =>
      visitor.evaluate(() => ({
        background: getComputedStyle(globalThis.document.body).backgroundColor,
        themeColors: [...globalThis.document.querySelectorAll('meta[name="theme-color"]')].map(
          (meta) => meta.content,
        ),
      }))
    const painted = {}
    for (const scheme of ['light', 'dark']) {
      const expected = scheme === 'dark' ? 'rgb(18, 52, 86)' : 'rgb(35, 69, 103)'
      await visitor.emulateMedia({ colorScheme: scheme })
      if (scheme === 'light') await visitor.goto(`${base}/terms`, { waitUntil: 'load' })
      await expect
        .poll(paint, { message: `public /terms in OS ${scheme}` })
        .toEqual({ background: expected, themeColors: [expected, expected] })
      painted[scheme] = await paint()
    }
    assert.equal(
      await visitor.evaluate(
        () => globalThis.document.querySelectorAll('script[type="module"]').length,
      ),
      0,
      'the published legal page ships without the app bundle',
    )
    assert.deepEqual(scripts, [], 'no script is requested')
    assert.deepEqual(errors, [], 'no unhandled visitor errors')
    return painted
  } finally {
    await visitor.close()
    await rendering.close()
  }
}

// The legal canvas paints on the base sheets the Worker inlines publicly, with the edited mode
// pinned as `?mode` pins it, also after the frame reloads; other pages get neither. The uploaded
// fonts' sheet comes back with a reloaded frame too.
test.describe('with an uploaded font', () => {
  test.use({ fontFixture: true })
  test('legal canvas links the public base sheets and pins the mode', async ({ page, studio }) => {
    const { frame } = studio
    const fontFace = `@font-face{font-family:"CMSFont-${UPLOADED_FONT_ID}";src:url("`
    const head = () =>
      page.evaluate((fontFace) => {
        const doc = globalThis.document.querySelector('.gjs-frame')?.contentDocument
        const links = [...(doc?.querySelectorAll('link[rel="stylesheet"]') ?? [])]
        const layout = doc?.querySelector('.bb-doc')
        const fonts = doc?.getElementById('cms-uploaded-fonts')
        return {
          links: links.map((link) => link.getAttribute('href')),
          loaded: links.every((link) => link.sheet !== null),
          scheme: doc?.documentElement.style.colorScheme ?? null,
          compatMode: doc?.compatMode ?? null,
          layoutWidth: layout ? getComputedStyle(layout).maxWidth : null,
          fontFace: fonts?.textContent.includes(fontFace) ?? false,
          fontSheet: fonts?.sheet?.cssRules.length > 0,
        }
      }, fontFace)
    const legal = (scheme) => ({
      links: ['/tokens.css', '/info.css'],
      loaded: true,
      scheme,
      compatMode: 'CSS1Compat',
      layoutWidth: '736px',
      fontFace: true,
      fontSheet: true,
    })
    await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
    await page.getByRole('button', { name: 'Mörk', exact: true }).click()
    await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
    await expect.poll(head, { message: 'legal canvas in Mörk' }).toEqual(legal('dark'))
    const canvas = await (await page.locator('.gjs-frame').first().elementHandle()).contentFrame()
    const reloadRequests = []
    page.on('request', (request) => {
      if (request.frame() === canvas && ['document', 'script'].includes(request.resourceType()))
        reloadRequests.push(request.url())
    })
    // GrapesJS rebuilds a reloaded frame from scratch without any prop change. Mörk under an OS light
    // page shows the pin: without it the tokens fall back to the light surface.
    const reloadMarker = () =>
      page.evaluate(
        () =>
          globalThis.document.querySelector('.gjs-frame')?.contentWindow.cmsReloadMarker ?? null,
      )
    await page.evaluate(() => {
      const frameWindow = globalThis.document.querySelector('.gjs-frame').contentWindow
      frameWindow.cmsReloadMarker = 'before'
      frameWindow.location.reload()
    })
    await expect.poll(reloadMarker, { message: 'the canvas frame reloaded' }).toBe(null)
    await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
    await expect.poll(head, { message: 'legal canvas after a frame reload' }).toEqual(legal('dark'))
    assert.deepEqual(reloadRequests, [], 'reloading the canvas never loads the application')
    await expect
      .poll(() => canvas.evaluate(documentColours), {
        message: 'legal colours after a frame reload',
      })
      .toEqual({ background: 'rgb(28, 28, 30)', text: 'rgb(245, 245, 247)' })
    await page.getByRole('button', { name: 'Ljus', exact: true }).click()
    await expect.poll(head, { message: 'legal canvas in Ljus' }).toEqual(legal('light'))
    await page.getByRole('button', { name: 'Startsida', exact: true }).click()
    await frame.locator('[data-knc-surface="desktop-home"]').waitFor()
    await expect.poll(head, { message: 'home canvas' }).toEqual({
      links: [],
      loaded: true,
      scheme: '',
      compatMode: 'CSS1Compat',
      layoutWidth: null,
      fontFace: true,
      fontSheet: true,
    })
  })
})

/** What a reader sees inside the legal document: the first painted background in the element
 * stack at a point within main.bb-doc, and the colour of its text. Runs in the page or frame. */
const documentColours = () => {
  const doc = globalThis.document
  const main = doc.querySelector('main.bb-doc')
  if (!main) return null
  const box = main.getBoundingClientRect()
  const background = doc
    .elementsFromPoint(box.left + 4, Math.min(box.top + 8, globalThis.innerHeight - 1))
    .map((element) => getComputedStyle(element).backgroundColor)
    .find((color) => color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color))
  return { background: background ?? null, text: getComputedStyle(main.querySelector('p')).color }
}

// The legal surface sits on the root, so the owner's body styles are what readers see, not a token
// colour painted over them by a wrapper, and the browser chrome follows the same colour.
test('legal page shows the owner body colours in the canvas and to visitors', async ({
  page,
  context,
  studio,
}) => {
  const { frame, backend } = studio
  const owner = { background: 'rgb(18, 52, 86)', text: 'rgb(254, 220, 186)' }
  await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
  await page.getByRole('button', { name: 'Mörk', exact: true }).click()
  await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
  const canvas = await (await page.locator('.gjs-frame').first().elementHandle()).contentFrame()
  const canvasColours = () => canvas.evaluate(documentColours)
  await expect
    .poll(canvasColours, { message: 'token surface before the edit' })
    .toEqual({ background: 'rgb(28, 28, 30)', text: 'rgb(245, 245, 247)' })
  await select(page, 'body')
  await openSector(page, 'Yta & kanter')
  const background = page.getByRole('textbox', { name: 'Bakgrundsfärg', exact: true })
  await background.fill('#123456')
  await background.press('Enter')
  // The body inspector offers no Typografi sector, so the text colour goes through the selected
  // component's style, the rule an inspector colour field writes.
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    cmsGrapes.editors.at(-1).getSelected().addStyle({ color: '#fedcba' })
  })
  await expect.poll(canvasColours, { message: 'owner colours in the canvas' }).toEqual(owner)
  const publication = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/functions/v1/cms-studio') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.operation === 'publish',
  )
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  assert.equal((await publication).status(), 200)
  const rendering = await loadWorker()
  const visitor = await context.newPage()
  try {
    await routeWorkerDocuments(visitor, {
      origin: new URL(base).origin,
      paths: ['/terms'],
      worker: rendering.worker,
      presentation: globalThis.structuredClone(backend.document.presentation),
      shell: SOURCE_SHELL,
    })
    await visitor.emulateMedia({ colorScheme: 'dark' })
    await visitor.goto(`${base}/terms`, { waitUntil: 'load' })
    const seen = async () => ({
      ...(await visitor.evaluate(documentColours)),
      themeColor: await visitor.evaluate(
        () => globalThis.document.querySelector('meta[name="theme-color"]')?.content ?? null,
      ),
    })
    await expect
      .poll(seen, { message: 'published legal page' })
      .toEqual({ ...owner, themeColor: owner.background })
  } finally {
    await visitor.close()
    await rendering.close()
  }
})

const LEGACY_LEGAL_CSS = {
  '/terms': readFileSync(
    new URL('../../modules/studio/src/legacy-legal-terms.txt', import.meta.url),
    'utf8',
  ),
  '/privacy': readFileSync(
    new URL('../../modules/studio/src/legacy-legal-privacy.txt', import.meta.url),
    'utf8',
  ),
}
const OWNER_CSS = '\n.owner-edit{letter-spacing:.01em}'

/** The document as a draft saved before the legal upgrade held it (legacy sheets, bare <main>), with
 * an owner rule beside the legacy block on /terms, and the legal page contents the upgrade must
 * give back: the owner rule kept, the legacy block gone, the document class restored. */
function preUpgradeDraft(document) {
  const draft = globalThis.structuredClone(document)
  const expected = {}
  for (const page of draft.presentation.pages) {
    const legacy = LEGACY_LEGAL_CSS[page.path]
    if (legacy === undefined) continue
    const edit = page.path === '/terms' ? OWNER_CSS : ''
    expected[page.path] = globalThis.structuredClone(page.content)
    for (const lang of ['sv', 'en']) {
      const variant = page.content[lang]
      assert.match(variant.html, /^\s*<main class="bb-doc">/, `${page.path} ${lang} document shape`)
      variant.html = variant.html.replace('<main class="bb-doc">', '<main>')
      variant.css = { light: legacy + edit, dark: legacy + edit }
      expected[page.path][lang].css = { light: edit, dark: edit }
    }
  }
  assert.deepEqual(Object.keys(expected).sort(), ['/privacy', '/terms'])
  return { draft, expected }
}

/** A real owner edit creates the local backup used to seed a pre-upgrade recovery. */
async function savedBackup(page) {
  await page.getByRole('textbox', { name: 'Namn', exact: true }).fill('Återställningstestets källa')
  const read = () =>
    page.evaluate(async () => {
      const session = await (await import('/modules/studio/src/backup.ts')).cmsBackups()
      await session.flush()
      return session.own()
    })
  await expect.poll(async () => (await read()) !== null, { message: 'a local backup' }).toBe(true)
  return read()
}

const legalContents = async (studio, expected) =>
  Object.fromEntries(
    (await studio.capture()).presentation.pages
      .filter((page) => page.path in expected)
      .map((page) => [page.path, page.content]),
  )

// A local draft saved before the legal upgrade at the server's own revision is restored without a
// merge; the recovered draft still gets the upgrade and keeps the owner's other edits.
test('legal upgrade survives a pre-upgrade local draft', async ({ page, studio }) => {
  const backup = await savedBackup(page)
  const { draft, expected } = preUpgradeDraft(backup.document)
  // The mounted Studio writes its own draft on pagehide (a clean one deletes the record), so the
  // seed goes in after the reload and before the Studio mounts; the tab's session is reused.
  await page.reload()
  await page.evaluate(
    async ({ backup, draft }) => {
      const session = await (await import('/modules/studio/src/backup.ts')).cmsBackups()
      session.schedule({
        document: draft,
        revision: backup.revision,
        fingerprint: backup.fingerprint,
        base: backup.base,
      })
      await session.flush()
    },
    { backup, draft },
  )
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
  await page.getByText('Ett lokalt utkast från', { exact: false }).waitFor()
  await expect
    .poll(() => legalContents(studio, expected), { message: 'the recovered legal pages' })
    .toEqual(expected)
})

// An exported JSON draft from before the legal upgrade imports with the upgrade applied.
test('legal upgrade applies to an imported pre-upgrade draft', async ({ page, studio }) => {
  const { draft, expected } = preUpgradeDraft((await savedBackup(page)).document)
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'pre-upgrade.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await expect
    .poll(() => legalContents(studio, expected), { message: 'the imported legal pages' })
    .toEqual(expected)
})

// A server head still holding the legacy legal pages reaches the draft through a publish conflict.
// The resolved draft, every Undo and Redo state and the next publication keep the upgrade.
test('legal upgrade survives conflict resolution, Undo and Redo', async ({ page, studio }) => {
  const { backend } = studio
  const backup = await savedBackup(page)
  const { draft: legacyHead, expected: upgradedHead } = preUpgradeDraft(backup.document)
  const resolvedLegal = Object.fromEntries(
    backup.document.presentation.pages
      .filter((page) => page.path in upgradedHead)
      .map((page) => [page.path, page.content]),
  )
  // Another session publishes the legacy pages, so this draft's next publication is stale.
  await page.evaluate(
    async ({ legacyHead, revision, fingerprint }) =>
      (await import('/modules/studio/src/api.ts')).cmsApi.publish(
        legacyHead,
        revision,
        fingerprint,
        globalThis.crypto.randomUUID(),
      ),
    { legacyHead, revision: backup.revision, fingerprint: backup.fingerprint },
  )
  assert.equal(
    backend.document.presentation.pages.find((page) => page.path === '/terms').content.sv.css.light,
    LEGACY_LEGAL_CSS['/terms'] + OWNER_CSS,
  )
  // Match resolveConflict's pristine adoption of the authoritative raw server head, including
  // whitespace preserved by the legal migration. Import's DOM reserialization is a different path.
  const migratedServerHead = await page.evaluate(async (rawServerHead) => {
    const { withCorePages } = await import('/modules/studio/src/corePages.ts')
    const { normalizeDocument } = await import('/modules/studio/src/normalizeDocument.ts')
    return normalizeDocument(withCorePages(rawServerHead))
  }, backend.document)
  const serverHead = Object.fromEntries(
    migratedServerHead.presentation.pages
      .filter((page) => page.path in upgradedHead)
      .map((page) => [page.path, page.content]),
  )
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByRole('button', { name: 'Behåll mina konfliktändringar', exact: true }).click()
  await expect
    .poll(() => legalContents(studio, upgradedHead), { message: 'the resolved draft' })
    .toEqual(resolvedLegal)
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await expect
    .poll(() => legalContents(studio, upgradedHead), { message: 'Undo to the server head' })
    .toEqual(serverHead)
  await expect
    .poll(async () => JSON.stringify(await studio.capture()), {
      message: 'Undo equals the complete migrated server head byte for byte',
    })
    .toBe(JSON.stringify(migratedServerHead))
  await expect(page.locator('.cms-revert')).toBeDisabled()
  await page.getByRole('button', { name: 'Gör om', exact: true }).click()
  await expect
    .poll(() => legalContents(studio, upgradedHead), { message: 'Redo to the resolution' })
    .toEqual(resolvedLegal)
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await expect
    .poll(() => legalContents(studio, upgradedHead), { message: 'Undo again' })
    .toEqual(serverHead)
  // An owner edit after the Undo, then the publication it goes out with.
  await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
  await studio.frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
  await select(page, 'body')
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    cmsGrapes.editors.at(-1).getSelected().addStyle({ color: '#fedcba' })
  })
  const publication = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/functions/v1/cms-studio') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON()?.operation === 'publish',
  )
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  assert.equal((await publication).status(), 200)
  const published = backend.document.presentation.pages.filter((page) => page.path in upgradedHead)
  assert.equal(published.length, 2)
  for (const legalPage of published)
    for (const lang of ['sv', 'en']) {
      const variant = legalPage.content[lang]
      assert.match(variant.html, /^\s*<main class="bb-doc">/, `${legalPage.path} ${lang} published`)
      for (const css of [variant.css.light, variant.css.dark])
        assert.ok(!css.includes(LEGACY_LEGAL_CSS[legalPage.path]), `${legalPage.path} ${lang} css`)
    }
  assert.match(
    published.find((legalPage) => legalPage.path === '/terms').content.sv.css.light,
    /#fedcba/i,
    'the owner edit is published',
  )
})

test('1-legal-background', async ({ page, context, studio }, testInfo) => {
  const { frame, shot, backend } = studio
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
      globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') === 'light',
  )
  await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
  await shot('light')
  await page.getByRole('button', { name: 'Mörk', exact: true }).click()
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') === 'dark',
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
        selected.ownerDocument.defaultView.getComputedStyle(selected).backgroundColor === expected
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
      globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') === 'light',
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
  const publicPixels = await expectPublicBackgrounds(
    context,
    globalThis.structuredClone(backend.document.presentation),
  )
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
      globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') === 'dark',
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
      globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') === 'light',
  )
  const lightControl = await backgroundControl()
  await waitForBackgroundControl(lightControl, '#234567')
  assert.equal(await lightControl.inputValue(), '#234567')
  await waitForSelectedBackground('rgb(35, 69, 103)')
  assert.equal(await readSelectedBackground(), 'rgb(35, 69, 103)')
  await shot('light-reloaded')
  await testInfo.attach('metrics', {
    body: JSON.stringify({ dark: darkPixels, light: lightPixels, public: publicPixels }, null, 2),
    contentType: 'application/json',
  })
})
test('2-new-page-editability', async ({ page, studio }, testInfo) => {
  const { frame, shot } = studio
  await create(page)
  const controls = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    return editor
      .getWrapper()
      .find('#cms-site-header, #cms-site-header a, #cms-site-content h1')
      .map((node) => ({
        header: node.getId() === 'cms-site-header' || Boolean(node.closest('#cms-site-header')),
        tag: node.get('tagName'),
        id: node.getId(),
        selectable: node.get('selectable'),
        stylable: node.get('stylable'),
        draggable: node.get('draggable'),
      }))
  })
  await shot('created')
  const header = controls.filter((node) => node.header)
  const body = controls.filter((node) => !node.header)
  assert.ok(header.length >= 2 && body.length === 1, JSON.stringify(controls))
  assert.ok(
    header.every((node) => node.selectable === false && node.stylable === false),
    `the live homepage header is shown but locked: ${JSON.stringify(header)}`,
  )
  assert.ok(
    body.every((node) => node.selectable !== false && node.stylable !== false),
    `the page body stays editable: ${JSON.stringify(body)}`,
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
  await testInfo.attach('metrics', {
    body: JSON.stringify(controls, null, 2),
    contentType: 'application/json',
  })
})
test('2-owner-controls-survive-publication', async ({ page, studio, browserName, evidenceDir }) => {
  const { frame, shot, backend } = studio
  const out = evidenceDir
  const engineName = browserName
  await create(page)
  await select(page, '#cms-site-content main')
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
    frame.locator('#cms-site-content main').evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      padding: getComputedStyle(node).paddingTop,
    }))
  const before = await styled()
  await shot('header-styled')
  assert.deepEqual(
    before,
    { background: 'rgb(18, 52, 86)', padding: '33px' },
    'all new-page controls affect rendered pixels, including the seeded body padding',
  )
  await select(page, '#cms-site-content main')
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
  assert.equal(published.layout, undefined)
  assert.ok(
    !published.content.sv.html.includes('cms-site-header') &&
      published.content.sv.html.startsWith('<main'),
    'only the body is published; the header is rendered live',
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
  assert.deepEqual(reloaded, before, 'published body edits survive reload')
  await shot('reloaded')
})
test('2-legacy-page-language-preservation', async ({ page, studio }) => {
  const { frame, backend, shot } = studio
  await create(page)
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.waitForFunction(() =>
    globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
  )
  const legacy = backend.document.presentation.pages.find((item) => item.path === '/reported-page')
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
  const saved = backend.document.presentation.pages.find((item) => item.path === '/reported-page')
  assert.equal(saved.layout, undefined)
  assert.equal(
    saved.content.en.html,
    '<main><h1>Legacy English</h1></main>',
    'editing Swedish must leave the unedited English body untouched',
  )
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await frame.getByRole('heading', { name: 'Legacy English', exact: true }).waitFor()
  await frame.locator('#cms-site-header').waitFor()
  await shot('english-preserved')
})
test('2-new-page-live-header-and-delete', async ({ page, studio }, testInfo) => {
  const { frame, backend, shot } = studio
  await create(page)
  await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ny sida', exact: true })
  await dialog.getByLabel('Sidnamn', { exact: true }).fill('Other page')
  await dialog.getByLabel('Adress', { exact: true }).fill('/other-page')
  await dialog.getByRole('button', { name: 'Skapa sida', exact: true }).click()
  await frame.getByRole('heading', { name: 'Other page', exact: true }).waitFor()
  const menu = frame.locator('#cms-site-menu')
  await menu.locator('a[href="/reported-page?lang=sv&mode=dark"]').waitFor()
  await page.getByRole('button', { name: 'Reported page', exact: true }).click()
  await frame.getByRole('heading', { name: 'Reported page', exact: true }).waitFor()
  await select(page, '#cms-site-content h1')
  await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill('Body edit')
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.waitForFunction(() =>
    globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
  )
  const presentation = globalThis.structuredClone(backend.document.presentation)
  const reported = presentation.pages.find((item) => item.path === '/reported-page')
  assert.ok(!reported.content.sv.html.includes('cms-site-header'), reported.content.sv.html)
  const contact = { phoneTel: '0793043671', phoneDisplay: '079‑304 36 71', mapsHref: '' }
  const publicDark = renderSitePage(presentation, reported, 'sv', 'dark', contact).html
  const publicAuto = renderSitePage(presentation, reported, 'en', null, contact).html
  assert.ok(publicDark.includes('<header id="cms-site-header">'), publicDark)
  assert.ok(publicDark.includes('Body edit'), publicDark)
  assert.ok(publicDark.includes('href="/booking?lang=sv&amp;mode=dark"'), publicDark)
  assert.ok(publicDark.includes('href="/other-page?lang=sv&amp;mode=dark"'), publicDark)
  assert.ok(publicAuto.includes('href="/booking?lang=en"'), publicAuto)
  const rendering = await loadWorker()
  const visit = async (presentationNow, path) => {
    const visitor = await page.context().newPage()
    await routeWorkerDocuments(visitor, {
      origin: new URL(base).origin,
      paths: ['/reported-page', '/other-page'],
      worker: rendering.worker,
      presentation: presentationNow,
      shell: SOURCE_SHELL,
    })
    await visitor.goto(`${base}${path}`)
    return visitor
  }
  const visitor = await visit(presentation, '/reported-page?lang=sv&mode=dark')
  await visitor.locator('#cms-site-header').waitFor()
  await visitor.locator('#cms-site-menu a[href="/booking?lang=sv&mode=dark"]').waitFor()
  await visitor.locator('#cms-site-menu a[href="/other-page?lang=sv&mode=dark"]').waitFor()
  await visitor.getByText('Body edit', { exact: true }).waitFor()
  await visitor.close()
  await shot('published')

  // Delete from a state where a body element is selected: page settings are one click away.
  await select(page, '#cms-site-content h1')
  await page.getByRole('button', { name: 'Sidinställningar', exact: true }).click()
  await page.locator('#cms-inspector').getByRole('button', { name: 'Ta bort', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Ta bort Reported page?', exact: true })
  await confirm.getByRole('button', { name: 'Ta bort sidan', exact: true }).click()
  await confirm.waitFor({ state: 'detached' })
  await expect(page.getByRole('button', { name: 'Reported page', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Other page', exact: true }).click()
  await frame.getByRole('heading', { name: 'Other page', exact: true }).waitFor()
  await menu.locator('a[href="/booking?lang=sv&mode=dark"]').waitFor()
  await expect(menu.locator('a[href^="/reported-page"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.waitForFunction(() =>
    globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'),
  )
  const after = backend.document.presentation
  const other = after.pages.find((item) => item.path === '/other-page')
  assert.equal(
    after.pages.some((item) => item.path === '/reported-page'),
    false,
    'the deleted page is gone from the published document',
  )
  assert.ok(
    !renderSitePage(after, other, 'sv', 'dark', contact).html.includes('/reported-page'),
    'the deleted page is gone from the other page menu without republishing its content',
  )
  const otherVisitor = await visit(
    globalThis.structuredClone(after),
    '/other-page?lang=sv&mode=dark',
  )
  await otherVisitor.locator('#cms-site-menu a[href="/booking?lang=sv&mode=dark"]').waitFor()
  await expect(otherVisitor.locator('#cms-site-menu a[href^="/reported-page"]')).toHaveCount(0)
  await otherVisitor.close()
  await shot('deleted')
  await testInfo.attach('public-header', { body: publicDark, contentType: 'text/html' })
})
test('2-device-switch-styles', async ({ page, studio }, testInfo) => {
  const { frame, shot } = studio
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
      await frame.locator('#cms-site-header').evaluate((node) => {
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
  await testInfo.attach('metrics', {
    body: JSON.stringify(snapshots, null, 2),
    contentType: 'application/json',
  })
})
test('3-activate-email-design', async ({ page, studio }) => {
  const { shot } = studio
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
    barberFixture({
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
    }),
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
test.describe('booking scenes', () => {
  test.use({ catalogFixture: true })
  test('4-booking-full-page-scenes', async ({ page, studio }, testInfo) => {
    const { frame, shot } = studio
    const captured = await studio.capture()
    const legacyUpgrade = await page.evaluate(async (capturedDocument) => {
      const { ensureCorePages, needsCorePageSource } =
        await import('/modules/studio/src/corePages.ts')
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
        inputUnchanged: JSON.stringify(document.presentation.pages) === JSON.stringify(beforeInput),
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
    assert.equal(legacyUpgrade.missingBefore, true, 'legacy booking shells require source upgrade')
    assert.equal(legacyUpgrade.missingAfter, false, 'both booking shell markers should be restored')
    assert.equal(legacyUpgrade.inputUnchanged, true, 'upgrade must not mutate the owner document')
    assert.equal(legacyUpgrade.ownerCssUnchanged, true, 'marker upgrade must preserve owner styles')
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
          await flow.locator('[data-knc-surface="booking-options"]').waitFor({ state: 'visible' })
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
    await testInfo.attach('metrics', {
      body: JSON.stringify(checks, null, 2),
      contentType: 'application/json',
    })
  })
})
test('5-comparison-font-parity', async ({ page, studio, browserName, evidenceDir }, testInfo) => {
  const { frame, shot } = studio
  const out = evidenceDir
  const engineName = browserName
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
  assert.deepEqual(actual.textLines, expected.textLines, 'comparison must preserve text geometry')
  await testInfo.attach('metrics', {
    body: JSON.stringify({ expected, actual }, null, 2),
    contentType: 'application/json',
  })
})

// The production presentation with a created page whose accepted Swedish body is `body`, adopted
// as the Studio adopts it, on its own backend with an offline source, and the Studio opened on it.
const COLLISION_PAGE_ID = '12222222-2222-4222-8222-222222222222'
const OFFLINE_SOURCE =
  '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>'
const collisionStudio = async (page, context, body) => {
  const created = createSitePage({
    id: COLLISION_PAGE_ID,
    path: '/collision',
    name: { sv: 'Kollision', en: 'Collision' },
  })
  created.content.sv.html = body
  const raw = {
    ...documentFixture(),
    presentation: JSON.parse(
      gunzipSync(readFileSync(new URL('./fixtures/presentation.json.gz', import.meta.url))),
    ).presentation,
  }
  raw.presentation.pages.push(created)
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  const { stored, adopted } = await page.evaluate(async (document) => {
    const { normalizeDocument } = await import('/modules/studio/src/normalizeDocument.ts')
    const stored = normalizeDocument(document)
    return { stored, adopted: normalizeDocument(stored) === stored }
  }, raw)
  assert.equal(adopted, true, 'The stored document is already adopted')
  const backend = await nativeBackend(context, stored)
  await context.route('**/cms-public/source', (route) =>
    route.fulfill({ contentType: 'text/html', body: OFFLINE_SOURCE }),
  )
  const collision = (document) =>
    document.presentation.pages.find((item) => item.path === '/collision')
  // The shared validation pipeline of the cms-studio validate and publish handlers accepts it.
  const validated = await page.evaluate(async (document) => {
    const { cmsApi } = await import('/modules/studio/src/api.ts')
    return cmsApi.validate(document)
  }, stored)
  expect(collision(validated.document).content.sv.html).toBe(body)
  const frame = page.frameLocator('.gjs-frame').first()
  // Each opening is an owner's visit to the stored document.
  const open = async (visit) => {
    if (visit) await page.goto(`${base}/tools/e2e/admin-harness.html`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
    await page
      .locator('.cms-page-list')
      .getByRole('button', { name: 'Kollision', exact: true })
      .click()
    await frame.locator('#editme').waitFor()
    // The body renders before the load's last step configures the components and locks the
    // generated header, which comes first; the page is ready for an edit only after that.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const wrapper = cmsGrapes.editors.at(-1)?.getWrapper()
          const first = wrapper?.components().at(0)
          return (
            wrapper?.find('#editme').length === 1 &&
            first?.get('tagName') === 'header' &&
            first.get('selectable') === false
          )
        }),
      )
      .toBe(true)
  }
  // Edits only the heading, publishes, and returns the stored Swedish variant.
  const publishHeading = async (heading, revision) => {
    await select(page, '#editme')
    await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(heading)
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.waitForFunction(
      (revision) =>
        globalThis.document.querySelector('.cms-status')?.textContent ===
        `Publicerad · rev ${revision}`,
      revision,
      { timeout: 45000 },
    )
    return collision(backend.document).content.sv
  }
  await open(false)
  return { backend, frame, publishHeading, reopen: () => open(true) }
}

// The ids of the generated chrome. An accepted owner body can carry any of them, so capture must
// know the generated header, content wrapper and footer from the render, not by these ids.
const CHROME_IDS = ['cms-site-header', 'cms-site-menu', 'cms-site-content', 'cms-site-footer']
for (const chromeId of CHROME_IDS)
  test(`an owner section with id ${chromeId} survives two heading publications and a reopen, and generated chrome is never stored`, async ({
    page,
    context,
  }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const ownerText = `Ägarens innehåll i ${chromeId}`
    const studio = await collisionStudio(
      page,
      context,
      `<main><h1 id="editme">Redigera mig</h1><section id="${chromeId}"><p>${ownerText}</p></section></main>`,
    )
    const expectOwnerBody = (html, heading) => {
      expect(html.split(ownerText), `${chromeId}: the owner text is stored once`).toHaveLength(2)
      expect(html, 'the stored body is the owner main element alone').toMatch(/^<main>.*<\/main>$/s)
      expect(html).toContain(`<h1 id="editme">${heading}</h1>`)
      // GrapesJS renames an owner id that a generated element before it already uses (-2).
      expect(
        [chromeId, `${chromeId}-2`].some((id) =>
          html.includes(`<section id="${id}"><p>${ownerText}</p></section>`),
        ),
        `${chromeId}: the owner section is stored whole`,
      ).toBe(true)
      for (const generated of [
        '<header',
        '<nav',
        '<footer',
        'cms-site-bar',
        '?lang=',
        'Integritetspolicy',
        'Bokningsvillkor',
      ])
        expect(html, `${chromeId}: generated ${generated} is never stored`).not.toContain(generated)
    }
    const first = await studio.publishHeading('Första rubriken', 2)
    expectOwnerBody(first.html, 'Första rubriken')
    await studio.reopen()
    await expect(studio.frame.locator('footer')).toHaveCount(1)
    await expect(studio.frame.getByText(ownerText, { exact: true })).toHaveCount(1)
    const second = await studio.publishHeading('Andra rubriken', 3)
    expectOwnerBody(second.html, 'Andra rubriken')
    expect(second.html, 'a second publication stores the same body').toBe(
      first.html.replace('Första rubriken', 'Andra rubriken'),
    )
    assert.deepEqual(errors, [], 'no unhandled browser errors')
  })

// cms-site-shell is the id that marks the page format from before the live header. The Studio
// migrates that format whenever it takes a document in, so a draft holds it only when the owner
// gives an element that id; publication then refuses the page and says why.
test('publication refuses an owner element renamed to cms-site-shell until the id is changed', async ({
  page,
  context,
}) => {
  const studio = await collisionStudio(
    page,
    context,
    '<main id="owner-main"><h1 id="editme">Redigera mig</h1></main>',
  )
  const rename = async (from, to) => {
    await select(page, `#${from}`)
    const id = page.locator('#cms-traits').getByPlaceholder('Elementets id', { exact: true })
    await id.fill(to)
    await id.press('Enter')
    await studio.frame.locator(`main#${to}`).waitFor()
  }
  await rename('owner-main', 'cms-site-shell')
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'presentation./collision:' }),
  ).toContainText(
    'Sidan har ett element med id cms-site-shell eller är sparad i ett äldre format med en egen kopia av sidhuvudet. Byt elementets id,',
  )
  await expect(page.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  expect(studio.backend.writes, 'nothing is published').toEqual([])
  await rename('cms-site-shell', 'owner-main')
  const published = await studio.publishHeading('Publicerad rubrik', 2)
  expect(published.html).toBe('<main id="owner-main"><h1 id="editme">Publicerad rubrik</h1></main>')
})

test('the canvas locks only the generated header and footer when owner sections carry their ids', async ({
  page,
  context,
}) => {
  const sections = CHROME_IDS.map(
    (id) => `<section id="${id}"><p>Ägarens innehåll i ${id}</p></section>`,
  ).join('')
  await collisionStudio(page, context, `<main><h1 id="editme">Redigera mig</h1>${sections}</main>`)
  const flags = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const flag = (component) =>
      ['selectable', 'removable', 'copyable'].map((name) => component.get(name))
    const top = editor.getWrapper().components().models
    return {
      top: top.map((component) => component.get('tagName')),
      header: flag(top[0]),
      footer: flag(top[top.length - 1]),
      owners: editor
        .getWrapper()
        .find('main section')
        .map((component) => [component.getEl()?.textContent, ...flag(component)]),
    }
  })
  expect(flags.top).toEqual(['header', 'div', 'footer'])
  expect(flags.header, 'the generated header is locked').toEqual([false, false, false])
  expect(flags.footer, 'the generated footer is locked').toEqual([false, false, false])
  expect(flags.owners, 'every owner section stays selectable, removable and copyable').toEqual(
    CHROME_IDS.map((id) => [`Ägarens innehåll i ${id}`, true, true, true]),
  )
})

// The normalisation gives an inline style an id of its own; an owner id met before or after it
// in the body must never be that id.
for (const order of ['before', 'after'])
  test(`an inline style never takes the owner id that comes ${order} it, through publication and reopen`, async ({
    page,
    context,
  }) => {
    const taken = `cms-page-${COLLISION_PAGE_ID}-sv-0`
    const original = `<p id="${taken}">Ägarens id</p>`
    const styled = '<p style="color:red">Ägarens röda text</p>'
    const studio = await collisionStudio(
      page,
      context,
      `<main><h1 id="editme">Redigera mig</h1>${order === 'before' ? original + styled : styled + original}</main>`,
    )
    const expectPaint = async (stage) => {
      const painted = await studio.frame
        .locator('main p')
        .evaluateAll((nodes) =>
          nodes.map((node) => [node.textContent, node.id, getComputedStyle(node).color]),
        )
      const byText = new Map(painted.map(([text, id, color]) => [text, { id, color }]))
      expect(byText.get('Ägarens id')?.id, `${stage}: the owner paragraph keeps its id`).toBe(taken)
      expect(byText.get('Ägarens id')?.color, `${stage}: the owner paragraph is not red`).not.toBe(
        'rgb(255, 0, 0)',
      )
      expect(byText.get('Ägarens röda text')?.color, `${stage}: the styled paragraph is red`).toBe(
        'rgb(255, 0, 0)',
      )
      expect(new Set(painted.map(([, id]) => id)).size, `${stage}: unique ids`).toBe(2)
    }
    await expectPaint('canvas')
    const stored = await studio.publishHeading('Ny rubrik', 2)
    const ids = [...stored.html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size, `stored ids: ${ids.join(' ')}`).toBe(ids.length)
    expect(stored.html).toContain(original)
    await studio.reopen()
    await expectPaint('reopened')
  })

// Rules an earlier Studio stored to hide its frozen header copy. The migrated page must show the
// live header and keep the owner's own paint, however the rule is nested or spelled.
const FROZEN_OWNED_BODY =
  '<div id="cms-site-shell"><header id="cms-site-header">Old</header><div id="cms-site-content"><main class="owned">Body</main></div></div>'
const FROZEN_HIDING_SHEETS = [
  ['flat', '#cms-site-header{display:none}'],
  ['nested', ':root{& #cms-site-header{display:none}}'],
  ['escaped', String.raw`#cms\2d site-header{display:none}`],
  [
    'layered',
    '@layer first{#cms-site-header{display:none}}@layer second{.owned{color:blue}}@layer first{.owned{color:red}}',
  ],
]
for (const [shape, css] of FROZEN_HIDING_SHEETS)
  test(`a migrated frozen page shows the live header and keeps owner paint after a ${shape} hiding rule`, async ({
    page,
  }) => {
    const paint = async (html, sheet) => {
      await page.setContent(`<!doctype html><style>${sheet}</style>${html}`)
      return page.evaluate(() => {
        const header = globalThis.document.querySelector('#cms-site-header')
        return {
          display: getComputedStyle(header).display,
          height: header.getBoundingClientRect().height,
          owned: getComputedStyle(globalThis.document.querySelector('.owned')).color,
        }
      })
    }
    const frozen = createSitePage({
      id: '14444444-4444-4444-8444-444444444444',
      path: '/offer',
      name: { sv: 'Erbjudande', en: 'Offer' },
    })
    frozen.layout = 'independent'
    for (const lang of ['sv', 'en'])
      frozen.content[lang] = { html: FROZEN_OWNED_BODY, css: { light: css, dark: css } }
    const stored = await paint(FROZEN_OWNED_BODY, css)
    expect(stored.display, `${shape}: the stored rule hides the frozen header`).toBe('none')
    const migrated = dropFrozenChrome(frozen)
    const live = renderSitePage(
      { ...seed.presentation, pages: [migrated] },
      migrated,
      'sv',
      'light',
      { phoneTel: '', phoneDisplay: '', mapsHref: '' },
    )
    const served = await paint(live.html, `${SITE_PAGE_CSS}\n${live.css.light}`)
    expect(served.display, `${shape}: the live header is displayed`).not.toBe('none')
    expect(served.height, `${shape}: the live header has a height`).toBeGreaterThan(0)
    const own = await paint(live.html, live.css.light)
    expect(own.owned, `${shape}: the owner body keeps its paint`).toBe(stored.owned)
  })
