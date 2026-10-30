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
            style: rule.get('style'),
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

/** The Studio harness with the given active barbers on the published About page. */
async function openStudio(page, context, ids) {
  const base = harnessOrigin
  assert.equal(new URL(base).hostname, '127.0.0.1')
  context.setDefaultTimeout(10000)
  const seed = documentFixture()
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
]) {
  test(`cms-hierarchical-resize: authored ${label} survive repeated viewport resizes`, async ({
    page,
    context,
  }) => {
    const { frame } = await openStudio(page, context, ['a', 'b', 'c', 'd'])
    await page.evaluate(
      async ({ selector, authored }) => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        editor
          .getWrapper()
          .find(selector)[0]
          .components()
          .forEach((card) => card.addStyle(authored))
      },
      { selector: groupSelector, authored },
    )
    await select(page, groupSelector)
    let firstNarrow
    for (const width of [820, 1440, 820]) {
      await page.getByRole('button', { name: 'Smal dator', exact: true }).click()
      await page.waitForFunction(
        (width) =>
          globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === width,
        width,
      )
      const before = await measure(frame)
      if (width === 820 && firstNarrow)
        assert.ok(
          Math.abs(before.cards[0].rect.width / firstNarrow.cards[0].rect.width - 0.8) < 0.05,
          `Returning to 820px preserves the authored width semantics: ${JSON.stringify({ firstNarrow, before })}`,
        )
      await height(page, before.group.height * 0.8)
      const after = await measure(frame)
      await test.info().attach(`authored-${width}-geometry`, {
        body: JSON.stringify({ before, after, details: await inspectGeometry(page) }, null, 2),
        contentType: 'application/json',
      })
      for (const [index, card] of after.cards.entries()) {
        assert.ok(
          Math.abs(card.rect.width / before.cards[index].rect.width - 0.8) < 0.05,
          `${label}: ${width}px card ${index} scales proportionally: ${JSON.stringify({ before, after })}`,
        )
        assert.ok(
          Math.abs(card.photo.height / before.cards[index].photo.height - 0.8) < 0.05,
          `${label}: ${width}px portrait ${index} scales proportionally: ${JSON.stringify({ before, after })}`,
        )
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
      firstNarrow ??= after
    }
  })
}
