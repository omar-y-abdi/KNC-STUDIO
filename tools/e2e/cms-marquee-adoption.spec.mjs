import assert from 'node:assert/strict'
import { generate, parse, walk } from 'css-tree'
import { marqueeCardWidth } from '../../src/admin/cms/hierarchicalResize.ts'
import { nativeBackend } from './cms-backend.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

// Adoption paths that cms-marquee-zoom.spec.mjs does not reach: the asynchronous source upgrade
// of a stored About page without strip markers, and undo after a conflict resolution.

const LEGACY_ZOOM = 0.699029

const barbers = ['A', 'B', 'C', 'D'].map((name, index) => ({
  id: `adoption-barber-${index + 1}`,
  name: `Barber ${name}`,
  ig: `barber${index + 1}`,
  role_sv: 'Frisör',
  role_en: 'Barber',
  bio_sv: `Presentation ${name}.`,
  bio_en: `Profile ${name}.`,
  active: true,
  sort_order: index,
  photo_path: null,
}))

async function fixtureRoutes(context) {
  await context.route('https://admin-harness.invalid/**', (route) => {
    const url = new URL(route.request().url())
    const headers = { 'Access-Control-Allow-Origin': new URL(harnessOrigin).origin }
    if (route.request().method() === 'OPTIONS') return route.fallback()
    if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
      return route.fulfill({ headers, json: { barbers, services: [] } })
    if (url.pathname === '/rest/v1/gallery_images') return route.fulfill({ headers, json: [] })
    return route.fallback()
  })
}

async function mountStudio(page) {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
}

async function publish(page, revision) {
  await page.getByText('Opublicerade ändringar', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText(`Publicerad · rev ${revision}`, { exact: true }).waitFor({ timeout: 15000 })
}

const aboutPage = (document) => document.presentation.pages.find((page) => page.path === '/about')

/** The source-captured site as Studio publishes it, with the strip identities of each language. */
async function capturedSite(newContext) {
  const context = await newContext({ viewport: { width: 1440, height: 900 } })
  const backend = await nativeBackend(context)
  await fixtureRoutes(context)
  const page = await context.newPage()
  await mountStudio(page)
  await publish(page, 2)
  const captured = globalThis.structuredClone(backend.document)
  const ids = await page.evaluate((about) => {
    const ids = {}
    for (const lang of ['sv', 'en']) {
      const tree = new globalThis.DOMParser().parseFromString(about.content[lang].html, 'text/html')
      const group = tree.querySelector('[data-knc-fold="barber-marquee"][data-knc-source]')
      const cards = [...(group?.children ?? [])].filter((card) => card.id)
      if (!group?.id || cards.length !== 4) throw new Error(`The ${lang} barber strip is missing`)
      ids[lang] = { strip: group.id, cards: cards.map((card) => card.id) }
    }
    return ids
  }, aboutPage(captured))
  await context.close()
  return { captured, ids }
}

/** Every mobile barber card scaled by zoom in each About variant, as revisions 33-43 stored it. */
function withLegacyZoom(document, ids, title) {
  const legacy = globalThis.structuredClone(document)
  const about = aboutPage(legacy)
  about.title.sv = title
  for (const lang of ['sv', 'en'])
    for (const mode of ['light', 'dark'])
      about.content[lang].css[mode] +=
        '\n@media (max-width:768px){' +
        ids[lang].cards.map((id) => `#${id}{zoom:${LEGACY_ZOOM}!important}`).join('') +
        '}'
  return legacy
}

/** The stored About CSS sizes every card by width and never zooms the strip or a card. */
function assertCardWidths(document, ids, stage) {
  const expected = generate(parse(marqueeCardWidth(LEGACY_ZOOM), { context: 'value' }))
  for (const lang of ['sv', 'en'])
    for (const mode of ['light', 'dark']) {
      const owned = new Set([ids[lang].strip, ...ids[lang].cards])
      const widths = new Map()
      walk(parse(aboutPage(document).content[lang].css[mode]), {
        visit: 'Rule',
        enter(rule) {
          const id = generate(rule.prelude).replace(/^#/, '')
          if (!owned.has(id)) return
          const mobile = this.atrule && generate(this.atrule.prelude) === '(max-width:768px)'
          walk(rule.block, {
            visit: 'Declaration',
            enter(declaration) {
              assert.notEqual(
                declaration.property,
                'zoom',
                `${stage}: ${lang}/${mode} still zooms #${id}`,
              )
              if (mobile && ['width', 'flex-basis'].includes(declaration.property))
                widths.set(`${id} ${declaration.property}`, generate(declaration.value))
            },
          })
        },
      })
      for (const id of ids[lang].cards)
        for (const property of ['width', 'flex-basis'])
          assert.equal(
            widths.get(`${id} ${property}`),
            expected,
            `${stage}: ${lang}/${mode} #${id} lacks its mobile ${property}`,
          )
    }
}

test('legacy zoom is converted once the source upgrade restores the strip markers', async ({
  newContext,
}) => {
  test.setTimeout(300_000)
  const { captured, ids } = await capturedSite(newContext)
  // A stored About page from before the strip marker existed: complete, so load skips the source.
  const legacy = withLegacyZoom(captured, ids, 'Om oss (utan markör)')
  for (const lang of ['sv', 'en']) {
    const about = aboutPage(legacy).content[lang]
    about.html = about.html.replaceAll(' data-knc-fold="barber-marquee"', '')
    assert.ok(!about.html.includes('barber-marquee'), `${lang} still carries the strip marker`)
  }
  const context = await newContext({ viewport: { width: 1440, height: 900 } })
  context.setDefaultTimeout(15000)
  const backend = await nativeBackend(context, legacy)
  await fixtureRoutes(context)
  const page = await context.newPage()
  await mountStudio(page)
  // The upgrade makes the draft dirty only after the source capture finished.
  await publish(page, 2)
  assert.equal(aboutPage(backend.document).title.sv, 'Om oss (utan markör)')
  assertCardWidths(backend.document, ids, 'Source upgrade')
})

test('undo after a conflict resolution never returns to the raw legacy zoom', async ({
  newContext,
}) => {
  test.setTimeout(300_000)
  const { captured, ids } = await capturedSite(newContext)
  const context = await newContext({ viewport: { width: 1440, height: 900 } })
  context.setDefaultTimeout(15000)
  const backend = await nativeBackend(context, withLegacyZoom(captured, ids, 'Om oss (rev 1)'))
  await fixtureRoutes(context)
  const page = await context.newPage()
  await mountStudio(page)
  await page.getByText('Opublicerade ändringar', { exact: true }).waitFor()
  // Another session publishes the raw legacy zoom with its own change to the same stylesheet.
  const remote = withLegacyZoom(captured, ids, 'Om oss (server)')
  aboutPage(remote).content.sv.css.light += `\n#${ids.sv.cards[0]}{color:red}`
  await page.evaluate(async (remote) => {
    const { cmsApi } = await import('/src/admin/cms/api.ts')
    const head = await cmsApi.state()
    await cmsApi.publish(remote, head.revision, head.fingerprint, globalThis.crypto.randomUUID())
  }, remote)
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  const keepServer = page.getByRole('button', {
    name: 'Använd serverns konfliktändringar',
    exact: true,
  })
  await keepServer.click()
  await page.getByText('Konflikten är löst i utkastet. Granska före publicering.').waitFor()
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  )
  // Undo reaches the converted server document, which still differs from its raw zoom.
  assert.equal(
    await page.locator('.cms-status').textContent(),
    'Opublicerade ändringar',
    'Undo returned to the raw legacy zoom of the server',
  )
  await publish(page, 3)
  assert.equal(aboutPage(backend.document).title.sv, 'Om oss (server)')
  assertCardWidths(backend.document, ids, 'Conflict undo')
})
