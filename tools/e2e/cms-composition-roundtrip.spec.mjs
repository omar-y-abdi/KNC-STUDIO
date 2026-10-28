import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-backend.mjs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

test('canvas CSS trees survive import and startup yields return control to the browser', async ({
  page,
}) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { parseCanvasSheet, parseCanvasCss, yieldCanvasTask } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { bindCmsRootStyles } = await import('/src/admin/cms/cmsRootStyles.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
    })
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
    try {
      const css =
        'html body{padding:var(--space,10px 20px);--owner:var(--x,one two);color:red!important}@media(max-width:768px){#about{width:calc(100% - 4px)}}'
      const tree = parseCanvasSheet(css)
      const bound = bindCmsRootStyles(tree, 'editor-root')
      const fromTree = parseCanvasCss(bound, editor)
      const fromText = parseCanvasCss(bindCmsRootStyles(css, 'editor-root'), editor)
      const repeated = parseCanvasCss(bound, editor)
      let schedulerCalls = 0
      Object.defineProperty(globalThis, 'scheduler', {
        configurable: true,
        value: {
          yield: async () => {
            schedulerCalls++
          },
        },
      })
      await yieldCanvasTask()
      Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: undefined })
      let inputRan = false
      globalThis.setTimeout(() => {
        inputRan = true
      }, 0)
      await yieldCanvasTask()
      return { fromTree, fromText, repeated, sameTree: bound === tree, schedulerCalls, inputRan }
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor)
      else delete globalThis.scheduler
      editor.destroy()
      host.remove()
    }
  })
  assert.equal(result.sameTree, true, 'Root binding must forward the parsed tree')
  assert.deepEqual(
    result.fromTree,
    result.fromText,
    'AST imports preserve var/calc/custom properties',
  )
  assert.deepEqual(result.repeated, result.fromTree, 'Import masking must not mutate a cached tree')
  assert.equal(result.schedulerCalls, 1, 'Use scheduler.yield when available')
  assert.equal(result.inputRan, true, 'The fallback must yield a task, not only a microtask')
})

test('information-page comparison uses the editing canvas base and selected theme', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await nativeBackend(context)
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page
    .locator('.cms-editor-canvas[data-cms-canvas-ready="true"][aria-busy="false"]:not([inert])')
    .waitFor({ timeout: 90000 })
  await page.getByRole('button', { name: 'Jämför', exact: true }).click()
  const comparison = page.frameLocator('iframe[title="Jämförelsevy"]')
  const base = (selector) =>
    page.evaluate((selector) => {
      const doc = globalThis.document.querySelector(selector)?.contentDocument
      if (!doc) return null
      const loaded = [...doc.styleSheets].flatMap((sheet) =>
        sheet.href ? [new URL(sheet.href).pathname] : [],
      )
      return {
        scheme: doc.documentElement.style.colorScheme,
        styles: ['/tokens.css', '/info.css'].filter((path) => loaded.includes(path)),
      }
    }, selector)
  for (const [name, selector, title] of [
    ['Integritetspolicy', 'main h1', 'Integritetspolicy'],
    ['Bokningsvillkor', 'main h1', 'Bokningsvillkor'],
    ['Kontakt', '#contact-title', /^Kontakta /],
  ]) {
    await page.locator('#cms-library').getByRole('button', { name, exact: true }).click()
    await expect(comparison.locator(selector)).toHaveText(title)
    for (const mode of ['light', 'dark']) {
      await page
        .getByRole('group', { name: 'Tema', exact: true })
        .getByRole('button', { name: mode === 'light' ? 'Ljus' : 'Mörk', exact: true })
        .click()
      const expected = { scheme: mode, styles: ['/tokens.css', '/info.css'] }
      await expect.poll(() => base('.gjs-frame')).toEqual(expected)
      await expect.poll(() => base('iframe[title="Jämförelsevy"]')).toEqual(expected)
    }
  }
})

test('resize cascade primitive resolves variables and layers without exporting probes', async ({
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { readCanvasCss, parseCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      // Native nested rules require both export and live mount to opt in. This primitive
      // proves those integration seams before the resize implementation depends on them.
      optsCss: { withNested: true },
      components:
        '<div id="holder"><div id="probe-card" class="probe-card">Card</div><div id="inherited">Inherited</div></div>',
      style:
        '#holder{width:800px}.probe-card{height:100px}@layer base,overrides;@layer base{.probe-card,#unmatched{--owner-card-width:70%;width:var(--owner-card-width,60%)}}@layer overrides{#probe-card{width:revert-layer}}#inherited{width:inherit}@media(min-width:1000px){#probe-card{width:var(--owner-card-width,60%)!important}}',
      deviceManager: {
        devices: [
          { id: 'Wide', width: '1440px' },
          { id: 'Narrow', width: '820px' },
        ],
      },
    })
    await new Promise((resolve) => editor.on('load', resolve))
    editor.on('css:mount:before', (mount) => {
      mount.css = mount.rule.toCSS({ important: mount.rule.get('important'), withNested: true })
    })
    const doc = editor.Canvas.getDocument()
    const view = doc.defaultView
    const card = doc.getElementById('probe-card')
    const inherited = doc.getElementById('inherited')
    const settleViewport = async (device, width) => {
      editor.setDevice(device)
      const deadline = globalThis.performance.now() + 5000
      let stableFrames = 0
      while (stableFrames < 2) {
        await new Promise((resolve) => view.requestAnimationFrame(resolve))
        const frameWidth = editor.Canvas.getFrameEl().getBoundingClientRect().width
        stableFrames =
          view.innerWidth === width && Math.abs(frameWidth - width) < 0.01 ? stableFrames + 1 : 0
        if (globalThis.performance.now() > deadline) {
          throw new Error(
            `Device ${device} did not settle at ${width}px: viewport=${view.innerWidth}, frame=${frameWidth}`,
          )
        }
      }
    }
    const probe = () => {
      const names = [
        '--cms-internal-prototype-width',
        '--cms-internal-prototype-source',
        '--cms-internal-prototype-branch',
      ]
      const temporary = doc.createElement('style')
      temporary.textContent = names
        .map(
          (name, index) =>
            `@property ${name}{syntax:"*";inherits:false;initial-value:${index ? 'none' : 'auto'}}`,
        )
        .join('')
      const cleanup = []
      const sources = new Map()
      const models = new Map(
        editor.Css.getAll().models.map((model) => [model.getView()?.el?.sheet, model]),
      )
      const walk = (parent, model) => {
        for (const rule of [...parent.cssRules]) {
          if (rule.style?.getPropertyValue('width')) {
            const style = rule.style
            const previous = style.cssText
            cleanup.push(() => {
              style.cssText = previous
            })
            const value = style.getPropertyValue('width')
            const priority = style.getPropertyPriority('width') ? '!important' : ''
            const key = `r${sources.size}`
            sources.set(key, { model, selector: rule.selectorText })
            const marker = ['revert', 'revert-layer'].includes(value) ? value : key
            style.cssText += `;${names[0]}:${value}${priority};${names[1]}:${marker}${priority}`
          }
          if (rule.cssRules) walk(rule, model)
        }
      }
      try {
        doc.head.append(temporary)
        for (const sheet of [...doc.styleSheets]) walk(sheet, models.get(sheet))
        const style = view.getComputedStyle(card)
        const source = sources.get(style.getPropertyValue(names[1]).trim())
        // This fixture's selector list has two simple branches, including an unmatched ID.
        temporary.textContent += source.selector
          .split(',')
          .map((branch, index) => `${branch}:where(#probe-card){${names[2]}:b${index}}`)
          .join('')
        const child = view.getComputedStyle(inherited)
        return {
          width: style.getPropertyValue(names[0]).trim(),
          usedWidth: parseFloat(style.width),
          branch: view.getComputedStyle(card).getPropertyValue(names[2]).trim(),
          selector: source.selector,
          media: source.model.get('mediaText'),
          type: source.model.get('atRuleType'),
          inherited: child.getPropertyValue(names[0]).trim(),
          inheritSelector: sources.get(child.getPropertyValue(names[1]).trim()).selector,
        }
      } finally {
        for (const restore of cleanup.reverse()) restore()
        temporary.remove()
      }
    }
    const samples = []
    try {
      for (const [device, width] of [
        ['Wide', 1440],
        ['Narrow', 820],
      ]) {
        // GJS animates the frame width for 350ms; two RAFs can still leave Wide media active.
        await settleViewport(device, width)
        editor.clearDirtyCount()
        const before = JSON.stringify(editor.getProjectData())
        const exported = readCanvasCss(editor)
        samples.push({
          device,
          viewportWidth: view.innerWidth,
          frameWidth: editor.Canvas.getFrameEl().getBoundingClientRect().width,
          wideMedia: view.matchMedia('(min-width: 1000px)').matches,
          ...probe(),
          unchanged:
            before === JSON.stringify(editor.getProjectData()) &&
            exported === readCanvasCss(editor),
          dirty: editor.getDirtyCount(),
        })
      }
      await settleViewport('Wide', 1440)
      const source = editor.Css.getAll().models.find((rule) =>
        rule.get('mediaText')?.includes('1000px'),
      )
      source.setStyle({
        ...source.toJSON().style,
        ':where(&):is(#probe-card):where(#probe-card)': {
          '@media(min-width:769px)': {
            ':is(&)': { width: '56%!important' },
          },
        },
      })
      const beforeReload = card.getBoundingClientRect().width
      const serialized = readCanvasCss(editor)
      editor.Css.getAll().reset(parseCanvasCss(serialized, editor))
      const afterReload = card.getBoundingClientRect().width
      return { samples, beforeReload, afterReload, serialized }
    } finally {
      // ClassTagsView debounces style/device updates by one task. Let that work finish
      // before destroy removes its selected-component model.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('resize-cascade-primitive', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  await page.evaluate(() => new Promise((resolve) => globalThis.setTimeout(resolve, 0)))
  assert.deepEqual(pageErrors, [], 'Primitive teardown must not leave queued editor errors')
  assert.deepEqual(
    result.samples.map(({ viewportWidth, wideMedia }) => ({ viewportWidth, wideMedia })),
    [
      { viewportWidth: 1440, wideMedia: true },
      { viewportWidth: 820, wideMedia: false },
    ],
  )
  assert.deepEqual(
    result.samples.map(({ width, usedWidth, inherited, inheritSelector, unchanged, dirty }) => ({
      width,
      usedWidth,
      inherited,
      inheritSelector,
      unchanged,
      dirty,
    })),
    [
      {
        width: '70%',
        usedWidth: 560,
        inherited: '800px',
        inheritSelector: '#inherited',
        unchanged: true,
        dirty: 0,
      },
      {
        width: '70%',
        usedWidth: 560,
        inherited: '800px',
        inheritSelector: '#inherited',
        unchanged: true,
        dirty: 0,
      },
    ],
  )
  assert.equal(result.samples[0].type, 'media')
  assert.ok(result.samples[0].media.includes('1000px'))
  assert.equal(result.samples[1].type, 'layer')
  assert.equal(result.samples[1].media, 'base')
  assert.equal(
    result.samples[1].branch,
    'b0',
    'The unmatched ID branch must not determine specificity',
  )
  assert.equal(result.beforeReload, 448)
  assert.equal(
    result.afterReload,
    result.beforeReload,
    'GrapesJS CSS import must retain the nested conditional override',
  )
  assert.ok(!result.serialized.includes('--cms-internal-prototype'), 'No probe may be exported')
})

// Freeze idle work without freezing input, animation frames or the editor's export timers.
async function holdAboutIdle(page) {
  await page.addInitScript(() => {
    globalThis.cmsIdleCallbacks = new Map()
    let id = 0
    globalThis.requestIdleCallback = (callback) => {
      globalThis.cmsIdleCallbacks.set(++id, callback)
      return id
    }
    globalThis.cancelIdleCallback = (key) => globalThis.cmsIdleCallbacks.delete(key)
  })
}

async function openAdoptedFixture(page, context) {
  const raw = {
    ...emptyDocument(),
    presentation: JSON.parse(
      gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
    ).presentation,
  }
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  // This is the pre-E6 adoption baseline, including legal and marquee migrations.
  const adopted = await page.evaluate(async (doc) => {
    const { normalizeDocument } = await import('/src/admin/cms/normalizeDocument.ts')
    return normalizeDocument(doc)
  }, raw)
  const backend = await nativeBackend(context, raw)
  await context.route('**/cms-public/source', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>',
    }),
  )
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page
    .frameLocator('.gjs-frame')
    .first()
    .locator('[data-knc-surface="desktop-home"]')
    .waitFor({ timeout: 90000 })
  return { backend, adopted }
}

for (const trigger of ['switch', 'idle', 'layers']) {
  test(`inactive About is built on ${trigger}, once, without changing adopted saved bytes`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await holdAboutIdle(page)
    const { backend, adopted } = await openAdoptedFixture(page, context)
    const before = Buffer.from(JSON.stringify(adopted))
    const frame = page.frameLocator('.gjs-frame').first()
    const preview = frame.locator('[id^="preview-shared-"]')
    assert.equal(await preview.count(), 0, 'No inactive About copy exists before switch or idle')
    assert.equal(
      await frame.locator('[data-editor-about-slot] [data-knc-surface="about"]').count(),
      1,
    )
    if (trigger === 'idle') {
      await page.waitForFunction(() => globalThis.cmsIdleCallbacks.size > 0)
      await page.evaluate(() => {
        for (const [key, callback] of globalThis.cmsIdleCallbacks) {
          globalThis.cmsIdleCallbacks.delete(key)
          callback({ didTimeout: false, timeRemaining: () => 50 })
        }
      })
      assert.ok((await preview.count()) > 0, 'Idle constructs the inactive copy')
    }
    if (trigger === 'layers') {
      await page.getByRole('tab', { name: 'Lager', exact: true }).click()
      assert.ok((await preview.count()) > 0, 'Layers constructs the inactive copy before idle')
      assert.equal(
        await page.locator('.cms-editor-canvas').getAttribute('data-cms-about-preview-ready'),
        'true',
      )
      await page.getByRole('tab', { name: 'Design', exact: true }).click()
    }
    await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      globalThis.cmsAboutOwner = cmsGrapes.editors
        .at(-1)
        .getWrapper()
        .find('[data-knc-surface="about"]')[0]
    })
    const work = await page.evaluate(
      () => globalThis.performance.getEntriesByName('cms:startup:work').length,
    )
    assert.ok(work >= 5, 'Startup is split into separately timed passes')
    let firstSwitch = true
    for (const name of ['Mobil', 'Dator', 'EN', 'Mobil', 'SV', 'Dator', 'Mörk', 'Ljus']) {
      await page.getByRole('button', { name, exact: true }).click()
      const device = ['Mobil'].includes(name) ? 'mobile' : name === 'Dator' ? 'desktop' : null
      if (device)
        await frame
          .locator(`[data-knc-surface="${device}-home"] [data-knc-surface="about"]`)
          .waitFor()
      if (name === 'Mobil') {
        assert.ok(
          (await preview.count()) > 0,
          'First switch constructs the preview before moving ownership',
        )
      }
      if (name === 'Mobil' && firstSwitch) {
        assert.equal(
          await page.evaluate(async () => {
            const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
            return (
              globalThis.cmsAboutOwner ===
              cmsGrapes.editors.at(-1).getWrapper().find('[data-knc-surface="about"]')[0]
            )
          }),
          true,
        )
        firstSwitch = false
      }
    }
    // Subsequent language/theme imports retain both trees for the existing model update path.
    const ids = await preview.evaluateAll((nodes) => nodes.map((node) => node.id).sort())
    assert.ok(ids.length > 0, 'The inactive copy survives language and theme changes')
    assert.equal(new Set(ids).size, ids.length, 'Preview identities are unique')
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await page.getByRole('button', { name: 'Dator', exact: true }).click()
    assert.deepEqual(await preview.evaluateAll((nodes) => nodes.map((node) => node.id).sort()), ids)
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/, { timeout: 45000 })
    assert.equal(
      Buffer.compare(Buffer.from(JSON.stringify(backend.document)), before),
      0,
      'Device/language/theme changes and idle previews preserve every adopted document byte',
    )
  })
}

test('inactive About stays absent until idle and idle does not swallow a pending owner edit', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await holdAboutIdle(page)
  await openAdoptedFixture(page, context)
  const frame = page.frameLocator('.gjs-frame').first()
  assert.equal(await frame.locator('[id^="preview-shared-"]').count(), 0)
  await page.waitForFunction(() => globalThis.cmsIdleCallbacks.size > 0)
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const about = editor.getWrapper().find('[data-knc-surface="about"]')[0]
    about.find('h2')[0].components('Owner edit before idle')
    for (const [key, callback] of globalThis.cmsIdleCallbacks) {
      globalThis.cmsIdleCallbacks.delete(key)
      callback({ didTimeout: false, timeRemaining: () => 50 })
    }
  })
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await frame
    .locator('[data-knc-surface="mobile-home"] [data-knc-surface="about"]')
    .getByText('Owner edit before idle', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByRole('button', { name: 'SV', exact: true }).click()
  await frame
    .locator('[data-knc-surface="about"]')
    .getByText('Owner edit before idle', { exact: true })
    .waitFor()
})
test('cms-composition-roundtrip', async ({ page }) => {
  const base = harnessOrigin
  assert.equal(new URL(base).hostname, '127.0.0.1')
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
      await import('/src/admin/cms/composedCanvas.ts')
    const shared = 'section{box-sizing:border-box}@media(min-width:769px){h2{line-height:1.3}}'
    const make = (path, html, css) => ({
      id: path,
      path,
      kind: 'page',
      name: { sv: path, en: path },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: {
        sv: { html, css: { light: css, dark: css } },
        en: { html, css: { light: css, dark: css } },
      },
    })
    const document = emptyDocument()
    const home = make(
      '/',
      '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>',
      shared,
    )
    const about = make(
      '/about',
      '<div data-knc-native="1"><section data-knc-surface="about" id="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2></section></div>',
      shared,
    )
    document.presentation.pages = [home, about]
    const initial = composedCanvas(home, document.presentation, 'sv', 'light')
    const repeatedSharedRules = initial.css.split('section{box-sizing:border-box}').length - 1
    const lengths = []
    for (let i = 0; i < 8; i++) {
      const canvas = composedCanvas(
        home,
        document.presentation,
        'sv',
        'light',
        'default',
        i % 2 ? 'Mobile' : 'Desktop',
      )
      canvas.css += `#about-heading{font-size:${20 + i}px}`
      const extracted = extractComposedAbout(canvas.html, canvas.css, about.content.sv.html)
      const stripped = stripComposedCanvas(canvas.html, canvas.css)
      home.content.sv = { html: stripped.html, css: { light: stripped.css, dark: shared } }
      about.content.sv = { html: extracted.html, css: { light: extracted.css, dark: shared } }
      lengths.push([stripped.css.length, extracted.css.length])
    }
    const canvas = composedCanvas(home, document.presentation, 'sv', 'light')
    canvas.css += '#home-heading,#about-heading{color:purple}'
    const homeCss = stripComposedCanvas(canvas.html, canvas.css).css
    const host = globalThis.document.createElement('div')
    const style = globalThis.document.createElement('style')
    style.textContent = homeCss
    const title = globalThis.document.createElement('h1')
    title.id = 'home-heading'
    title.textContent = 'Home'
    host.append(style, title)
    globalThis.document.body.append(host)
    const homeColor = globalThis.getComputedStyle(host.querySelector('h1')).color
    host.remove()
    return { lengths, homeColor, repeatedSharedRules, aboutCss: about.content.sv.css.light }
  })
  console.log(JSON.stringify({ roundtripLengths: result.lengths, homeColor: result.homeColor }))
  assert.equal(
    result.repeatedSharedRules,
    1,
    'Home must not import identical shared styles for each About preview',
  )
  assert.ok(
    result.lengths.every(([home, about]) => home < 2000 && about < 2000),
    'Repeated unified edits must not amplify shared styles exponentially',
  )
  assert.equal(
    result.homeColor,
    'rgb(128, 0, 128)',
    'Splitting a mixed selector must retain the Home part',
  )
  assert.match(result.aboutCss, /font-size:27px/)
  console.log('PASS Home/About composition: bounded roundtrips and mixed-selector ownership')
})
