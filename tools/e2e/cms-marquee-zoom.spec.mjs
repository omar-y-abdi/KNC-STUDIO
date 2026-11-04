import { barberFixture, assetFixture } from './builders.mjs'
import { routeApi } from './route-api.mjs'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { generate, parse, walk } from 'css-tree'
import { marqueeCardWidth } from '../../src/admin/cms/hierarchicalResize.ts'
import { nativeBackend } from './cms-backend.mjs'
import { installBlankProbe, readBlankProbe } from './cms-marquee-probe.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
const LEGACY_ZOOM = 0.699029

const gallery = ['salon', 'cuts'].flatMap((kind) =>
  [1, 2, 3].map((number) => ({
    id: `${kind}-${number}`,
    kind,
    storage_path: `${kind}/${number}.png`,
    alt: `${kind} fixture ${number}`,
    sort_order: number,
  })),
)

async function fixtureRoutes(context, barbers) {
  await routeApi(context, [
    [
      'https://admin-harness.invalid/**',
      (route, headers) => {
        const url = new URL(route.request().url())

        if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
          return route.fulfill({ headers, json: { barbers, services: [] } })
        if (url.pathname === '/rest/v1/gallery_images') {
          const kind = url.searchParams.get('kind')?.slice(3)
          return route.fulfill({ headers, json: gallery.filter((item) => item.kind === kind) })
        }
        if (url.pathname.startsWith('/storage/v1/object/public/'))
          return route.fulfill({ headers, contentType: 'image/png', path: 'public/og-image.png' })
        return route.fallback()
      },
    ],
  ])
}

async function mountStudio(page) {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
  // These probes inspect the model directly, including the deferred inactive About copy.
  await page
    .locator('.cms-editor-canvas[data-cms-about-preview-ready="true"]')
    .waitFor({ timeout: 90000 })
}

async function publish(page, revision) {
  await page.getByText('Opublicerade ändringar', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText(`Publicerad · rev ${revision}`, { exact: true }).waitFor({ timeout: 15000 })
}

const aboutPage = (document) => document.presentation.pages.find((page) => page.path === '/about')

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
test.describe('stored marquee', () => {
  // Production stored this card zoom in revisions 33-43; Embla then left most of the strip blank.

  const MAX_BLANK = 96

  const strip = '[data-knc-fold="barber-marquee"]'

  const barbers = ['A', 'B', 'C', 'D'].map((name, index) =>
    barberFixture({
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
    }),
  )

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

  test('legacy barber zoom never survives load, import, history or backup restore', async ({
    newContext,
    evidenceDir,
  }) => {
    test.setTimeout(600_000)
    const captureContext = await newContext({ viewport: { width: 1440, height: 900 } })
    await nativeBackend(captureContext)
    await fixtureRoutes(captureContext, barbers)
    const capturePage = await captureContext.newPage()
    await mountStudio(capturePage)
    // Only owner edits create backups; the captured source alone is pristine.
    await capturePage.getByRole('textbox', { name: 'Namn', exact: true }).fill('Zoomtestets källa')
    const { captured, ids } = await capturePage.evaluate(async () => {
      const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
      await session.flush()
      const backup = await session.own()
      if (!backup) throw new Error('The CMS source was not captured')
      const about = backup.document.presentation.pages.find((page) => page.path === '/about')
      const ids = {}
      for (const lang of ['sv', 'en']) {
        const tree = new globalThis.DOMParser().parseFromString(
          about.content[lang].html,
          'text/html',
        )
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
    await fixtureRoutes(context, barbers)
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

    // The editor neither offers nor accepts the properties the marquee code owns, and neither a
    // selection nor a Style Manager read changes the draft. Every step records the status and
    // GrapesJS's own dirty count, which rises at once; Studio shows a change 180 ms later.
    const policyProbe = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { readCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
      const editor = cmsGrapes.editors.at(-1)
      const steps = []
      const changes = []
      let step = 'start'
      let droppedEvents = 0
      const rules = editor.Css.getAll()
      const read = () => ({ html: editor.getHtml({ cleanId: false }), css: readCanvasCss(editor) })
      const before = read()
      const changed = (event, model, property, options = {}) => {
        if (changes.length >= 64) {
          droppedEvents++
          return
        }
        changes.push({
          step,
          event,
          id: model.get('attributes')?.id,
          selector: model.selectorsToString?.(),
          media: model.get('mediaText'),
          property,
          style: model.get('style'),
          previousStyle: model.previous('style'),
          noCount: options.noCount,
          avoidStore: options.avoidStore,
        })
      }
      const onStyle = (model, property, options) =>
        changed('styleable:change', model, property, options)
      const onRule = (model, collection, options) => changed('rule:add', model, undefined, options)
      editor.on('styleable:change', onStyle)
      rules.on('add', onRule)
      const difference = (previous, next) => {
        if (previous === next) return null
        let offset = 0
        while (offset < previous.length && previous[offset] === next[offset]) offset++
        return {
          offset,
          beforeLength: previous.length,
          afterLength: next.length,
          before: previous.slice(Math.max(0, offset - 160), offset + 320),
          after: next.slice(Math.max(0, offset - 160), offset + 320),
        }
      }
      const record = (step) =>
        steps.push({
          step,
          status: globalThis.document.querySelector('.cms-status')?.textContent,
          dirty: editor.getDirtyCount(),
        })
      const tick = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))
      const offered = async (selector, sector, property) => {
        const target = editor.getWrapper().find(selector)[0]
        if (!target) throw new Error(`Missing ${selector}`)
        step = `select ${selector}`
        editor.select(target)
        // The Style Manager applies a new selection on its next tick.
        await tick(50)
        record(`select ${selector}`)
        const visible = editor.StyleManager.getProperty(sector, property)?.isVisible() ?? false
        record(`read ${sector} ${property}`)
        return visible
      }
      try {
        record('start')
        const policy = {
          trackTransform: await offered('[data-knc-fold="gallery-track"]', 'position', 'transform'),
          tileWidth: await offered('[data-knc-fold="gallery-tile"]', 'layout', 'width'),
          stripOverflow: await offered('[data-knc-fold="barber-marquee"]', 'layout', 'overflow'),
          stripWidth: await offered('[data-knc-fold="barber-marquee"]', 'layout', 'width'),
          stripHeight: await offered('[data-knc-fold="barber-marquee"]', 'layout', 'height'),
          textColor: await offered('[data-knc-fold="gallery-tile"]', 'typography', 'color'),
        }
        // Past Studio's change debounce, so a change any step made has reached the status.
        await tick(400)
        record('settled')
        const after = read()
        return {
          policy,
          steps,
          changes,
          droppedEvents,
          differences: {
            html: difference(before.html, after.html),
            css: difference(before.css, after.css),
          },
        }
      } finally {
        editor.off('styleable:change', onStyle)
        rules.off('add', onRule)
      }
    })
    // Every run keeps the steps, so a draft that turns dirty only sometimes leaves its trail.
    await test.info().attach('policy-probe-steps', {
      body: JSON.stringify(policyProbe.steps, null, 2),
      contentType: 'application/json',
    })
    await test.info().attach('policy-probe-model-changes', {
      body: JSON.stringify(
        {
          changes: policyProbe.changes,
          droppedEvents: policyProbe.droppedEvents,
          differences: policyProbe.differences,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
    assert.equal(
      policyProbe.steps.at(-1)?.status,
      'Publicerad · rev 2',
      `Selecting or reading the Style Manager changed the draft: ${JSON.stringify(policyProbe.steps)}`,
    )
    // The loop floor needs a strip width that does not follow its cards; its height stays the owner's.
    assert.deepEqual(policyProbe.policy, {
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

    // Backup: an unpublished local draft from before the fix is converted when Studio restores it. It
    // is written after the navigation and before the studio mounts, so the previous page can no longer
    // replace it; the studio then mounts over the same backup session and restores it as this tab's
    // own draft.
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(
      async (legacy) => {
        const { cmsApi } = await import('/src/admin/cms/api.ts')
        const { cmsBackups } = await import('/src/admin/cms/backup.ts')
        const head = await cmsApi.state()
        const session = await cmsBackups()
        session.schedule({
          document: legacy,
          revision: head.revision,
          fingerprint: head.fingerprint,
        })
        await session.flush()
      },
      withLegacyZoom(captured, ids, 'Om oss (backup)'),
    )
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await publish(page, 5)
    assert.equal(aboutPage(backend.document).title.sv, 'Om oss (backup)')
    assertCardWidths(backend.document, ids, 'Backup restore')

    // Public: the published strip keeps moving and never leaves more than two card gaps blank.
    const liveContext = await newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'no-preference',
    })
    await nativeBackend(liveContext, backend.document)
    await fixtureRoutes(liveContext, barbers)
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

  // When the selection changes, a GrapesJS color control commits the value it shows to the
  // Style Manager's current target, which still belongs to the former selection (InputColor,
  // grapesjs 0.23.6). CI run 41775521957 recorded `color:black;border:0 solid black` on the
  // gallery track when the selection moved to a tile: both color controls held their default
  // while the track's rule was empty. Step 1 repeats the policy probe's passive steps, whose
  // outcome depends on the browser's timer order. Step 2 sets both controls to the default they
  // show after rendering, over that rule, on every run.
  test('passive selection never writes what the color controls show into the published draft', async ({
    newContext,
  }) => {
    test.setTimeout(600_000)
    const captureContext = await newContext({ viewport: { width: 1440, height: 900 } })
    await nativeBackend(captureContext)
    await fixtureRoutes(captureContext, barbers)
    const capturePage = await captureContext.newPage()
    await mountStudio(capturePage)
    // Only owner edits create backups; the captured source alone is pristine.
    await capturePage
      .getByRole('textbox', { name: 'Namn', exact: true })
      .fill('Markeringstestets källa')
    const { captured, ids } = await capturePage.evaluate(async () => {
      const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
      await session.flush()
      const backup = await session.own()
      if (!backup) throw new Error('The CMS source was not captured')
      const about = backup.document.presentation.pages.find((page) => page.path === '/about')
      const ids = {}
      for (const lang of ['sv', 'en']) {
        const tree = new globalThis.DOMParser().parseFromString(
          about.content[lang].html,
          'text/html',
        )
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
    await fixtureRoutes(context, barbers)
    const page = await context.newPage()
    await mountStudio(page)
    // The Studio status and the canvas HTML and CSS that it exports.
    const canvas = () =>
      page.evaluate(async () => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const { readCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
        const editor = cmsGrapes.editors.at(-1)
        return {
          status: globalThis.document.querySelector('.cms-status')?.textContent,
          html: editor.getHtml({ cleanId: false }),
          css: readCanvasCss(editor),
        }
      })
    // The draft as the owner exports it.
    const exportDraft = async () => {
      await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
      const downloaded = page.waitForEvent('download')
      await page
        .getByRole('dialog', { name: 'Utkast & backup' })
        .getByRole('button', { name: 'Export', exact: true })
        .click()
      const stream = await (await downloaded).createReadStream()
      assert.ok(stream, 'The backup must be readable')
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      await page
        .getByRole('dialog', { name: 'Utkast & backup' })
        .getByRole('button', { name: 'Stäng panel', exact: true })
        .click()
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    const difference = (previous, next) => {
      if (previous === next) return null
      let offset = 0
      while (offset < previous.length && previous[offset] === next[offset]) offset++
      return {
        offset,
        beforeLength: previous.length,
        afterLength: next.length,
        before: previous.slice(Math.max(0, offset - 160), offset + 320),
        after: next.slice(Math.max(0, offset - 160), offset + 320),
      }
    }
    const stages = []
    const record = async (stage) => {
      const current = { stage, ...(await canvas()), draft: await exportDraft() }
      stages.push({ stage: current.stage, status: current.status })
      return current
    }

    // Load: the stored legacy zoom opens as an unpublished width-form draft.
    await page
      .locator('.cms-status')
      .filter({ hasText: /^(Opublicerade ändringar|Publicerad · rev 1)$/ })
      .waitFor()
    const loaded = await record('load')
    assert.equal(loaded.status, 'Opublicerade ändringar', 'Load kept the stored legacy zoom')
    await publish(page, 2)
    const published = await record('publish')
    assert.equal(published.status, 'Publicerad · rev 2')
    const assertUnchanged = async (stage) => {
      const current = await record(stage)
      await test.info().attach(`${stage}-stages`, {
        body: JSON.stringify(stages, null, 2),
        contentType: 'application/json',
      })
      const differences = {
        html: difference(published.html, current.html),
        css: difference(published.css, current.css),
      }
      assert.deepEqual(
        differences,
        { html: null, css: null },
        `${stage} changed the exported canvas: ${JSON.stringify(differences)}`,
      )
      assert.equal(current.status, 'Publicerad · rev 2', `${stage} changed the draft status`)
      assert.deepEqual(current.draft, published.draft, `${stage} changed the exported draft`)
    }

    // 1. The selections and Style Manager reads of the policy probe above, at its pace.
    const natural = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      const tick = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))
      const steps = []
      for (const [selector, sector, property] of [
        ['[data-knc-fold="gallery-track"]', 'position', 'transform'],
        ['[data-knc-fold="gallery-tile"]', 'layout', 'width'],
        ['[data-knc-fold="barber-marquee"]', 'layout', 'overflow'],
        ['[data-knc-fold="barber-marquee"]', 'layout', 'width'],
        ['[data-knc-fold="barber-marquee"]', 'layout', 'height'],
        ['[data-knc-fold="gallery-tile"]', 'typography', 'color'],
      ]) {
        const target = editor.getWrapper().find(selector)[0]
        if (!target) throw new Error(`Missing ${selector}`)
        editor.select(target)
        // The Style Manager applies a new selection on its next tick.
        await tick(50)
        steps.push({
          selector,
          property,
          visible: editor.StyleManager.getProperty(sector, property)?.isVisible() ?? false,
          dirty: editor.getDirtyCount(),
        })
      }
      // Past Studio's change debounce, so a change any step made has reached the status.
      await tick(400)
      return steps
    })
    await test.info().attach('passive-steps', {
      body: JSON.stringify(natural, null, 2),
      contentType: 'application/json',
    })
    await assertUnchanged('Passive selection')

    // 2. Both color controls show their default over the gallery track's empty rule, then the
    // selection moves to a gallery tile. The controls the Studio mounted keep their place among
    // the selection listeners.
    const controlled = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      const tick = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))
      const [track] = editor.getWrapper().find('[data-knc-fold="gallery-track"]')
      const [tile] = editor.getWrapper().find('[data-knc-fold="gallery-tile"]')
      if (!track || !tile) throw new Error('The gallery is missing')
      const styles = editor.StyleManager
      const color = styles.getProperty('typography', 'color')
      const borderColor = styles
        .getProperty('surface', 'border')
        ?.getProperties()
        .find((property) => property.getName() === 'border-color')
      if (!color?.view || !borderColor?.view) throw new Error('The color controls are missing')
      const shown = (property) =>
        globalThis.document.querySelector(`#cms-styles .gjs-sm-property__${property} input`)?.value
      const state = () => ({
        target: styles.getSelected()?.selectorsToString(),
        stored: color.hasValue(),
        color: shown('color'),
        borderColor: shown('border-color'),
      })
      editor.select(track)
      await tick(50)
      const settled = state()
      // As PropertyView.render does: the control shows the value, or the default without one.
      for (const property of [color, borderColor]) property.view.setValue(property.getValue())
      const stale = state()
      editor.select(tile)
      await tick(400)
      return { track: track.getId(), tile: tile.getId(), settled, stale }
    })
    await test.info().attach('controlled-state', {
      body: JSON.stringify(controlled, null, 2),
      contentType: 'application/json',
    })
    const target = `#${controlled.track}`
    assert.deepEqual(
      { target: controlled.settled.target, stored: controlled.settled.stored },
      { target, stored: false },
      `The Style Manager does not target the empty track rule: ${JSON.stringify(controlled)}`,
    )
    assert.deepEqual(
      controlled.stale,
      { target, stored: false, color: 'black', borderColor: 'black' },
      `The color controls do not show their defaults over the track rule: ${JSON.stringify(controlled)}`,
    )
    await assertUnchanged('Selecting a tile after the color controls showed their defaults')

    // 3. Control: a real color edit in the inspector changes the selected tile's own rule.
    const colorsOf = () =>
      page.evaluate(async (ids) => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        const of = (id) =>
          editor.Css.getAll()
            .filter((rule) => rule.selectorsToString() === `#${id}`)
            .map((rule) => String(rule.getStyle().color ?? '').replace(/\s*!important$/i, ''))
            .filter(Boolean)
        return { track: of(ids.track), tile: of(ids.tile) }
      }, controlled)
    const uncolored = await colorsOf()
    const colorField = page.locator('#cms-inspector .gjs-sm-property__color input').first()
    await colorField.fill('#123456')
    await colorField.press('Enter')
    await colorField.press('Tab')
    await page.getByText('Opublicerade ändringar', { exact: true }).waitFor()
    const colored = await colorsOf()
    const evidence = JSON.stringify({ uncolored, colored })
    assert.deepEqual(
      colored.track,
      uncolored.track,
      `The color edit reached the former selection: ${evidence}`,
    )
    assert.deepEqual(
      colored.tile.filter((value) => !uncolored.tile.includes(value)),
      ['#123456'],
      `The color edit did not reach the selected tile: ${evidence}`,
    )
    await publish(page, 3)
    assert.ok(
      JSON.stringify(backend.document.presentation.pages).includes('#123456'),
      'The published draft lost the inspector color',
    )
  })

  // The GrapesJS UndoManager tracks the selection (trackSelection, grapesjs 0.23.6). Its undo and
  // redo edit the selected collection directly, so they emit component:selected, and with it the
  // color commit, without component:select:before. Ångra and Gör om step through draft snapshots
  // and never change the selection; the GrapesJS ⌘Z and Ctrl+Z keymaps run the same UndoManager
  // calls, but only while focus rests on the Studio or canvas body. Like the tile selection, each
  // undo and redo starts with both color controls showing their defaults over the empty rule
  // that it leaves.
  test('undoing and redoing a selection never writes what the color controls show into the published draft', async ({
    newContext,
  }) => {
    test.setTimeout(600_000)
    const captureContext = await newContext({ viewport: { width: 1440, height: 900 } })
    await nativeBackend(captureContext)
    await fixtureRoutes(captureContext, barbers)
    const capturePage = await captureContext.newPage()
    await mountStudio(capturePage)
    // Only owner edits create backups; the captured source alone is pristine.
    await capturePage.getByRole('textbox', { name: 'Namn', exact: true }).fill('Ångratestets källa')
    const { captured, ids } = await capturePage.evaluate(async () => {
      const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
      await session.flush()
      const backup = await session.own()
      if (!backup) throw new Error('The CMS source was not captured')
      const about = backup.document.presentation.pages.find((page) => page.path === '/about')
      const ids = {}
      for (const lang of ['sv', 'en']) {
        const tree = new globalThis.DOMParser().parseFromString(
          about.content[lang].html,
          'text/html',
        )
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
    await fixtureRoutes(context, barbers)
    const page = await context.newPage()
    await mountStudio(page)
    // The Studio status and the canvas HTML and CSS that it exports.
    const canvas = () =>
      page.evaluate(async () => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const { readCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
        const editor = cmsGrapes.editors.at(-1)
        return {
          status: globalThis.document.querySelector('.cms-status')?.textContent,
          html: editor.getHtml({ cleanId: false }),
          css: readCanvasCss(editor),
        }
      })
    // The draft as the owner exports it.
    const exportDraft = async () => {
      await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
      const downloaded = page.waitForEvent('download')
      await page
        .getByRole('dialog', { name: 'Utkast & backup' })
        .getByRole('button', { name: 'Export', exact: true })
        .click()
      const stream = await (await downloaded).createReadStream()
      assert.ok(stream, 'The backup must be readable')
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      await page
        .getByRole('dialog', { name: 'Utkast & backup' })
        .getByRole('button', { name: 'Stäng panel', exact: true })
        .click()
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    const difference = (previous, next) => {
      if (previous === next) return null
      let offset = 0
      while (offset < previous.length && previous[offset] === next[offset]) offset++
      return {
        offset,
        beforeLength: previous.length,
        afterLength: next.length,
        before: previous.slice(Math.max(0, offset - 160), offset + 320),
        after: next.slice(Math.max(0, offset - 160), offset + 320),
      }
    }
    const record = async () => ({ ...(await canvas()), draft: await exportDraft() })

    // Load: the stored legacy zoom opens as an unpublished width-form draft.
    await page
      .locator('.cms-status')
      .filter({ hasText: /^(Opublicerade ändringar|Publicerad · rev 1)$/ })
      .waitFor()
    const loaded = await record()
    assert.equal(loaded.status, 'Opublicerade ändringar', 'Load kept the stored legacy zoom')
    await publish(page, 2)
    const published = await record()
    assert.equal(published.status, 'Publicerad · rev 2')

    // Step 2's setup over the track, the tile selection, then its undo and redo. The canvas CSS
    // is read after each selection change.
    const history = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { readCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
      const editor = cmsGrapes.editors.at(-1)
      const tick = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))
      const [track] = editor.getWrapper().find('[data-knc-fold="gallery-track"]')
      const [tile] = editor.getWrapper().find('[data-knc-fold="gallery-tile"]')
      if (!track || !tile) throw new Error('The gallery is missing')
      const styles = editor.StyleManager
      const color = styles.getProperty('typography', 'color')
      const borderColor = styles
        .getProperty('surface', 'border')
        ?.getProperties()
        .find((property) => property.getName() === 'border-color')
      if (!color?.view || !borderColor?.view) throw new Error('The color controls are missing')
      const shown = (property) =>
        globalThis.document.querySelector(`#cms-styles .gjs-sm-property__${property} input`)?.value
      // As PropertyView.render does: each control shows its value, or the default without one.
      const showDefaults = () => {
        for (const property of [color, borderColor]) property.view.setValue(property.getValue())
        return {
          selected: editor.getSelected()?.getId(),
          target: styles.getSelected()?.selectorsToString(),
          stored: [color, borderColor].some((property) => property.hasValue()),
          color: shown('color'),
          borderColor: shown('border-color'),
        }
      }
      editor.select(track)
      await tick(50)
      const overTrack = showDefaults()
      editor.select(tile)
      await tick(50)
      const selectedCss = readCanvasCss(editor)
      const overTile = showDefaults()
      editor.UndoManager.undo()
      await tick(50)
      const undoneCss = readCanvasCss(editor)
      const undone = showDefaults()
      editor.UndoManager.redo()
      await tick(400)
      return {
        track: track.getId(),
        tile: tile.getId(),
        states: { overTrack, overTile, undone, redone: editor.getSelected()?.getId() },
        css: { selected: selectedCss, undone: undoneCss, redone: readCanvasCss(editor) },
      }
    })
    await test.info().attach('history-state', {
      body: JSON.stringify(
        { track: history.track, tile: history.tile, ...history.states },
        null,
        2,
      ),
      contentType: 'application/json',
    })
    const evidence = JSON.stringify(history.states)
    const defaultsOver = (id) => ({
      selected: id,
      target: `#${id}`,
      stored: false,
      color: 'black',
      borderColor: 'black',
    })
    const assertCss = (stage, css) => {
      const changed = difference(published.css, css)
      assert.equal(
        changed,
        null,
        `${stage} changed the exported canvas: ${JSON.stringify(changed)}`,
      )
    }
    assert.deepEqual(
      history.states.overTrack,
      defaultsOver(history.track),
      `The color controls do not show their defaults over the track rule: ${evidence}`,
    )
    assertCss('Selecting the tile', history.css.selected)
    assert.deepEqual(
      history.states.overTile,
      defaultsOver(history.tile),
      `The color controls do not show their defaults over the tile rule: ${evidence}`,
    )
    // Each leg first proves that the selection moved, so a CSS change belongs to its commit.
    assert.deepEqual(
      history.states.undone,
      defaultsOver(history.track),
      `Undo did not return the selection to the track with its defaults shown: ${evidence}`,
    )
    assertCss('Undoing the tile selection', history.css.undone)
    assert.equal(
      history.states.redone,
      history.tile,
      `Redo did not return the selection to the tile: ${evidence}`,
    )
    assertCss('Redoing the tile selection', history.css.redone)
    const settled = await record()
    const differences = {
      html: difference(published.html, settled.html),
      css: difference(published.css, settled.css),
    }
    assert.deepEqual(
      differences,
      { html: null, css: null },
      `Undo and redo changed the exported canvas: ${JSON.stringify(differences)}`,
    )
    assert.equal(settled.status, 'Publicerad · rev 2', 'Undo and redo changed the draft status')
    assert.deepEqual(settled.draft, published.draft, 'Undo and redo changed the exported draft')

    // A real color edit in the inspector still changes only the selected tile's own rule.
    const colorsOf = () =>
      page.evaluate(
        async (ids) => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const editor = cmsGrapes.editors.at(-1)
          const of = (id) =>
            editor.Css.getAll()
              .filter((rule) => rule.selectorsToString() === `#${id}`)
              .map((rule) => String(rule.getStyle().color ?? '').replace(/\s*!important$/i, ''))
              .filter(Boolean)
          return { track: of(ids.track), tile: of(ids.tile) }
        },
        { track: history.track, tile: history.tile },
      )
    const uncolored = await colorsOf()
    const colorField = page.locator('#cms-inspector .gjs-sm-property__color input').first()
    await colorField.fill('#123456')
    await colorField.press('Enter')
    await colorField.press('Tab')
    await page.getByText('Opublicerade ändringar', { exact: true }).waitFor()
    const colored = await colorsOf()
    const colors = JSON.stringify({ uncolored, colored })
    assert.deepEqual(
      colored.track,
      uncolored.track,
      `The color edit reached the former selection: ${colors}`,
    )
    assert.deepEqual(
      colored.tile.filter((value) => !uncolored.tile.includes(value)),
      ['#123456'],
      `The color edit did not reach the selected tile: ${colors}`,
    )
    await publish(page, 3)
    assert.ok(
      JSON.stringify(backend.document.presentation.pages).includes('#123456'),
      'The published draft lost the inspector color',
    )
  })
})
test.describe('source adoption', () => {
  // Paths that cms-marquee-zoom.spec.mjs does not reach: the asynchronous source upgrade of a stored
  // About page without strip markers, undo after a conflict resolution, and `all` in Avancerad CSS.

  const barbers = ['A', 'B', 'C', 'D'].map((name, index) =>
    barberFixture({
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
    }),
  )

  // In production every gallery photo is a registered library file, and the captured About markup
  // references their storage URLs, so the first publication needs them in the registry.
  const galleryAssets = gallery.map((item, index) =>
    assetFixture({
      id: `6a000000-0000-4000-8000-00000000000${index + 1}`,
      bucket: 'gallery',
      path: item.storage_path,
      name: item.storage_path.split('/').at(-1),
      alt: item.alt,
      mime: 'image/png',
      width: 1,
      height: 1,
      bytes: 1,
      archived: false,
      version: 0,
    }),
  )

  /** The source-captured site as Studio publishes it, with the strip identities of each language. */
  async function capturedSite(newContext) {
    const context = await newContext({ viewport: { width: 1440, height: 900 } })
    const backend = await nativeBackend(context, undefined, galleryAssets)
    await fixtureRoutes(context, barbers)
    const page = await context.newPage()
    await mountStudio(page)
    await publish(page, 2)
    const captured = globalThis.structuredClone(backend.document)
    const ids = await page.evaluate((about) => {
      const ids = {}
      for (const lang of ['sv', 'en']) {
        const tree = new globalThis.DOMParser().parseFromString(
          about.content[lang].html,
          'text/html',
        )
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
    await fixtureRoutes(context, barbers)
    const page = await context.newPage()
    await mountStudio(page)
    // The upgrade makes the draft dirty only after the source capture finished.
    await publish(page, 2)
    assert.equal(aboutPage(backend.document).title.sv, 'Om oss (utan markör)')
    assertCardWidths(backend.document, ids, 'Source upgrade')
    // The upgrade was a migration, not an edit: Ångra has no markerless, zoomed snapshot to return to.
    await page.getByRole('button', { name: 'Ångra', exact: true }).click()
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
        ),
    )
    if ((await page.locator('.cms-status').textContent()) !== 'Publicerad · rev 2')
      await publish(page, 3)
    for (const lang of ['sv', 'en'])
      assert.ok(
        aboutPage(backend.document).content[lang].html.includes('data-knc-fold="barber-marquee"'),
        `${lang} lost the strip marker after Ångra`,
      )
    assertCardWidths(backend.document, ids, 'Source upgrade, Ångra')
    assert.equal(
      await page.locator('.cms-status').textContent(),
      'Publicerad · rev 2',
      'Ångra returned to the unmigrated snapshot',
    )
  })

  test('undo after a conflict resolution never returns to the raw legacy zoom', async ({
    newContext,
  }) => {
    test.setTimeout(300_000)
    const { captured, ids } = await capturedSite(newContext)
    const context = await newContext({ viewport: { width: 1440, height: 900 } })
    context.setDefaultTimeout(15000)
    const backend = await nativeBackend(context, withLegacyZoom(captured, ids, 'Om oss (rev 1)'))
    await fixtureRoutes(context, barbers)
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

  test('Avancerad CSS rejects all on the marquee nodes in the real CSSOM', async ({
    newContext,
  }) => {
    test.setTimeout(300_000)
    const context = await newContext({ viewport: { width: 1440, height: 900 } })
    context.setDefaultTimeout(15000)
    const backend = await nativeBackend(context)
    await fixtureRoutes(context, barbers)
    const page = await context.newPage()
    await mountStudio(page)
    const advanced = page.locator('#cms-inspector .cms-advanced')
    const rejection = page.getByRole('alert').filter({
      hasText: 'CSS-egenskapen all styrs av den rörliga karusellen och kan inte ändras här.',
    })
    for (const selector of [
      '[data-knc-fold="barber-marquee"]',
      '[data-knc-fold="barber-marquee"] > [data-knc-source]',
      '[data-knc-fold="gallery-tile"]',
    ])
      for (const value of ['initial', 'unset', 'revert']) {
        await page.evaluate(async (selector) => {
          const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
          const editor = cmsGrapes.editors.at(-1)
          const target = editor.getWrapper().find(selector)[0]
          if (!target) throw new Error(`Missing ${selector}`)
          editor.select(target)
        }, selector)
        if ((await advanced.getAttribute('open')) === null)
          await advanced.locator('summary').click()
        await advanced.getByLabel('Egenskap', { exact: true }).fill('all')
        await advanced.getByLabel('Värde', { exact: true }).fill(value)
        await advanced.getByRole('button', { name: 'Tillämpa', exact: true }).click()
        // Chromium keeps all as one CSSOM entry; WebKit expands it. Both must name all itself.
        await rejection.waitFor()
        await rejection.getByRole('button', { name: 'Stäng', exact: true }).click()
        await rejection.waitFor({ state: 'detached' })
      }
    assert.equal(backend.writes.length, 0, 'A rejected declaration was published')
  })
})
