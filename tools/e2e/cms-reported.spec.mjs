import { routeApi } from './route-api.mjs'
import { barberFixture, documentFixture } from './builders.mjs'
/* global getComputedStyle */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { EMAIL_NAMES } from '../../shared/cms.ts'
import { renderSitePage } from '../../shared/site-page.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'
import { nativeBackend } from './cms-backend.mjs'
import { loadWorker, routeWorkerDocuments } from './cms-render.mjs'
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
    const backend = await nativeBackend(context, document)
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
    await use({ backend, frame, shot, capture })
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
      const { cmsApi } = await import('/src/admin/cms/api.ts')
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
          await import('/src/admin/cms/corePages.ts')
        const { emptyDocument } = await import('/shared/cms.ts')
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
          const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
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
    const { NativeSiteProvider } = await import('/src/cms/NativeSurface.tsx')
    const { SitePageLinks } = await import('/src/cms/SitePageLinks.tsx')
    const { menuLinks } = await import('/shared/site-page.ts')
    const { isNativePublicPath } = await import('/src/site/routeMetadata.ts')
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
  expect(links.spa).toEqual(['/review-created'])
  expect(links.derived).toContain('/review-created')
  expect(links.derived).not.toContain('/contact')
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
          layoutWidth: layout ? getComputedStyle(layout).maxWidth : null,
          fontFace: fonts?.textContent.includes(fontFace) ?? false,
          fontSheet: fonts?.sheet?.cssRules.length > 0,
        }
      }, fontFace)
    const legal = (scheme) => ({
      links: ['/tokens.css', '/info.css'],
      loaded: true,
      scheme,
      layoutWidth: '736px',
      fontFace: true,
      fontSheet: true,
    })
    await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
    await page.getByRole('button', { name: 'Mörk', exact: true }).click()
    await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
    await expect.poll(head, { message: 'legal canvas in Mörk' }).toEqual(legal('dark'))
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
    const canvas = await (await page.locator('.gjs-frame').first().elementHandle()).contentFrame()
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

const LEGACY_LEGAL_CSS = Object.fromEntries(
  ['terms', 'privacy'].map((kind) => [
    `/${kind}`,
    readFileSync(new URL(`../../src/admin/cms/legacy-legal-${kind}.txt`, import.meta.url), 'utf8'),
  ]),
)
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
      const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
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

// Import runs ensureCorePages, which writes each core page's html back as DOMParser body.innerHTML:
// the whitespace before the first element is dropped and nothing else may change. Complete server
// heads use withCorePages instead and retain that whitespace.
const adoptedContents = (contents) =>
  Object.fromEntries(
    Object.entries(contents).map(([path, content]) => [
      path,
      Object.fromEntries(
        Object.entries(content).map(([lang, variant]) => [
          lang,
          { ...variant, html: variant.html.replace(/^\s+/, '') },
        ]),
      ),
    ]),
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
      const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
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
  const imported = adoptedContents(expected)
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'pre-upgrade.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  })
  await page.getByText('JSON-utkastet importerades', { exact: false }).waitFor()
  await expect
    .poll(() => legalContents(studio, expected), { message: 'the imported legal pages' })
    .toEqual(imported)
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
      (await import('/src/admin/cms/api.ts')).cmsApi.publish(
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
    const { withCorePages } = await import('/src/admin/cms/corePages.ts')
    const { normalizeDocument } = await import('/src/admin/cms/normalizeDocument.ts')
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
      const { ensureCorePages, needsCorePageSource } = await import('/src/admin/cms/corePages.ts')
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
