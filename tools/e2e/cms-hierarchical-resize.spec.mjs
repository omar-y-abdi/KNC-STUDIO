import { barberFixture, documentFixture } from './builders.mjs'
import { routeApi } from './route-api.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { generate, parse, walk } from 'css-tree'
import { nativeBackend } from './cms-backend.mjs'
import { minLoopScale } from '../../src/admin/cms/hierarchicalResize.ts'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
test.use({
  viewport: { width: 1440, height: 1000 },
  contextOptions: { reducedMotion: 'reduce' },
})
const groupSelector = '[data-knc-fold="barber-marquee"][data-knc-source]'

const select = (page, selector) =>
  page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const target = editor.getWrapper().find(selector)[0]
    if (!target) throw new Error(`Missing target ${selector}`)
    editor.select(target)
  }, selector)
const measure = (frame) =>
  frame.locator(groupSelector).evaluate((group) => {
    const rect = (node) => {
      const r = node.getBoundingClientRect()
      return { width: r.width, height: r.height, bottom: r.bottom, top: r.top }
    }
    const cards = [...group.children]
    return {
      group: rect(group),
      cards: cards.map((card) => ({
        id: card.id,
        rect: rect(card),
        // Embla positions slides by offsetWidth; zoom changes only the painted rect.
        layoutWidth: card.offsetWidth,
        photo: rect(
          card.querySelector('img') ??
            card.querySelector('[data-knc-surface]') ??
            card.firstElementChild,
        ),
        text: card.textContent,
      })),
      next: rect(group.nextElementSibling),
    }
  })
const intrinsicGeometry = (frame, factor = 1) =>
  frame.locator(groupSelector).evaluate((group, factor) => {
    const cards = [...group.children]
    const view = group.ownerDocument.defaultView
    const original = cards.map((card) => card.getAttribute('style'))
    const zoom = (card) => {
      const value = view.getComputedStyle(card).zoom
      return (parseFloat(value) || 1) / (value.endsWith('%') ? 100 : 1)
    }
    try {
      if (factor !== 1)
        for (const card of cards)
          card.style.setProperty('zoom', String(zoom(card) * factor), 'important')
      return cards.map((card) => {
        const photo =
          card.querySelector('img') ??
          card.querySelector('[data-knc-surface]') ??
          card.firstElementChild
        const description = card.querySelector('p')
        if (!description) throw new Error('The intrinsic card description is missing')
        return {
          width: card.getBoundingClientRect().width,
          photoHeight: photo.getBoundingClientRect().height,
          zoom: zoom(card),
          fontSize: parseFloat(view.getComputedStyle(description).fontSize),
          sourceFont: description.getAttribute('data-knc-light'),
        }
      })
    } finally {
      if (factor !== 1)
        for (const [index, card] of cards.entries()) {
          if (original[index] === null) card.removeAttribute('style')
          else card.setAttribute('style', original[index])
        }
    }
  }, factor)
const inspectGeometry = (page) =>
  page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const group = editor.getWrapper().find(selector)[0]?.getEl()
    const card = group?.firstElementChild
    const photo =
      card?.querySelector('img') ??
      card?.querySelector('[data-knc-surface]') ??
      card?.firstElementChild
    const properties = [
      'display',
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'box-sizing',
      'aspect-ratio',
      'zoom',
      'flex',
      'align-self',
      'align-items',
      'gap',
      'padding',
      'margin-left',
      'margin-right',
      'justify-self',
      'justify-items',
      'border-width',
      'grid-template-columns',
      'grid-template-rows',
    ]
    const nodes = [group, card, photo, photo?.firstElementChild].filter(Boolean)
    return {
      device: editor.getDevice(),
      mediaCondition: editor.getConfig().mediaCondition,
      nodes: nodes.map((node) => {
        const view = node.ownerDocument.defaultView
        const style = view.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const rules = editor.Css.getAll().filter((rule) =>
          rule.getSelectors().some((item) => item.get('name') === node.id),
        )
        return {
          tag: node.localName,
          id: node.id,
          slot: node.getAttribute('data-knc-slot'),
          inline: node.getAttribute('style'),
          rect: { width: rect.width, height: rect.height },
          offset: { width: node.offsetWidth, height: node.offsetHeight },
          computed: Object.fromEntries(
            properties.map((property) => [property, style.getPropertyValue(property)]),
          ),
          rules: rules.slice(-8).map((rule) => ({
            selector: rule.selectorsToString(),
            media: rule.get('mediaText'),
            style: JSON.parse(JSON.stringify(rule.toJSON().style ?? {})),
          })),
        }
      }),
    }
  }, groupSelector)
const height = async (page, value) => {
  const input = page.locator('#cms-inspector .gjs-sm-property__height input').first()
  await input.fill(String(Math.round(value)))
  await input.press('Enter')
  await input.press('Tab')
}

/** The Studio harness with the given active barbers on the published About page. A `stored`
 * document is published as it is, apart from its barbers. */
async function openStudio(page, context, ids, stored = documentFixture()) {
  const base = harnessOrigin
  assert.equal(new URL(base).hostname, '127.0.0.1')
  context.setDefaultTimeout(10000)
  const seed = globalThis.structuredClone(stored)
  seed.barbers = ids.map((id, i) =>
    barberFixture({
      id,
      name: `Barber ${id}`,
      ig: id,
      role_sv: 'Frisör',
      role_en: 'Barber',
      bio_sv: 'Presentation',
      bio_en: 'Presentation',
      sort_order: i,
    }),
  )
  const backend = await nativeBackend(context, seed)
  await routeApi(context, [
    [
      'https://admin-harness.invalid/rest/v1/rpc/public_*',
      async (route, headers) => {
        return route.fulfill({
          headers,
          json: {
            settings: {},
            barbers: seed.barbers.map((b) => ({ ...b, active: true, photo_path: null })),
            services: [],
            schedules: [],
          },
        })
      },
    ],
  ])
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  const frame = page.frameLocator('.gjs-frame').first()
  await frame.locator(groupSelector).waitFor({ timeout: 90000 })
  return { backend, frame }
}

test('cms-hierarchical-resize', async ({ page, context, browserName, evidenceDir }) => {
  const engine = browserName
  const out = evidenceDir
  await mkdir(out, { recursive: true })
  await page.clock.setSystemTime(Date.now())
  const { backend, frame } = await openStudio(page, context, ['a', 'b', 'c', 'd'])
  // Mobile cards are Embla slides: a resize gives each card the requested layout width.
  const assertCardScale = (cards, reference, scale, message) => {
    for (const [index, card] of cards.entries()) {
      assert.ok(
        Math.abs(card.rect.width / reference[index].rect.width - scale) < 0.02,
        `${message}: card ${index} is ${card.rect.width}px wide`,
      )
      assert.ok(
        Math.abs(card.layoutWidth - card.rect.width) < 1,
        `${message}: card ${index} lays out ${card.layoutWidth}px but paints ${card.rect.width}px`,
      )
    }
  }
  const desktop = await measure(frame)
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  await page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    for (const card of editor.getWrapper().find(selector)[0].components()) {
      const rule = editor.Css.getIdRule(card.getId()) ?? editor.Css.setIdRule(card.getId(), {})
      rule.addStyle({
        '@supports(display:grid)': { '&.owner-inactive': { color: 'var(--owner-mobile-color)' } },
      })
    }
  }, groupSelector)
  // Commit the owner fixture separately so the following resize's undo keeps its source.
  await page.getByRole('button', { name: 'Dator', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 1440,
  )
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  const ownerBlocks = () =>
    page.evaluate(async (selector) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { readCanvasRuleCss } = await import('/src/admin/cms/nativeCanvas.ts')
      const editor = cmsGrapes.editors.at(-1)
      const ids = new Set(
        editor
          .getWrapper()
          .find(selector)[0]
          .components()
          .map((card) => card.getId()),
      )
      // The Home preview can mirror these blocks under preview-shared IDs after
      // an import. Count the editable cards' rules, including any real duplicates.
      const css = editor.Css.getAll()
        .filter(
          (rule) =>
            !rule.isNested() && rule.getSelectors().some((item) => ids.has(item.get('name'))),
        )
        .map((rule) => readCanvasRuleCss(rule))
        .join('')
      return css.match(/color:var\(--owner-mobile-color\)/g)?.length ?? 0
    }, groupSelector)
  assert.equal(await ownerBlocks(), 4, 'Mobile owner blocks survive viewport import')
  // The Dator switch flushed the owner fixture. Cross the draft's 800 ms grouping boundary
  // so the group resize starts its own undo step.
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 1000)
  const before = await measure(frame)
  assert.equal(before.cards.length, 4)
  await select(page, groupSelector)
  await height(page, before.group.height / 2)
  const after = await measure(frame)
  await writeFile(
    `${out}/${engine}-geometry.json`,
    JSON.stringify({ desktop, before, after }, null, 2),
  )
  await frame.locator(groupSelector).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${out}/${engine}-resize.png` })
  assert.ok(
    Math.abs(after.cards[0].photo.height / before.cards[0].photo.height - 0.5) < 0.08,
    'Group resize must scale its photographs, not crop them',
  )
  assertCardScale(after.cards, before.cards, 0.5, 'Group resize')
  assert.equal(await ownerBlocks(), 4, 'Mobile group resize preserves nested owner CSS')
  assert.ok(
    after.next.top >= Math.max(...after.cards.map((card) => card.rect.bottom)) - 2,
    'Following content may not overlap cards',
  )
  assert.deepEqual(
    after.cards.map((card) => card.text),
    before.cards.map((card) => card.text),
  )
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  const undone = await measure(frame)
  assert.ok(
    Math.abs(undone.cards[0].photo.height - before.cards[0].photo.height) < 2,
    'Undo restores nested geometry',
  )
  await select(page, `${groupSelector} > div:first-child`)
  await height(page, before.cards[0].rect.height * 0.75)
  const linked = await measure(frame)
  assertCardScale(linked.cards, before.cards, 0.75, 'Card resize')
  assert.equal(await ownerBlocks(), 4, 'Mobile card resize preserves nested owner CSS')
  assert.ok(
    linked.cards.every((card) => Math.abs(card.rect.height - linked.cards[0].rect.height) < 2),
    'Every corresponding barber card shares its size',
  )
  assert.ok(
    linked.cards[0].photo.height < before.cards[0].photo.height * 0.85,
    'Individual card resize also scales the portrait',
  )
  assert.deepEqual(
    linked.cards.map((card) => card.text),
    before.cards.map((card) => card.text),
    'Linked styles never copy names or text',
  )
  await page.getByRole('button', { name: 'Dator', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 1440,
  )
  const desktopAgain = await measure(frame)
  await writeFile(
    `${out}/${engine}-desktop-roundtrip.json`,
    JSON.stringify({ desktop, desktopAgain }, null, 2),
  )
  assert.ok(
    Math.abs(desktopAgain.cards[0].photo.height - desktop.cards[0].photo.height) < 2,
    'Mobile scaling never changes desktop geometry',
  )
  assert.equal(backend.writes.length, 0, 'Geometry inspection does not publish')
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  const assertRetainedScale = async (stage) => {
    const actual = await measure(frame)
    assert.ok(
      Math.abs(actual.cards[0].photo.height - linked.cards[0].photo.height) < 2,
      `${stage}: the rendered portrait retains its authored scale`,
    )
    assert.deepEqual(
      actual.cards.map((card) => card.text),
      linked.cards.map((card) => card.text),
    )
  }
  await assertRetainedScale('Device roundtrip')
  await page.getByRole('button', { name: 'Mörk', exact: true }).click()
  await assertRetainedScale('Dark theme')
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor({ timeout: 15000 })
  // The published card width must outrank the runtime's inline mobile width and flex basis.
  const about = backend.document.presentation.pages.find((item) => item.path === '/about')
  const cardIds = new Set(linked.cards.map((card) => card.id))
  for (const mode of ['light', 'dark']) {
    const sized = new Map()
    walk(parse(about.content.sv.css[mode]), {
      visit: 'Declaration',
      enter(declaration) {
        const id = this.rule ? generate(this.rule.prelude).replace(/^#/, '') : ''
        if (!cardIds.has(id)) return
        assert.notEqual(declaration.property, 'zoom', `${mode}: #${id} is still zoomed`)
        if (
          this.atrule &&
          generate(this.atrule.prelude) === '(max-width:768px)' &&
          ['width', 'flex-basis'].includes(declaration.property)
        )
          sized.set(`${id} ${declaration.property}`, {
            value: generate(declaration.value),
            important: declaration.important,
          })
      },
    })
    for (const id of cardIds)
      for (const property of ['width', 'flex-basis']) {
        const declaration = sized.get(`${id} ${property}`)
        const scale = Number(/^calc\(\(100vw - 24px\)\*([0-9.]+)\)$/.exec(declaration?.value)?.[1])
        assert.ok(
          Math.abs(scale - 0.75) < 0.02 && declaration.important === true,
          `${mode}: #${id} publishes ${property} ${JSON.stringify(declaration)}`,
        )
      }
  }
  await page.reload()
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await frame.locator(groupSelector).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  await assertRetainedScale('Published reload')
  console.log(
    'PASS hierarchical resize: nested geometry, peers, undo, devices, themes and published reload',
  )
})

test('cms-hierarchical-resize: two barbers keep their loop width', async ({
  page,
  context,
  evidenceDir,
}) => {
  await mkdir(evidenceDir, { recursive: true })
  const { backend, frame } = await openStudio(page, context, ['a', 'b'])
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  const before = await measure(frame)
  assert.equal(before.cards.length, 2)
  await select(page, groupSelector)
  await height(page, before.group.height / 2)
  const after = await measure(frame)
  await writeFile(`${evidenceDir}/two-barbers.json`, JSON.stringify({ before, after }, null, 2))
  // Half-width cards would end Embla's loop and freeze the public strip.
  for (const [index, card] of after.cards.entries())
    assert.ok(
      card.layoutWidth >= before.cards[index].layoutWidth * minLoopScale(2) - 1,
      `Card ${index} shrank to ${card.layoutWidth}px of ${before.cards[index].layoutWidth}px`,
    )
  assert.equal(backend.writes.length, 0, 'Geometry inspection does not publish')
})

test('cms-hierarchical-resize: narrow Desktop saves the Desktop rule and no viewport state', async ({
  page,
  context,
}) => {
  const { backend, frame } = await openStudio(page, context, ['a', 'b', 'c', 'd'])
  const viewport = (width) =>
    page.waitForFunction(
      (width) =>
        globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === width,
      width,
    )
  const exportBytes = async () => {
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
    return Buffer.concat(chunks).toString('utf8')
  }
  const narrow = page.getByRole('button', { name: 'Smal dator', exact: true })
  const untouched = await exportBytes()
  // Keep the selection across both viewport changes; a new selection would hide a stale snapshot.
  await select(page, groupSelector)
  await narrow.click()
  await viewport(820)
  assert.equal(await narrow.getAttribute('aria-pressed'), 'true')
  assert.equal(await exportBytes(), untouched, 'Narrow preview cannot create a saved style rule')
  const before = await measure(frame)
  const beforeDetails = await inspectGeometry(page)
  await height(page, before.group.height * 0.8)
  const after = await measure(frame)
  const afterDetails = await inspectGeometry(page)
  await test.info().attach('narrow-desktop-geometry', {
    body: JSON.stringify({ before, after, beforeDetails, afterDetails }, null, 2),
    contentType: 'application/json',
  })
  assert.ok(
    Math.abs(after.cards[0].photo.height / before.cards[0].photo.height - 0.8) < 0.05,
    `Narrow Desktop portrait scale: ${JSON.stringify({ before, after })}`,
  )
  for (const property of ['box-sizing', 'align-self', 'padding'])
    assert.equal(
      afterDetails.nodes[1].computed[property],
      beforeDetails.nodes[1].computed[property],
      `Resizing must preserve the card's ${property}`,
    )
  let saved = await exportBytes()
  await narrow.click()
  await viewport(1440)
  assert.equal(await exportBytes(), saved, 'Leaving narrow preview cannot change saved bytes')
  const wideBefore = await measure(frame)
  await height(page, wideBefore.group.height * 0.75)
  const wideAfter = await measure(frame)
  assert.ok(
    Math.abs(wideAfter.cards[0].photo.height / wideBefore.cards[0].photo.height - 0.75) < 0.05,
    `Wide Desktop portrait scale: ${JSON.stringify({ before: wideBefore, after: wideAfter })}`,
  )
  saved = await exportBytes()
  await narrow.click()
  await viewport(820)
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await viewport(390)
  assert.equal(await narrow.count(), 0, 'Narrow Desktop is unreachable in Mobile mode')
  assert.equal(await exportBytes(), saved, 'Mobile preview cannot change saved bytes')
  await page.getByRole('button', { name: 'Dator', exact: true }).click()
  await viewport(1440)
  assert.equal(await narrow.getAttribute('aria-pressed'), 'false')
  await narrow.click()
  await viewport(820)
  assert.equal(await exportBytes(), saved)
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor({ timeout: 15000 })
  const about = backend.document.presentation.pages.find((item) => item.path === '/about')
  for (const mode of ['light', 'dark']) {
    let desktopZoom = false
    walk(parse(about.content.sv.css[mode]), {
      visit: 'Rule',
      enter(rule) {
        if (generate(rule.prelude) !== `#${after.cards[0].id}`) return
        for (const declaration of rule.block.children)
          if (declaration.type === 'Declaration' && declaration.property === 'zoom') {
            assert.equal(generate(this.atrule.prelude), '(min-width:769px)')
            desktopZoom = true
          }
      },
    })
    assert.ok(desktopZoom, `${mode}: resizing at 820px must save Desktop geometry`)
  }
  await page.setViewportSize({ width: 320, height: 844 })
  assert.ok(await narrow.isVisible(), 'Narrow Desktop remains reachable in a compact workspace')
  assert.ok(
    await page
      .locator('.cms-canvas-toolbar')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    'The extra preview control must fit the compact toolbar',
  )
})

for (const [label, authored] of [
  ['content-box margins', { 'margin-left': '10px', 'margin-right': '10px' }],
  [
    'fixed width and alignment',
    {
      width: '170px',
      'box-sizing': 'border-box',
      'justify-self': 'center',
      'align-self': 'end',
      'margin-left': '10px',
      'margin-right': '10px',
    },
  ],
  [
    'percentage width',
    { width: '70%', 'justify-self': 'end', 'margin-left': '10px', 'margin-right': '10px' },
  ],
  [
    'intrinsic width and alignment',
    { 'justify-self': 'start', 'margin-left': '10px', 'margin-right': '10px' },
  ],
  ['class width token', { 'justify-self': 'end', 'margin-left': '10px', 'margin-right': '10px' }],
]) {
  test(`cms-hierarchical-resize: authored ${label} survive repeated viewport resizes`, async ({
    page,
    context,
  }) => {
    const undoEachGesture = ['percentage width', 'class width token'].includes(label)
    if (undoEachGesture) await page.clock.setSystemTime(Date.now())
    const { backend, frame } = await openStudio(page, context, ['a', 'b', 'c', 'd'])
    await page.evaluate(
      async ({ selector, authored, label }) => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        editor
          .getWrapper()
          .find(selector)[0]
          .components()
          .forEach((card) => card.addStyle(authored))
        if (label === 'class width token')
          editor.Css.setRule(`${selector} > [data-knc-source]`, {
            '--owner-card-width': '70%',
            width: 'var(--owner-card-width)',
          })
      },
      { selector: groupSelector, authored, label },
    )
    await select(page, groupSelector)
    let firstNarrow
    let previousStep
    let selectedCard = false
    for (const width of [820, 1440, 820]) {
      await page.getByRole('button', { name: 'Smal dator', exact: true }).click()
      await page.waitForFunction(
        (width) =>
          globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === width,
        width,
      )
      const before = await measure(frame)
      previousStep = before
      if (undoEachGesture && width === 1440) {
        await select(page, `${groupSelector} > div:first-child`)
        selectedCard = true
      }
      if (width === 820 && firstNarrow)
        assert.ok(
          Math.abs(before.cards[0].rect.width / firstNarrow.cards[0].rect.width - 0.8) < 0.05,
          `Returning to 820px preserves the authored width semantics: ${JSON.stringify({ firstNarrow, before })}`,
        )
      if (undoEachGesture) {
        // Each preview switch flushes the previous gesture. Cross the draft's 800 ms
        // grouping boundary without pausing Date or waiting for browser timers.
        await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 1000)
      }
      // WebKit's native minimum physical font size can hold an intrinsic card's
      // glyph width steady at small zooms. Compare the unchanged owner content
      // against the browser's own zoom layout before exercising the real control.
      const intrinsicBefore =
        label === 'intrinsic width and alignment' ? await intrinsicGeometry(frame) : null
      const nativeExpected = intrinsicBefore ? await intrinsicGeometry(frame, 0.8) : null
      await height(page, (selectedCard ? before.cards[0].rect.height : before.group.height) * 0.8)
      const after = await measure(frame)
      const nativeActual = intrinsicBefore ? await intrinsicGeometry(frame) : null
      await test.info().attach(`authored-${width}-geometry`, {
        body: JSON.stringify(
          { before, after, nativeExpected, nativeActual, details: await inspectGeometry(page) },
          null,
          2,
        ),
        contentType: 'application/json',
      })
      for (const [index, card] of after.cards.entries()) {
        if (!nativeExpected || !firstNarrow) {
          assert.ok(
            Math.abs(card.rect.width / before.cards[index].rect.width - 0.8) < 0.05,
            `${label}: ${width}px card ${index} scales proportionally: ${JSON.stringify({ before, after })}`,
          )
          assert.ok(
            Math.abs(card.photo.height / before.cards[index].photo.height - 0.8) < 0.05,
            `${label}: ${width}px portrait ${index} scales proportionally: ${JSON.stringify({ before, after })}`,
          )
        }
        if (nativeExpected) {
          assert.ok(Math.abs(card.rect.width - nativeExpected[index].width) < 1)
          assert.ok(Math.abs(card.photo.height - nativeExpected[index].photoHeight) < 1)
          assert.ok(Math.abs(nativeActual[index].zoom / intrinsicBefore[index].zoom - 0.8) < 0.005)
          assert.ok(Math.abs(nativeActual[index].fontSize - nativeExpected[index].fontSize) < 0.02)
          assert.equal(nativeActual[index].sourceFont, intrinsicBefore[index].sourceFont)
        }
      }
      const styles = await page.evaluate(async (selector) => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        return cmsGrapes.editors
          .at(-1)
          .getWrapper()
          .find(selector)[0]
          .components()
          .map((card) => card.getStyle())
      }, groupSelector)
      for (const style of styles)
        for (const [property, value] of Object.entries(authored))
          if (property !== 'width' || !String(value).includes('%'))
            assert.equal(
              String(style[property])
                .replace(/\s*!important$/i, '')
                .trim(),
              value,
              `${label}: ${property} stays authored`,
            )
      if (nativeExpected)
        for (const style of styles)
          assert.equal(style.width, undefined, 'The owner intrinsic width remains automatic')
      firstNarrow ??= after
    }
    if (undoEachGesture) {
      const reference = await measure(frame)
      const ids = new Map([['sv', reference.cards.map((card) => card.id)]])
      const retained = async (stage, expected = reference) => {
        await page.locator('.cms-editor-canvas[aria-busy="false"]').waitFor()
        await frame.locator(groupSelector).waitFor()
        const current = await measure(frame)
        if (
          current.cards.some(
            (card, index) =>
              Math.abs(card.rect.width - expected.cards[index].rect.width) >= 2 ||
              Math.abs(card.photo.height - expected.cards[index].photo.height) >= 2,
          )
        )
          await test.info().attach(`retained-${stage}-geometry`, {
            body: JSON.stringify(
              { expected, current, details: await inspectGeometry(page) },
              null,
              2,
            ),
            contentType: 'application/json',
          })
        for (const [index, card] of current.cards.entries()) {
          assert.ok(
            Math.abs(card.rect.width - expected.cards[index].rect.width) < 2,
            `${stage}: card ${index} retains its Desktop width (${card.rect.width} vs ${expected.cards[index].rect.width})`,
          )
          assert.ok(
            Math.abs(card.photo.height - expected.cards[index].photo.height) < 2,
            `${stage}: portrait ${index} retains its Desktop size`,
          )
        }
        return current
      }
      await page.getByRole('button', { name: 'Ångra', exact: true }).click()
      await retained('Desktop undo', previousStep)
      await page.getByRole('button', { name: 'Gör om', exact: true }).click()
      await retained('Desktop redo')
      for (const button of ['Mörk', 'EN', 'Ljus', 'SV']) {
        await page.getByRole('button', { name: button, exact: true }).click()
        const current = await retained(button)
        if (button === 'EN')
          ids.set(
            'en',
            current.cards.map((card) => card.id),
          )
      }
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.getByText('Publicerad · rev 2', { exact: true }).waitFor({ timeout: 15000 })
      const about = backend.document.presentation.pages.find((page) => page.path === '/about')
      if (label === 'class width token') {
        assert.ok(about.content.sv.css.light.includes('--owner-card-width:70%'))
        assert.ok(about.content.sv.css.light.includes('width:var(--owner-card-width)'))
        for (const lang of ['sv', 'en'])
          for (const mode of ['light', 'dark'])
            for (const id of ids.get(lang))
              assert.ok(
                about.content[lang].css[mode].includes(`:where(#${id})`),
                `${lang}/${mode}: #${id} targeted Desktop geometry is published`,
              )
      }
      await page.reload()
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      await frame.locator(groupSelector).waitFor({ timeout: 15000 })
      await page.getByRole('button', { name: 'Smal dator', exact: true }).click()
      await page.waitForFunction(
        () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 820,
      )
      await retained('Published reload')
    }
  })
}

test('cms-hierarchical-resize: a grouped rule never carries a resize guard past it', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { syncPageLayout } = await import('/src/admin/cms/responsiveStyles.ts')
    const { createSitePage } = await import('/shared/site-page.ts')
    const id = '10000000-0000-4000-8000-000000000002'
    const guard = (width) => `@media (min-width:769px){&:where(#card){width:${width}!important}}`
    const sheet = (middle, last) =>
      `#card{width:70%!important;${guard('40%')}}${middle}#card{width:${last}!important}`
    const fixture = (last) => sheet('#card, :where(#unused){width:80%!important}', last)
    const pageWith = (css) => {
      const next = createSitePage({ id, path: '/offers', name: { sv: 'Ny', en: 'New' } })
      for (const lang of ['sv', 'en'])
        next.content[lang] = {
          html: '<div id="card"><div></div></div>',
          css: { light: css, dark: css },
        }
      return next
    }
    // Each variant renders in an iframe of the exact breakpoint width, with no body margin.
    const measure = (css, size) => {
      const frame = globalThis.document.createElement('iframe')
      frame.style.width = `${size}px`
      frame.style.height = '200px'
      frame.style.border = '0'
      globalThis.document.body.append(frame)
      const doc = frame.contentDocument
      doc.open()
      doc.write(
        `<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body><div id="card"><div></div></div></body></html>`,
      )
      doc.close()
      const card = doc.getElementById('card')
      const measured = {
        ratio:
          card.getBoundingClientRect().width / card.parentElement.getBoundingClientRect().width,
        marginLeft: doc.defaultView.getComputedStyle(card).marginLeft,
      }
      frame.remove()
      return measured
    }
    const base = pageWith(fixture('90%'))
    const withMargin = globalThis.structuredClone(base)
    withMargin.content.sv.css.light += '@media (min-width:769px){#card{margin-left:10px}}'
    const edit = (before, after) => {
      const current = pageWith(before)
      const edited = globalThis.structuredClone(current)
      edited.content.sv.css.light = after
      return syncPageLayout(current, edited, 'sv', 'light')
    }
    const widen = (middle) => edit(sheet(middle, '90%'), sheet(middle, '95%'))
    const mobile = (width) =>
      `${sheet('', '90%')}@media (max-width:768px){#card{width:${width}!important}}`
    const guardEdit = (width) =>
      `#card{width:70%!important;${guard(width)}}#card{width:90%!important}`
    const twoGuards = (width, middle = '') =>
      `#card{width:70%!important;${guard('40%')}}${middle}#card{width:${width}!important;${guard('32%')}}`
    const supported = (width) =>
      `#card{width:70%!important;${guard('40%')}}@supports (display:grid){#card{width:${width}!important}}`
    const mobileRule = '@media (max-width:768px){#card{width:50%!important}}'
    const repeatResize = (last) =>
      `#card{width:70%!important;${guard('40%')}}${mobileRule}#card{width:90%!important;${guard(last)}}`
    const everywhere = (ratio) => ({ 390: ratio, 1440: ratio })
    const runs = [
      ['margin', syncPageLayout(base, withMargin, 'sv', 'light'), everywhere(0.9)],
      ['widened', edit(fixture('90%'), fixture('95%')), everywhere(0.95)],
      ['widened after empty middle', widen(''), everywhere(0.95)],
      [
        'widened after media group',
        widen('@media (min-width:769px){#card, :where(#unused){width:80%!important}}'),
        everywhere(0.95),
      ],
      [
        'widened after supports group',
        widen('@supports (display:grid){#card, :where(#unused){width:80%!important}}'),
        everywhere(0.95),
      ],
      ['mobile', edit(mobile('50%'), mobile('55%')), { 390: 0.55, 1440: 0.9 }],
      ['guard edit', edit(guardEdit('40%'), guardEdit('32%')), everywhere(0.9)],
      ['two guards', edit(twoGuards('90%'), twoGuards('95%')), { 390: 0.95, 1440: 0.32 }],
      [
        'two guards around mobile',
        edit(twoGuards('90%', mobileRule), twoGuards('95%', mobileRule)),
        { 390: 0.95, 1440: 0.32 },
      ],
      ['width inside supports', edit(supported('90%'), supported('95%')), everywhere(0.95)],
      ['repeat resize', edit(repeatResize('32%'), repeatResize('30%')), { 390: 0.9, 1440: 0.3 }],
    ]
    const report = []
    for (const [name, next, ratios] of runs)
      for (const lang of ['sv', 'en'])
        for (const mode of ['light', 'dark'])
          for (const size of [390, 1440])
            report.push({
              name,
              lang,
              mode,
              size,
              expected: ratios[size],
              ...measure(next.content[lang].css[mode], size),
            })
    return report
  })
  assert.deepEqual(errors, [])
  assert.equal(result.length, 88)
  for (const row of result) {
    const context = JSON.stringify(row)
    assert.ok(Math.abs(row.ratio - row.expected) < 0.001, context)
    if (row.name === 'margin')
      assert.equal(row.marginLeft, row.size === 1440 ? '10px' : '0px', context)
  }
})

test('cms-hierarchical-resize: removing an emptied rule never moves the next resize past a narrow-Desktop rule', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { syncPageLayout } = await import('/src/admin/cms/responsiveStyles.ts')
    const { createSitePage } = await import('/shared/site-page.ts')
    const guard = (width) => `@media (min-width:769px){&:where(#card){width:${width}!important}}`
    // The inner narrow-Desktop media keeps this Desktop block one rule in the editor, so a
    // Desktop edit either adds a separate rule or changes the first one in place.
    const grouped = (first, width, appended = '') =>
      `@media (min-width:769px){${first}#card{width:70%!important;${guard(width)}}@media (max-width:1100px){#card{width:90%!important}}}${appended}`
    const runs = [
      [
        'separate rule',
        grouped(
          '#card{padding-left:1px}',
          '40%',
          '@media (min-width:769px){#card{padding-left:10px}}',
        ),
        grouped(
          '#card{padding-left:1px}',
          '32%',
          '@media (min-width:769px){#card{padding-left:10px;zoom:0.8}}',
        ),
      ],
      [
        'in place',
        grouped('#card{padding-left:10px}', '40%'),
        grouped('#card{padding-left:10px}', '32%'),
      ],
    ]
    // Each variant renders in an iframe of the exact breakpoint width, with no body margin.
    const measure = (css, size) => {
      const frame = globalThis.document.createElement('iframe')
      frame.style.width = `${size}px`
      frame.style.height = '200px'
      frame.style.border = '0'
      globalThis.document.body.append(frame)
      const doc = frame.contentDocument
      doc.open()
      doc.write(
        `<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body><div id="card"><div></div></div></body></html>`,
      )
      doc.close()
      const card = doc.getElementById('card')
      const ratio =
        card.getBoundingClientRect().width / card.parentElement.getBoundingClientRect().width
      frame.remove()
      return ratio
    }
    const report = []
    for (const [name, ...edits] of runs) {
      const initial = grouped('#card{padding-left:1px}', '40%')
      let current = createSitePage({
        id: '10000000-0000-4000-8000-000000000002',
        path: '/offers',
        name: { sv: 'Ny', en: 'New' },
      })
      for (const lang of ['sv', 'en'])
        current.content[lang] = {
          html: '<div id="card"><div></div></div>',
          css: { light: initial, dark: initial },
        }
      // A Desktop padding edit, then a resize of the 40% guard, each synced from the stored result.
      for (const css of edits) {
        const edited = globalThis.structuredClone(current)
        edited.content.sv.css.light = css
        current = syncPageLayout(current, edited, 'sv', 'light')
      }
      for (const lang of ['sv', 'en'])
        for (const mode of ['light', 'dark'])
          for (const size of [390, 820, 1440])
            report.push({
              name,
              lang,
              mode,
              size,
              ratio: measure(current.content[lang].css[mode], size),
            })
    }
    return { report, unstyled: measure('', 390) }
  })
  assert.deepEqual(errors, [])
  assert.equal(result.report.length, 24)
  const edited = (name, size) =>
    result.report.find(
      (row) => row.name === name && row.lang === 'sv' && row.mode === 'light' && row.size === size,
    ).ratio
  for (const name of ['separate rule', 'in place']) {
    // The edited sheet ends on 90% at 820px and on the resized guard at 1440px; Mobile on neither.
    assert.ok(Math.abs(edited(name, 820) - edited(name, 1440)) > 0.1, `${name}: 820px as 1440px`)
    assert.ok(Math.abs(edited(name, 390) - result.unstyled) < 0.001, `${name}: Mobile is styled`)
  }
  // Every other theme and language renders as the edited sheet at each width.
  for (const row of result.report)
    assert.ok(
      Math.abs(row.ratio - edited(row.name, row.size)) < 0.001,
      JSON.stringify({ ...row, edited: edited(row.name, row.size) }),
    )
})

// The same two edits in the Studio, on a stored About page whose four sheets hold the grouped
// Desktop block for the first barber card. Each edit is a real model change, exported and synced.
test('cms-hierarchical-resize: the Studio keeps the next resize ahead of a narrow-Desktop rule after a padding edit', async ({
  page,
  context,
  newContext,
}) => {
  const exportDraft = async (target) => {
    await target.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
    const downloaded = target.waitForEvent('download')
    await target
      .getByRole('dialog', { name: 'Utkast & backup' })
      .getByRole('button', { name: 'Export', exact: true })
      .click()
    const stream = await (await downloaded).createReadStream()
    assert.ok(stream, 'The backup must be readable')
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    await target
      .getByRole('dialog', { name: 'Utkast & backup' })
      .getByRole('button', { name: 'Stäng panel', exact: true })
      .click()
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  const aboutOf = (document) => document.presentation.pages.find((item) => item.path === '/about')
  // A first Studio builds the About page from the live source. Its card IDs differ per language.
  const captureContext = await newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const capturePage = await captureContext.newPage()
  await openStudio(capturePage, captureContext, ['a', 'b'])
  const captured = await exportDraft(capturePage)
  const ids = await capturePage.evaluate(
    ({ about, selector }) =>
      Object.fromEntries(
        ['sv', 'en'].map((lang) => {
          const strip = new globalThis.DOMParser()
            .parseFromString(about.content[lang].html, 'text/html')
            .querySelector(selector)
          const card = [...(strip?.children ?? [])].find(
            (node) => node.id && node.hasAttribute('data-knc-source'),
          )
          if (!card) throw new Error(`The ${lang} barber card is missing`)
          return [lang, card.id]
        }),
      ),
    { about: aboutOf(captured), selector: groupSelector },
  )
  await captureContext.close()
  // Doc A's grouped Desktop block. Native export marks owner declarations important, so the
  // padding is stored as the editor writes it back.
  const grouped = (id, width) =>
    `@media (min-width:769px){#${id}{padding-left:1px!important}#${id}{width:70%!important;@media (min-width:769px){&:where(#${id}){width:${width}!important}}}@media (max-width:1100px){#${id}{width:90%!important}}}`
  const seeded = globalThis.structuredClone(captured)
  for (const lang of ['sv', 'en'])
    for (const mode of ['light', 'dark'])
      aboutOf(seeded).content[lang].css[mode] += grouped(ids[lang], '40%')
  await page.clock.setSystemTime(Date.now())
  const { backend, frame } = await openStudio(page, context, ['a', 'b'], seeded)
  const variants = [
    ['sv', 'light'],
    ['sv', 'dark'],
    ['en', 'light'],
    ['en', 'dark'],
  ]
  const sheetsOf = (document) =>
    variants.map(([lang, mode]) => ({
      lang,
      mode,
      id: ids[lang],
      css: aboutOf(document).content[lang].css[mode],
    }))
  const declared = (css, selector, property) => {
    const values = []
    walk(parse(css), {
      visit: 'Rule',
      enter(rule) {
        if (generate(rule.prelude) !== selector) return
        rule.block.children.forEach((node) => {
          if (node.type === 'Declaration' && node.property === property)
            values.push(generate(node.value))
        })
      },
    })
    return values
  }
  const probe = await context.newPage()
  await probe.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  // Each saved sheet renders in an iframe of the exact breakpoint width, with no body margin.
  const ratios = (document) =>
    probe.evaluate(
      (sheets) =>
        sheets.flatMap(({ lang, mode, id, css }) =>
          [390, 820, 1440].map((size) => {
            const frame = globalThis.document.createElement('iframe')
            frame.style.width = `${size}px`
            frame.style.height = '200px'
            frame.style.border = '0'
            globalThis.document.body.append(frame)
            const doc = frame.contentDocument
            doc.open()
            doc.write(
              `<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body><div id="${id}"><div></div></div></body></html>`,
            )
            doc.close()
            const card = doc.getElementById(id)
            const ratio =
              card.getBoundingClientRect().width / card.parentElement.getBoundingClientRect().width
            frame.remove()
            return { lang, mode, size, ratio }
          }),
        ),
      sheetsOf(document),
    )
  const ratioOf = (rows, lang, mode, size) =>
    rows.find((row) => row.lang === lang && row.mode === mode && row.size === size).ratio

  const stored = await exportDraft(page)
  for (const { lang, mode, id, css } of sheetsOf(stored))
    assert.ok(css.includes(grouped(id, '40%')), `Load: ${lang}/${mode} lost the grouped block`)
  assert.equal((await measure(frame)).cards[0].id, ids.sv, 'Load: the canvas edits another card')
  const storedRatios = await ratios(stored)

  // 1. A Desktop padding edit on the card's own rule.
  await page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const [card] = cmsGrapes.editors.at(-1).getWrapper().find(selector)[0].components()
    card.addStyle({ 'padding-left': '10px' })
  }, groupSelector)
  const padded = await exportDraft(page)
  for (const { lang, mode, id, css } of sheetsOf(padded)) {
    const where = `Padding edit, ${lang}/${mode}`
    assert.deepEqual(declared(css, `&:where(#${id})`, 'width'), ['40%'], `${where}: guard moved`)
    const padding = declared(css, `#${id}`, 'padding-left')
    assert.equal(padding.at(-1), '10px', `${where}: the new padding is not last`)
    // The edited sheet keeps its block. The others drop the old padding, which empties the
    // first rule of their block.
    if (lang === 'sv' && mode === 'light')
      assert.ok(css.includes(grouped(id, '40%')), `${where}: the export rewrote the grouped block`)
    else assert.deepEqual(padding, ['10px'], `${where}: the first rule kept its padding`)
  }
  // The export flushed the padding edit. Cross the draft's 800 ms grouping boundary so the
  // resize starts its own undo step.
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 1000)

  // 2. A resize of the same card, which rewrites its 40% guard in place.
  await select(page, `${groupSelector} > div:first-child`)
  await height(page, (await measure(frame)).cards[0].rect.height * 0.8)
  const resized = await exportDraft(page)
  const [edited, ...others] = sheetsOf(resized)
  const guard = declared(edited.css, `&:where(#${edited.id})`, 'width')
  assert.equal(guard.length, 1, `Resize: the edited sheet holds ${JSON.stringify(guard)}`)
  assert.notEqual(guard[0], '40%', 'Resize: the edited guard kept 40%')
  for (const { lang, mode, id, css } of others)
    assert.deepEqual(
      declared(css, `&:where(#${id})`, 'width'),
      guard,
      `Resize, ${lang}/${mode}: the 40% guard is not replaced`,
    )
  const resizedRatios = await ratios(resized)
  await test.info().attach('padding-then-resize-ratios', {
    body: JSON.stringify({ stored: storedRatios, resized: resizedRatios }, null, 2),
    contentType: 'application/json',
  })
  const edit = (size) => ratioOf(resizedRatios, 'sv', 'light', size)
  // The edited sheet ends on 90% at 820px and on the resized guard at 1440px.
  assert.ok(Math.abs(edit(820) - edit(1440)) > 0.1, 'Resize: 820px renders as 1440px')
  for (const row of resizedRatios) {
    const detail = JSON.stringify({
      ...row,
      edited: edit(row.size),
      stored: ratioOf(storedRatios, row.lang, row.mode, row.size),
    })
    // Every other theme and language renders as the edited sheet at each width.
    assert.ok(Math.abs(row.ratio - edit(row.size)) < 0.001, `Resize: ${detail}`)
    // Neither Desktop edit reaches Mobile.
    if (row.size === 390)
      assert.ok(
        Math.abs(row.ratio - ratioOf(storedRatios, row.lang, row.mode, 390)) < 0.001,
        `Mobile: ${detail}`,
      )
  }

  // Undo and Redo restore the complete documents of the two separate edits.
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await page.locator('.cms-editor-canvas[aria-busy="false"]').waitFor()
  assert.deepEqual(await exportDraft(page), padded, 'Undo restores the padding snapshot')
  await page.getByRole('button', { name: 'Gör om', exact: true }).click()
  await page.locator('.cms-editor-canvas[aria-busy="false"]').waitFor()
  assert.deepEqual(await exportDraft(page), resized, 'Redo restores the resize snapshot')

  // Every saved sheet holds the resized guard once and renders as it did after the resize.
  const assertResized = async (document, stage) => {
    for (const { lang, mode, id, css } of sheetsOf(document))
      assert.deepEqual(
        declared(css, `&:where(#${id})`, 'width'),
        guard,
        `${stage}, ${lang}/${mode}: the guard changed`,
      )
    for (const row of await ratios(document))
      assert.ok(
        Math.abs(row.ratio - ratioOf(resizedRatios, row.lang, row.mode, row.size)) < 0.001,
        `${stage}: ${JSON.stringify(row)}`,
      )
  }
  // Each theme and language imports its own sheet, whose card renders as the reference at 820px.
  const assertImports = async (stage, reference) => {
    for (const button of ['Mörk', 'EN', 'Ljus', 'SV']) {
      await page.getByRole('button', { name: button, exact: true }).click()
      await page.locator('.cms-editor-canvas[aria-busy="false"]').waitFor()
      await frame.locator(groupSelector).waitFor()
      const card = (await measure(frame)).cards[0]
      assert.ok(
        Math.abs(card.rect.width - reference.rect.width) < 2 &&
          Math.abs(card.photo.height - reference.photo.height) < 2,
        `${stage}, ${button}: the card is ${card.rect.width}px wide at 820px, not ${reference.rect.width}px`,
      )
    }
  }

  // Switch devices, then theme and language at 820px. No switch changes a saved sheet.
  for (const [name, width] of [
    ['Mobil', 390],
    ['Dator', 1440],
    ['Smal dator', 820],
  ]) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForFunction(
      (width) =>
        globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === width,
      width,
    )
  }
  await page.locator('.cms-editor-canvas[aria-busy="false"]').waitFor()
  await frame.locator(groupSelector).waitFor()
  const reference = (await measure(frame)).cards[0]
  await assertImports('Switch', reference)
  assert.deepEqual(await exportDraft(page), resized, 'A switch changed a saved sheet')

  // Publish, then reimport the stored document in a reloaded Studio.
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor({ timeout: 15000 })
  await assertResized(backend.document, 'Publish')
  await page.reload()
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await frame.locator(groupSelector).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Smal dator', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 820,
  )
  await assertImports('Published reload', reference)
  await assertResized(await exportDraft(page), 'Published reload')
})

// The same grouped Desktop block before any resize, so the resize after the padding edit nests the
// card's first guard. Every sheet must hold it ahead of the narrow-Desktop rule.
test('cms-hierarchical-resize: the Studio nests a first guard ahead of a narrow-Desktop rule after a padding edit', async ({
  page,
  context,
  newContext,
}) => {
  const exportDraft = async (target) => {
    await target.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
    const downloaded = target.waitForEvent('download')
    await target
      .getByRole('dialog', { name: 'Utkast & backup' })
      .getByRole('button', { name: 'Export', exact: true })
      .click()
    const stream = await (await downloaded).createReadStream()
    assert.ok(stream, 'The backup must be readable')
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    await target
      .getByRole('dialog', { name: 'Utkast & backup' })
      .getByRole('button', { name: 'Stäng panel', exact: true })
      .click()
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  const aboutOf = (document) => document.presentation.pages.find((item) => item.path === '/about')
  // A first Studio builds the About page from the live source. Its card IDs differ per language.
  const captureContext = await newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const capturePage = await captureContext.newPage()
  await openStudio(capturePage, captureContext, ['a', 'b'])
  const captured = await exportDraft(capturePage)
  const ids = await capturePage.evaluate(
    ({ about, selector }) =>
      Object.fromEntries(
        ['sv', 'en'].map((lang) => {
          const strip = new globalThis.DOMParser()
            .parseFromString(about.content[lang].html, 'text/html')
            .querySelector(selector)
          const card = [...(strip?.children ?? [])].find(
            (node) => node.id && node.hasAttribute('data-knc-source'),
          )
          if (!card) throw new Error(`The ${lang} barber card is missing`)
          return [lang, card.id]
        }),
      ),
    { about: aboutOf(captured), selector: groupSelector },
  )
  await captureContext.close()
  const grouped = (id) =>
    `@media (min-width:769px){#${id}{padding-left:1px!important}#${id}{width:70%!important}@media (max-width:1100px){#${id}{width:90%!important}}}`
  const seeded = globalThis.structuredClone(captured)
  for (const lang of ['sv', 'en'])
    for (const mode of ['light', 'dark'])
      aboutOf(seeded).content[lang].css[mode] += grouped(ids[lang])
  await page.clock.setSystemTime(Date.now())
  const { frame } = await openStudio(page, context, ['a', 'b'], seeded)
  const sheetsOf = (document) =>
    [
      ['sv', 'light'],
      ['sv', 'dark'],
      ['en', 'light'],
      ['en', 'dark'],
    ].map(([lang, mode]) => ({
      lang,
      mode,
      id: ids[lang],
      css: aboutOf(document).content[lang].css[mode],
    }))
  // A property's values in source order, from the rules with any of the given selectors.
  const declared = (css, selectors, property) => {
    const values = []
    walk(parse(css), {
      visit: 'Rule',
      enter(rule) {
        if (!selectors.includes(generate(rule.prelude))) return
        rule.block.children.forEach((node) => {
          if (node.type === 'Declaration' && node.property === property)
            values.push(generate(node.value))
        })
      },
    })
    return values
  }
  const probe = await context.newPage()
  await probe.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  // Each saved sheet renders in an iframe of the exact breakpoint width, with no body margin.
  const ratios = (document) =>
    probe.evaluate(
      (sheets) =>
        sheets.flatMap(({ lang, mode, id, css }) =>
          [390, 820, 1440].map((size) => {
            const frame = globalThis.document.createElement('iframe')
            frame.style.width = `${size}px`
            frame.style.height = '200px'
            frame.style.border = '0'
            globalThis.document.body.append(frame)
            const doc = frame.contentDocument
            doc.open()
            doc.write(
              `<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body><div id="${id}"><div></div></div></body></html>`,
            )
            doc.close()
            const card = doc.getElementById(id)
            const ratio =
              card.getBoundingClientRect().width / card.parentElement.getBoundingClientRect().width
            frame.remove()
            return { lang, mode, size, ratio }
          }),
        ),
      sheetsOf(document),
    )

  const stored = await exportDraft(page)
  for (const { lang, mode, id, css } of sheetsOf(stored))
    assert.ok(css.includes(grouped(id)), `Load: ${lang}/${mode} lost the grouped block`)
  assert.equal((await measure(frame)).cards[0].id, ids.sv, 'Load: the canvas edits another card')

  // 1. A Desktop padding edit on the card's own rule.
  await page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const [card] = cmsGrapes.editors.at(-1).getWrapper().find(selector)[0].components()
    card.addStyle({ 'padding-left': '10px' })
  }, groupSelector)
  const padded = await exportDraft(page)
  for (const { lang, mode, id, css } of sheetsOf(padded)) {
    const where = `Padding edit, ${lang}/${mode}`
    assert.deepEqual(declared(css, [`&:where(#${id})`], 'width'), [], `${where}: a guard appeared`)
    const padding = declared(css, [`#${id}`], 'padding-left')
    assert.equal(padding.at(-1), '10px', `${where}: the new padding is not last`)
    // The edited sheet keeps its block. The others drop the old padding, which empties the
    // first rule of their block.
    if (lang === 'sv' && mode === 'light')
      assert.ok(css.includes(grouped(id)), `${where}: the export rewrote the grouped block`)
    else assert.deepEqual(padding, ['10px'], `${where}: the first rule kept its padding`)
  }
  // Cross the draft's 800 ms grouping boundary so the resize starts its own undo step.
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 1000)

  // 2. The card's first resize, which nests its guard after the authored 70%.
  await select(page, `${groupSelector} > div:first-child`)
  await height(page, (await measure(frame)).cards[0].rect.height * 0.8)
  const resized = await exportDraft(page)
  const [edited, ...others] = sheetsOf(resized)
  const guard = declared(edited.css, [`&:where(#${edited.id})`], 'width')
  assert.equal(guard.length, 1, `Resize: the edited sheet holds ${JSON.stringify(guard)}`)
  const widths = ({ id, css }) => declared(css, [`#${id}`, `&:where(#${id})`], 'width')
  assert.deepEqual(
    widths(edited).slice(-3),
    ['70%', guard[0], '90%'],
    'Resize: the edited sheet holds the guard elsewhere',
  )
  for (const sheet of others)
    assert.deepEqual(
      widths(sheet),
      widths(edited),
      `Resize, ${sheet.lang}/${sheet.mode}: the first guard follows the narrow-Desktop rule`,
    )
  const resizedRatios = await ratios(resized)
  const edit = (size) =>
    resizedRatios.find((row) => row.lang === 'sv' && row.mode === 'light' && row.size === size)
      .ratio
  // The edited sheet ends on 90% at 820px and on the new guard at 1440px.
  assert.ok(Math.abs(edit(820) - edit(1440)) > 0.1, 'Resize: 820px renders as 1440px')
  // Every other theme and language renders as the edited sheet at each width.
  for (const row of resizedRatios)
    assert.ok(
      Math.abs(row.ratio - edit(row.size)) < 0.001,
      `Resize: ${JSON.stringify({ ...row, edited: edit(row.size) })}`,
    )
})

for (const [label, card, before, after] of [
  ['an aspect-ratio card stays square', { 'aspect-ratio': '1' }, [100, 100], [80, 80]],
  // Control: a stretched card fills its track, so its width follows the height change.
  ['a stretched card keeps its share of the track', {}, [400, 100], [320, 80]],
]) {
  test(`cms-hierarchical-resize: ${label} after a Desktop height change`, async ({
    page,
    context,
  }) => {
    const { frame } = await openStudio(page, context, ['a', 'b'])
    await page.evaluate(
      async ({ selector, card }) => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const group = cmsGrapes.editors.at(-1).getWrapper().find(selector)[0]
        // Two 400px tracks; each card is a 100px border box with no automatic minimum width.
        group.addStyle({ 'grid-template-columns': '400px 400px', gap: '0px' })
        for (const item of group.components())
          item.addStyle({
            width: 'auto',
            height: '100px',
            'box-sizing': 'border-box',
            'min-width': '0px',
            ...card,
          })
      },
      { selector: groupSelector, card },
    )
    const grid = await frame.locator(groupSelector).evaluate((group) => {
      const style = group.ownerDocument.defaultView.getComputedStyle(group)
      return { display: style.display, columns: style.gridTemplateColumns }
    })
    assert.deepEqual(grid, { display: 'grid', columns: '400px 400px' }, 'The strip has two tracks')
    const sizes = async (stage, expected) => {
      const { cards } = await measure(frame)
      assert.equal(cards.length, 2, `${stage}: both barber cards render`)
      for (const [index, item] of cards.entries())
        assert.ok(
          Math.abs(item.rect.width - expected[0]) < 1 &&
            Math.abs(item.rect.height - expected[1]) < 1,
          `${stage}: card ${index} is ${item.rect.width}x${item.rect.height}, not ${expected.join('x')}`,
        )
    }
    await sizes('Before', before)
    await select(page, `${groupSelector} > div:first-child`)
    await height(page, 80)
    await sizes('After the height change', after)
    // Leaving Desktop exports the sheet, and returning imports it again.
    for (const [name, width] of [
      ['Mobil', 390],
      ['Dator', 1440],
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.waitForFunction(
        (width) =>
          globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === width,
        width,
      )
    }
    await sizes('After export and reimport', after)
  })
}
