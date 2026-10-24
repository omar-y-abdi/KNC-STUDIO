import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { generate, parse, walk } from 'css-tree'
import { marqueeCardWidth } from '../../src/admin/cms/hierarchicalResize.ts'
import { nativeBackend } from './cms-backend.mjs'
import { installBlankProbe, readBlankProbe } from './cms-marquee-probe.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

// Production stored this card zoom in revisions 33-43; Embla then left most of the strip blank.
const LEGACY_ZOOM = 0.699029
const MAX_BLANK = 96
const strip = '[data-knc-fold="barber-marquee"]'

const barbers = ['A', 'B', 'C', 'D'].map((name, index) => ({
  id: `zoom-barber-${index + 1}`,
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
const gallery = ['salon', 'cuts'].flatMap((kind) =>
  [1, 2, 3].map((number) => ({
    id: `${kind}-${number}`,
    kind,
    storage_path: `${kind}/${number}.png`,
    alt: `${kind} fixture ${number}`,
    sort_order: number,
  })),
)

async function fixtureRoutes(context) {
  await context.route('https://admin-harness.invalid/**', (route) => {
    const url = new URL(route.request().url())
    const headers = { 'Access-Control-Allow-Origin': new URL(harnessOrigin).origin }
    if (route.request().method() === 'OPTIONS') return route.fallback()
    if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
      return route.fulfill({ headers, json: { barbers, services: [] } })
    if (url.pathname === '/rest/v1/gallery_images') {
      const kind = url.searchParams.get('kind')?.slice(3)
      return route.fulfill({ headers, json: gallery.filter((item) => item.kind === kind) })
    }
    if (url.pathname.startsWith('/storage/v1/object/public/'))
      return route.fulfill({ headers, contentType: 'image/png', path: 'public/og-image.png' })
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

/** The legacy shape: every mobile barber card scaled by zoom in each About variant. */
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

test('legacy barber zoom never survives load, import, history or backup restore', async ({
  newContext,
  evidenceDir,
}) => {
  test.setTimeout(600_000)
  const captureContext = await newContext({ viewport: { width: 1440, height: 900 } })
  await nativeBackend(captureContext)
  await fixtureRoutes(captureContext)
  const capturePage = await captureContext.newPage()
  await mountStudio(capturePage)
  const { captured, ids } = await capturePage.evaluate(async () => {
    const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
    await session.flush()
    const backup = await session.own()
    if (!backup) throw new Error('The CMS source was not captured')
    const about = backup.document.presentation.pages.find((page) => page.path === '/about')
    const ids = {}
    for (const lang of ['sv', 'en']) {
      const tree = new globalThis.DOMParser().parseFromString(about.content[lang].html, 'text/html')
      const group = tree.querySelector('[data-knc-fold="barber-marquee"][data-knc-source]')
      const cards = [...(group?.children ?? [])].filter((card) => card.id)
      if (!group?.id || cards.length !== 4) throw new Error(`The ${lang} barber strip is missing`)
      ids[lang] = { strip: group.id, cards: cards.map((card) => card.id) }
    }
    return { captured: backup.document, ids }
  })
  await captureContext.close()

  const context = await newContext({ viewport: { width: 1440, height: 900 } })
  context.setDefaultTimeout(15000)
  const backend = await nativeBackend(context, withLegacyZoom(captured, ids, 'Om oss (rev 1)'))
  await fixtureRoutes(context)
  const page = await context.newPage()
  await mountStudio(page)

  // Load: the stored head with legacy zoom opens as an unpublished width-form draft.
  const status = page.locator('.cms-status')
  await status.filter({ hasText: /^(Opublicerade ändringar|Publicerad · rev 1)$/ }).waitFor()
  assert.equal(
    await status.textContent(),
    'Opublicerade ändringar',
    'Load kept the stored legacy zoom unchanged',
  )
  await publish(page, 2)
  assertCardWidths(backend.document, ids, 'Load')

  // The editor neither offers nor accepts the properties the marquee code owns.
  const policy = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const offered = async (selector, sector, property) => {
      const target = editor.getWrapper().find(selector)[0]
      if (!target) throw new Error(`Missing ${selector}`)
      editor.select(target)
      // The Style Manager applies a new selection on its next tick.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
      return editor.StyleManager.getProperty(sector, property)?.isVisible() ?? false
    }
    return {
      trackTransform: await offered('[data-knc-fold="gallery-track"]', 'position', 'transform'),
      tileWidth: await offered('[data-knc-fold="gallery-tile"]', 'layout', 'width'),
      stripOverflow: await offered('[data-knc-fold="barber-marquee"]', 'layout', 'overflow'),
      stripWidth: await offered('[data-knc-fold="barber-marquee"]', 'layout', 'width'),
      stripHeight: await offered('[data-knc-fold="barber-marquee"]', 'layout', 'height'),
      textColor: await offered('[data-knc-fold="gallery-tile"]', 'typography', 'color'),
    }
  })
  // The loop floor needs a strip width that does not follow its cards; its height stays the owner's.
  assert.deepEqual(policy, {
    trackTransform: false,
    tileWidth: false,
    stripOverflow: false,
    stripWidth: false,
    stripHeight: true,
    textColor: true,
  })
  const advanced = page.locator('#cms-inspector .cms-advanced')
  const applyAdvanced = async (selector, property, value) => {
    await page.evaluate(async (selector) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      editor.select(editor.getWrapper().find(selector)[0])
    }, selector)
    if ((await advanced.getAttribute('open')) === null) await advanced.locator('summary').click()
    await advanced.getByLabel('Egenskap', { exact: true }).fill(property)
    await advanced.getByLabel('Värde', { exact: true }).fill(value)
    await advanced.getByRole('button', { name: 'Tillämpa', exact: true }).click()
  }
  for (const [selector, property, value, denied] of [
    ['[data-knc-fold="gallery-track"]', 'transform', 'translateX(40px)', 'transform'],
    ['[data-knc-fold="gallery-tile"]', 'flex', '0 0 320px', 'flex-basis'],
    ['[data-knc-fold="barber-marquee"]', 'zoom', '0.5', 'zoom'],
  ]) {
    await applyAdvanced(selector, property, value)
    await page
      .getByText(
        `CSS-egenskapen ${denied} styrs av den rörliga karusellen och kan inte ändras här.`,
        { exact: true },
      )
      .waitFor()
  }
  assert.equal(
    await page.getByText('Publicerad · rev 2', { exact: true }).count(),
    1,
    'A rejected property changed the draft',
  )

  await page.getByRole('alert').getByRole('button', { name: 'Stäng', exact: true }).click()

  // Import: a JSON copy carrying the legacy zoom is converted before it becomes the draft.
  await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
  await page.locator('.cms-backup-panel input[type=file]').setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(withLegacyZoom(captured, ids, 'Om oss (import)'))),
  })
  await page.getByText('JSON-utkastet importerades och är ännu inte publicerat.').waitFor()
  await page.keyboard.press('Escape')
  await publish(page, 3)
  assert.equal(aboutPage(backend.document).title.sv, 'Om oss (import)')
  assertCardWidths(backend.document, ids, 'Import')

  // History: restoring the zoomed first revision restores its content in width form.
  await page.getByRole('button', { name: 'Historik', exact: true }).click()
  await page
    .locator('.cms-history-row')
    .filter({ hasText: 'v1' })
    .getByRole('button', { name: 'Återställ till utkast', exact: true })
    .click()
  await publish(page, 4)
  assert.equal(aboutPage(backend.document).title.sv, 'Om oss (rev 1)')
  assertCardWidths(backend.document, ids, 'History restore')

  // Backup: an unpublished local draft from before the fix is converted when Studio adopts it.
  await page.evaluate(
    async (legacy) => {
      const { cmsApi } = await import('/src/admin/cms/api.ts')
      const { cmsBackups } = await import('/src/admin/cms/backup.ts')
      const head = await cmsApi.state()
      const session = await cmsBackups()
      session.schedule({ document: legacy, revision: head.revision, fingerprint: head.fingerprint })
      await session.flush()
    },
    withLegacyZoom(captured, ids, 'Om oss (backup)'),
  )
  await mountStudio(page)
  await publish(page, 5)
  assert.equal(aboutPage(backend.document).title.sv, 'Om oss (backup)')
  assertCardWidths(backend.document, ids, 'Backup restore')

  // Public: the published strip keeps moving and never leaves more than two card gaps blank.
  const liveContext = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await nativeBackend(liveContext, backend.document)
  await fixtureRoutes(liveContext)
  await liveContext.clock.install()
  const live = await liveContext.newPage()
  await live.goto(`${harnessOrigin}/about`)
  // Page timers, effects and frames advance only with the fake clock.
  await liveContext.clock.runFor(1000)
  await live.getByRole('button', { name: 'Avvisa valfri lagring', exact: true }).click()
  const cards = live.locator(`${strip} > [role="button"]`)
  for (let step = 0; step < 40 && (await cards.count()) < 4; step++)
    await liveContext.clock.runFor(250)
  assert.equal(await cards.count(), 4, 'The public strip did not render its barbers')
  await liveContext.clock.runFor(3000)
  const layout = await cards.first().evaluate((card) => ({
    width: card.getBoundingClientRect().width,
    layoutWidth: card.offsetWidth,
    zoom: globalThis.getComputedStyle(card).zoom,
  }))
  assert.ok(Math.abs(layout.width - LEGACY_ZOOM * (390 - 24)) < 1, JSON.stringify(layout))
  assert.ok(Math.abs(layout.layoutWidth - layout.width) < 1, JSON.stringify(layout))
  await live.evaluate(installBlankProbe, strip)
  await liveContext.clock.runFor(90_000)
  const probe = await live.evaluate(readBlankProbe)
  await writeFile(`${evidenceDir}/public-strip.json`, JSON.stringify({ layout, probe }, null, 2))
  // Embla 8.6 measures slides by whole-pixel offsetLeft and offsetWidth in their offset parent and
  // moves a card across the loop only 0.5 px (roundingSafety) after it reaches the view. Behind a
  // strip at a fractional offset, a card's left edge, and the cycle's end at the last card's right
  // edge, each round up to ceil(edge) - edge px late, so a gap opens at most
  // 0.5 + max(ceil(edge) - edge) px wider: 1.125 px for 255.84375 px cards (cycle end 1191.375).
  const lefts = [1, 2, 3].map((index) => 24 + index * (layout.width + 48))
  const edges = [...lefts, 24 + 4 * layout.width + 3 * 48]
  const seam = 0.5 + Math.max(...edges.map((edge) => Math.ceil(edge) - edge))
  assert.ok(
    probe.maxBlank <= MAX_BLANK + seam,
    `${probe.maxBlank} px of the public strip went blank (seam ${seam} px)`,
  )
  assert.ok(
    probe.offsets.slice(1).every((value, index) => Math.abs(value - probe.offsets[index]) > 1),
    `The public strip stopped moving (${probe.offsets.join(', ')})`,
  )
})
