import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { generate, parse, walk } from 'css-tree'
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
    const { connectCanvasStyles, parseCanvasSheet, parseCanvasCss, yieldCanvasTask } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { bindCmsRootStyles } = await import('/src/admin/cms/cmsRootStyles.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
    })
    const releaseStyles = connectCanvasStyles(editor)
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
    try {
      const css =
        'html body{padding:var(--space,10px 20px);--owner:var(--x,one two);color:red!important}@media(max-width:768px){#about{width:calc(100% - 4px)}}'
      const tree = parseCanvasSheet(css)
      const bound = bindCmsRootStyles(tree, 'editor-root')
      const fromTree = parseCanvasCss(bound, editor)
      const fromText = parseCanvasCss(bindCmsRootStyles(css, 'editor-root'), editor)
      const repeated = parseCanvasCss(bound, editor)
      const nestedCss =
        '#safe{width:10px;@layer{&{width:20px}}@layer{&{width:30px}}width:40px;@media(min-width:769px){@supports(display:grid){@container(min-width:100px){&{width:56%!important}}}}& __proto__{color:red}& constructor{color:blue}}'
      validateMarkup('', nestedCss, {
        siteOrigin: globalThis.location.origin,
        storageOrigin: 'https://storage.example.test',
      })
      const nestedTree = parseCanvasSheet(nestedCss)
      const nested = parseCanvasCss(nestedTree, editor)
      const nestedRepeated = parseCanvasCss(nestedTree, editor)
      const nestedFromText = parseCanvasCss(nestedCss, editor)
      const ownStyle = nested[0].style
      const safePrototype =
        Object.getPrototypeOf(ownStyle) === null &&
        !Object.hasOwn(ownStyle, '__proto__') &&
        !Object.hasOwn(ownStyle, 'constructor') &&
        !Object.hasOwn(Object.prototype, 'width')
      const beforeFailedImport = JSON.stringify(editor.getProjectData())
      const rejectedLoss = []
      for (const unsupported of [
        'p:--unsupported-cms-selector{width:12px}',
        '#safe{@layer{width:20px}}',
        '#safe{:where(&){width:20px}}',
      ]) {
        try {
          parseCanvasCss(unsupported, editor)
          rejectedLoss.push(false)
        } catch {
          rejectedLoss.push(true)
        }
      }
      const failureUnchanged = beforeFailedImport === JSON.stringify(editor.getProjectData())
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
      return {
        fromTree,
        fromText,
        repeated,
        sameTree: bound === tree,
        nested,
        nestedRepeated,
        nestedFromText,
        safePrototype,
        rejectedLoss,
        failureUnchanged,
        schedulerCalls,
        inputRan,
      }
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor)
      else delete globalThis.scheduler
      releaseStyles()
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
  assert.deepEqual(result.nestedRepeated, result.nested, 'Nested masking keeps the prepared tree')
  assert.deepEqual(result.nestedFromText, result.nested, 'Text and prepared-tree imports agree')
  assert.deepEqual(Object.keys(result.nested[0].style), [
    'width',
    '@layer',
    '@layer ',
    'width ',
    '@media (min-width:769px)',
    '& __proto__',
    '& constructor',
  ])
  assert.equal(result.nested[0].style['@layer']['&'].width, '20px')
  assert.equal(result.nested[0].style['@layer ']['&'].width, '30px')
  assert.equal(result.nested[0].style['width '], '40px')
  assert.equal(
    result.nested[0].style['@media (min-width:769px)']['@supports (display:grid)'][
      '@container (min-width:100px)'
    ]['&'].width,
    '56% !important',
  )
  assert.equal(result.safePrototype, true)
  assert.deepEqual(
    result.rejectedLoss,
    [true, true, true],
    'Unsupported syntax must fail before importing models',
  )
  assert.equal(result.failureUnchanged, true)
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

test('canvas style imports retain layer precedence, root selectors and declaration order', async ({
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, parseCanvasCss, parseCanvasSheet, readCanvasCss } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      avoidInlineStyle: true,
      selectorManager: { componentFirst: true },
      components:
        '<div id="holder"><div id="card">Card</div><div id="important">Important</div><div id="anonymous">Anonymous</div><div id="conditioned">Conditioned</div><div id="nested">Nested</div><div id="mixed">Mixed</div><div id="uppercase">Uppercase</div><div id="nested-conditions">Conditions</div><div id="container-case">Container</div><div id="editable">Editable</div><div id="priority-order">Priority order</div><div id="margin">Margin</div><div id="animated">Animated</div><div id="prefixed">Prefixed</div></div>',
    })
    const releaseStyles = connectCanvasStyles(editor)
    await new Promise((resolve) => editor.on('load', resolve))
    const doc = editor.Canvas.getDocument()
    const view = doc.defaultView
    const css =
      '#holder{width:800px;container-type:inline-size}' +
      '@layer overrides,base;' +
      '@layer base{#card{width:70%}#important{width:70%!important}}' +
      '@layer overrides{#card{width:40%}#important{width:40%!important}}' +
      '@layer{#anonymous{width:70%!important}}@layer{#anonymous{width:40%!important}}' +
      '@supports(display:block){@layer{#conditioned{width:70%!important}}@layer{#conditioned{width:40%!important}}}' +
      '#nested{@layer ordered.overrides,ordered.base;@layer ordered.base{&{width:70%}}@layer ordered.overrides{&{width:40%}}}' +
      '@media(min-width:1000px){#mixed{width:70%}}@media(min-width:769px){@layer mixed.base;#mixed{width:50%}}' +
      '@LAYER caps{@MEDIA(min-width:769px){#uppercase{width:25%}}}' +
      '@MEDIA(min-width:769px){@SUPPORTS(display:grid){#nested-conditions{width:35%}}}' +
      '@media(min-width:769px){@supports(display:cms-unsupported-layout){#nested-conditions{width:95%}}}' +
      '@media(min-width:769px){@container(min-width:700px){#container-case{width:45%}}}' +
      '@media(min-width:769px){@container(min-width:900px){#container-case{width:95%}}}' +
      '@media(min-width:1000px){#editable{width:25%;justify-self:end;@supports(display:grid){&.active{width:60%}}@layer owner{&.active{width:70%}}}}' +
      '#priority-order{width:70%;zoom:2;all:initial!important;@media(min-width:769px){&{width:80%!important;zoom:.8!important}}display:block!important;height:40px!important}' +
      '#margin{margin-left:1px;margin:2px;margin-left:3px}' +
      '@layer roots{html{--owner-layer-root:present}html body{padding-left:17px}body::before{content:"owner"}}' +
      '@KEYFRAMES owner-motion{from{opacity:.2}50%{opacity:.5}to{opacity:.8}}' +
      '@-webkit-keyframes owner-prefixed{0%{opacity:.1}100%{opacity:.9}}' +
      '#animated{animation:owner-motion 10s linear paused;animation-delay:-5s}' +
      '#prefixed{animation:owner-prefixed 10s linear paused;animation-delay:-5s}' +
      '#unused-owner{width:123px}'
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.example.test',
    }
    validateMarkup('', css, policy)
    const tree = parseCanvasSheet(css)
    const parsed = parseCanvasCss(tree, editor)
    const snapshot = () => {
      const widths = Object.fromEntries(
        [
          'card',
          'important',
          'anonymous',
          'conditioned',
          'nested',
          'mixed',
          'uppercase',
          'nested-conditions',
          'container-case',
          'editable',
          'priority-order',
        ].map((id) => [id, doc.getElementById(id).getBoundingClientRect().width]),
      )
      const margin = view.getComputedStyle(doc.getElementById('margin'))
      return {
        widths,
        margins: [margin.marginTop, margin.marginRight, margin.marginBottom, margin.marginLeft],
        root: view
          .getComputedStyle(doc.documentElement)
          .getPropertyValue('--owner-layer-root')
          .trim(),
        bodyPadding: view.getComputedStyle(doc.body).paddingLeft,
        pseudoContent: view.getComputedStyle(doc.body, '::before').content,
        opacity: ['animated', 'prefixed'].map((id) =>
          Number(view.getComputedStyle(doc.getElementById(id)).opacity),
        ),
        frames: Object.fromEntries(
          [...doc.styleSheets].flatMap((sheet) =>
            [...sheet.cssRules].flatMap((rule) =>
              ['owner-motion', 'owner-prefixed'].includes(rule.name)
                ? [[rule.name, [...rule.cssRules].map((frame) => frame.keyText)]]
                : [],
            ),
          ),
        ),
      }
    }
    try {
      editor.Css.getAll().reset(globalThis.structuredClone(parsed))
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const before = snapshot()
      const serialized = readCanvasCss(editor)
      validateMarkup('', serialized, policy)
      const restored = parseCanvasCss(serialized, editor)
      editor.Css.getAll().reset(globalThis.structuredClone(restored))
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const after = snapshot()
      const editable = editor.Css.getAll().models.find(
        (rule) => rule.selectorsToString() === '#editable' && rule.get('atRuleType') === 'media',
      )
      editable.addStyle({ width: '32%' })
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const editedWidth = doc.getElementById('editable').getBoundingClientRect().width
      editable.addStyle({ width: '25%' })
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const exported = readCanvasCss(editor)
      const styleElements = editor.Css.getAll()
        .models.filter((rule) => !rule.isNested())
        .map((rule) => rule.getView().el)
      const moved = []
      const observer = new view.MutationObserver((records) => {
        for (const record of records)
          for (const node of [...record.addedNodes, ...record.removedNodes])
            if (styleElements.includes(node)) moved.push(node.nodeName)
      })
      observer.observe(doc.body, { childList: true })
      const modelBefore = JSON.stringify(editor.getProjectData())
      const historyBefore = editor.UndoManager.getStack().length
      const dirtyBefore = editor.getDirtyCount()
      editor.trigger('css:mount')
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      observer.disconnect()
      const passive = {
        moved,
        model: modelBefore === JSON.stringify(editor.getProjectData()),
        history: historyBefore === editor.UndoManager.getStack().length,
        dirty: dirtyBefore === editor.getDirtyCount(),
        export: exported === readCanvasCss(editor),
        elements: styleElements.every((element) => element.isConnected),
      }
      editor.select(editor.Components.getById('card'))
      editor.getSelectedToStyle()
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      return {
        before,
        after,
        serialized,
        passive,
        editedWidth,
        stableExport: exported === readCanvasCss(editor),
        stableTree: JSON.stringify(parseCanvasCss(tree, editor)) === JSON.stringify(parsed),
      }
    } finally {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      releaseStyles()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('nested-style-roundtrip', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  const expected = {
    widths: {
      card: 560,
      important: 320,
      anonymous: 560,
      conditioned: 560,
      nested: 560,
      mixed: 400,
      uppercase: 200,
      'nested-conditions': 280,
      'container-case': 360,
      editable: 200,
      'priority-order': 640,
    },
    margins: ['2px', '2px', '2px', '3px'],
    root: 'present',
    bodyPadding: '17px',
    pseudoContent: '"owner"',
    opacity: [0.5, 0.5],
    frames: {
      'owner-motion': ['0%', '50%', '100%'],
      'owner-prefixed': ['0%', '100%'],
    },
  }
  assert.deepEqual(result.before, expected)
  assert.deepEqual(result.after, expected)
  assert.equal(result.stableExport, true, 'Selecting an empty style target must not change export')
  assert.equal(result.stableTree, true)
  assert.equal(result.editedWidth, 256, 'Ordinary media rules retain their editing model')
  assert.deepEqual(result.passive, {
    moved: [],
    model: true,
    history: true,
    dirty: true,
    export: true,
    elements: true,
  })
  assert.ok(result.serialized.includes('#unused-owner{width:123px;}'))
  assert.deepEqual(pageErrors, [])
})

test('complex selector functions keep their ancestor constraint through production import', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, parseCanvasCss, readCanvasCss } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { planDesktopCardResize } = await import('/src/admin/cms/resizeStyles.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      avoidInlineStyle: true,
      components:
        '<div id="complex-holder"><section class="owner"><div id="inside-a" class="a">A</div><div id="inside-b" class="b">B</div><div id="inside-c" class="c">C</div></section><div id="outside-b" class="b">Outside</div><div id="--cms-internal-selector-0">Owner ID</div></div>',
      deviceManager: { devices: [{ id: 'Desktop', width: '1440px', widthMedia: '769px' }] },
    })
    const release = connectCanvasStyles(editor)
    await new Promise((resolve) => editor.on('load', resolve))
    const doc = editor.Canvas.getDocument()
    const view = doc.defaultView
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.example.test',
    }
    const source =
      '#complex-holder{width:600px}.owner{width:400px}.owner :is(.a,.b,.c){width:150px}#--cms-internal-selector-0{width:175px}'
    validateMarkup('', source, policy)
    const measure = () =>
      ['inside-a', 'inside-b', 'inside-c', 'outside-b', '--cms-internal-selector-0'].map(
        (id) => doc.getElementById(id).getBoundingClientRect().width,
      )
    try {
      editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(source, editor)))
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const before = measure()
      const exported = readCanvasCss(editor)
      validateMarkup('', exported, policy)
      editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(exported, editor)))
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const restored = measure()
      const plan = planDesktopCardResize(editor, [editor.Components.getById('inside-b')], 0.8)
      plan.apply()
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const resized = measure()
      const finalCss = readCanvasCss(editor)
      validateMarkup('', finalCss, policy)
      return {
        before,
        restored,
        resized,
        exported,
        finalCss,
        ownerIdWidth: editor.Css.getIdRule('--cms-internal-selector-0', {
          mediaText: '',
        })?.getStyle()['width'],
      }
    } finally {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      release()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('complex-selector-import', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(result.before, [150, 150, 150, 600, 175])
  assert.deepEqual(result.restored, result.before)
  assert.deepEqual(result.resized, [150, 120, 150, 600, 175])
  assert.ok(result.exported.includes('.owner :is(.a,.b,.c)'))
  assert.ok(result.finalCss.includes('.owner :is(.a,.b,.c)'))
  assert.equal(
    result.ownerIdWidth,
    '175px',
    'An admitted owner selector ID remains distinct from a temporary property marker',
  )
  walk(parse(result.finalCss), (node) => {
    if (node.type === 'Declaration') assert.ok(!node.property.startsWith('--cms-internal-'))
  })
  assert.deepEqual(errors, [])
})

test('resize styles use the native cascade and survive production import without probe state', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, readCanvasCss, parseCanvasCss } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { planDesktopCardResize } = await import('/src/admin/cms/resizeStyles.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      avoidInlineStyle: true,
      selectorManager: { componentFirst: true },
      components:
        '<div id="holder" class="owner"><div id="probe-card" class="card">Card</div><div id="percent-parent"><div id="percent-inherit">Percent</div></div><div id="relative-parent"><div id="relative-inherit">Relative</div></div><div id="all-card">Reset</div><div id="ignored-card">Ignored</div><div id="invalid-card">Invalid var</div><div id="layer-holder"><div id="container-card" class="container-card">Container</div></div><div id="ordered-card">Ordered</div></div>',
      deviceManager: {
        devices: [
          { id: 'Wide', width: '1440px' },
          { id: 'Narrow', width: '820px' },
        ],
      },
    })
    const releaseStyles = connectCanvasStyles(editor)
    await new Promise((resolve) => editor.on('load', resolve))
    const doc = editor.Canvas.getDocument()
    const view = doc.defaultView
    const css =
      '#holder{width:800px;font-size:20px}' +
      '@layer base,overrides;' +
      '@layer base{.owner .card,#unmatched{--owner-card-width:70%;width:var(--owner-card-width,60%);@supports(display:grid){&.special{width:80%}}}}' +
      '@layer overrides{#probe-card{width:revert-layer}}' +
      '@layer base{#layer-holder{width:200px;container-type:inline-size}}' +
      '@layer overrides{#layer-holder{width:400px}@container(min-width:300px){.container-card{width:70%}}}' +
      '@media(min-width:1000px){#probe-card{width:var(--owner-card-width,60%)!important}}' +
      '#percent-parent{width:70%}#percent-inherit{width:inherit;font-size:10px}' +
      '#relative-parent{font-size:20px;width:8em}#relative-inherit{font-size:10px;width:inherit}' +
      '#all-card{width:70%;zoom:2;all:initial!important;display:block!important;height:40px!important}' +
      '#ignored-card{width:70%;width:-1px!important}' +
      '#invalid-card{--invalid-width:unsupported;width:70%;width:var(--invalid-width)}' +
      '#ordered-card{width:70%;&.inactive{color:red}}' +
      '@media(min-width:1000px){#ordered-card{width:90%}}'
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.example.test',
    }
    validateMarkup('', css, policy)
    editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(css, editor)))
    const ids = [
      'probe-card',
      'percent-inherit',
      'relative-inherit',
      'all-card',
      'ignored-card',
      'invalid-card',
      'container-card',
      'ordered-card',
    ]
    const components = ids.map((id) => editor.Components.getById(id))
    const measure = () => ids.map((id) => doc.getElementById(id).getBoundingClientRect().width)
    const settle = async (device, width) => {
      editor.setDevice(device)
      const deadline = globalThis.performance.now() + 5000
      let stable = 0
      while (stable < 2) {
        await new Promise((resolve) => view.requestAnimationFrame(resolve))
        stable =
          view.innerWidth === width &&
          Math.abs(editor.Canvas.getFrameEl().getBoundingClientRect().width - width) < 0.01
            ? stable + 1
            : 0
        if (globalThis.performance.now() > deadline)
          throw new Error(`Viewport did not settle at ${width}px`)
      }
    }
    const samples = []
    try {
      for (const [device, width] of [
        ['Narrow', 820],
        ['Wide', 1440],
        ['Narrow', 820],
      ]) {
        await settle(device, width)
        editor.clearDirtyCount()
        const model = JSON.stringify(editor.getProjectData())
        const exported = readCanvasCss(editor)
        const history = editor.UndoManager.getStack().length
        const before = measure()
        const plan = planDesktopCardResize(editor, components, 0.8)
        const passive = {
          model: model === JSON.stringify(editor.getProjectData()),
          export: exported === readCanvasCss(editor),
          history: history === editor.UndoManager.getStack().length,
          dirty: editor.getDirtyCount(),
          probes: [...doc.querySelectorAll('style')].some((style) =>
            style.textContent.includes('--cms-internal-resize-'),
          ),
        }
        plan.apply()
        await new Promise((resolve) => view.requestAnimationFrame(resolve))
        const after = measure()
        const serialized = readCanvasCss(editor)
        validateMarkup('', serialized, policy)
        editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(serialized, editor)))
        await new Promise((resolve) => view.requestAnimationFrame(resolve))
        const restored = measure()
        samples.push({ device, before, after, restored, passive, measurements: plan.measurements })
      }
      const serialized = readCanvasCss(editor)
      const card = doc.getElementById('probe-card')
      card.classList.add('special')
      const laterConditionalWidth = card.getBoundingClientRect().width
      card.classList.remove('special')
      doc.getElementById('holder').classList.remove('owner')
      const unmatchedWidth = card.getBoundingClientRect().width
      const model = JSON.stringify(editor.getProjectData())
      const exported = readCanvasCss(editor)
      const history = editor.UndoManager.getStack().length
      const original = components.at(-1).getEl
      let rejected = false
      try {
        components.at(-1).getEl = () => undefined
        planDesktopCardResize(editor, components, 0.8)
      } catch {
        rejected = true
      } finally {
        components.at(-1).getEl = original
      }
      return {
        samples,
        serialized,
        laterConditionalWidth,
        unmatchedWidth,
        failure: {
          rejected,
          model: model === JSON.stringify(editor.getProjectData()),
          export: exported === readCanvasCss(editor),
          history: history === editor.UndoManager.getStack().length,
          probes: [...doc.querySelectorAll('style')].some((style) =>
            style.textContent.includes('--cms-internal-resize-'),
          ),
        },
      }
    } finally {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      releaseStyles()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('resize-native-cascade', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  for (const sample of result.samples) {
    assert.deepEqual(sample.passive, {
      model: true,
      export: true,
      history: true,
      dirty: 0,
      probes: false,
    })
    for (const [index, width] of sample.after.entries()) {
      assert.ok(
        Math.abs(width / sample.before[index] - 0.8) < 0.015,
        `${sample.device} card ${index}: ${JSON.stringify(sample)}`,
      )
      assert.ok(
        Math.abs(sample.restored[index] - width) < 0.1,
        `Production reimport retains card ${index}`,
      )
    }
  }
  assert.equal(
    result.samples[0].measurements[1].width,
    '70%',
    'Inherited percentages retain native computed-value semantics',
  )
  assert.equal(
    result.samples[0].measurements[2].width,
    '160px',
    'Inherited em widths compute in the parent font context',
  )
  assert.equal(
    result.samples[0].before[6],
    280,
    'Branch probes preserve the original layer order and active container',
  )
  assert.equal(
    result.samples[1].before[7],
    720,
    'A later equal-specificity owner rule remains later when its viewport activates',
  )
  assert.ok(
    Math.abs(result.laterConditionalWidth - 640) < 0.1,
    'Later owner conditions keep their source order and selector specificity',
  )
  assert.ok(
    Math.abs(result.unmatchedWidth - 800) < 0.1,
    'A targeted override stops matching when its ancestor selector stops matching',
  )
  assert.ok(result.serialized.includes('--owner-card-width:70%'))
  assert.ok(result.serialized.includes('width:var(--owner-card-width,60%)'))
  assert.ok(!result.serialized.includes('--cms-internal-resize-'))
  assert.ok(
    (result.serialized.match(/:where\(#probe-card\)/g)?.length ?? 0) <= 3,
    'Repeated resizes update existing targeted declarations instead of nesting another override per event',
  )
  assert.deepEqual(result.failure, {
    rejected: true,
    model: true,
    export: true,
    history: true,
    probes: false,
  })
  assert.deepEqual(errors, [])
})

test('resize controls use current viewport geometry before deferred selection capture', async ({
  page,
}) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, parseCanvasCss, readCanvasCss } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { connectHierarchicalResize } = await import('/src/admin/cms/hierarchicalResize.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      avoidInlineStyle: true,
      mediaCondition: 'min-width',
      selectorManager: { componentFirst: true },
      components:
        '<div id="quick-group" data-knc-fold="barber-marquee" data-knc-source="quick-group">' +
        [0, 1, 2, 3]
          .map((index) => `<div id="quick-${index}" data-knc-source="quick-${index}">Card</div>`)
          .join('') +
        '</div>',
      deviceManager: { devices: [{ id: 'Desktop', width: '1440px', widthMedia: '769px' }] },
    })
    const releaseStyles = connectCanvasStyles(editor)
    const releaseResize = connectHierarchicalResize(
      editor,
      () => false,
      () => 'light',
    )
    await new Promise((resolve) => editor.on('load', resolve))
    const frame = editor.Canvas.getFrameEl()
    const view = frame.contentWindow
    try {
      editor.Css.getAll().reset(
        globalThis.structuredClone(
          parseCanvasCss(
            '#quick-group{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}' +
              '#quick-group>div{height:100px}' +
              '@media(max-width:1000px){#quick-group{grid-template-columns:repeat(2,minmax(0,1fr))}}',
            editor,
          ),
        ),
      )
      editor.setDevice('Desktop')
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const group = editor.Components.getById('quick-group')
      const cards = group.components().models
      const read = () =>
        cards.map((card) => {
          const rect = card.getEl().getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })
      const attempts = []
      // Each change stays in this task: the iframe's resize event and the parent
      // capture RAF cannot run between selection, the new viewport and the control.
      for (const [component, width, axis] of [
        [group, 820, 'height'],
        [group, 1440, 'height'],
        [cards[0], 820, 'width'],
      ]) {
        editor.select(component)
        frame.parentElement.style.transition = 'none'
        editor.Canvas.getFrame().set({ width: `${width}px` }, { noUndo: 1 })
        // FrameWrapView applies this exact style from a zero-delay debounced listener.
        // Apply its pending DOM width now so input can precede that listener/resize RAF.
        frame.parentElement.style.width = `${width}px`
        const frameWidth = frame.getBoundingClientRect().width
        if (view.innerWidth !== width || Math.abs(frameWidth - width) > 0.01)
          throw new Error(`The fixture viewport did not change: ${view.innerWidth}/${frameWidth}`)
        const rect = component.getEl().getBoundingClientRect()
        const before = read()
        editor.getSelectedToStyle().addStyle({ [axis]: `${Math.round(rect[axis] * 0.8)}px` })
        attempts.push({ width, axis, before, after: read() })
      }
      editor.select(cards[0])
      cards[0].addStyle({ width: '75%' })
      const before = read()
      const rect = cards[0].getEl().getBoundingClientRect()
      editor.getSelectedToStyle().addStyle({ height: `${Math.round(rect.height * 0.8)}px` })
      attempts.push({ width: 820, axis: 'height', before, after: read() })
      return { attempts, ownerWidth: cards[0].getStyle().width, css: readCanvasCss(editor) }
    } finally {
      releaseResize()
      // GrapesJS schedules its selection/property refresh with a zero-delay debounce.
      // Drain it while the editor is alive before releasing its selected collection.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      releaseStyles()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('resize-current-viewport', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  for (const attempt of result.attempts)
    for (const [index, after] of attempt.after.entries()) {
      assert.ok(
        Math.abs(after.width / attempt.before[index].width - 0.8) < 0.02,
        `Current ${attempt.width}px ${attempt.axis} width: ${JSON.stringify(attempt)}`,
      )
      assert.ok(
        Math.abs(after.height / attempt.before[index].height - 0.8) < 0.02,
        `Current ${attempt.width}px ${attempt.axis} height: ${JSON.stringify(attempt)}`,
      )
    }
  assert.equal(
    result.ownerWidth,
    '75%',
    'Pre-proposal width replaces the earlier selection snapshot',
  )
})

test('native dimension edits materialize inactive owner priorities before export and remount', async ({
  page,
}) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, parseCanvasCss, readCanvasCss, nativeCanvas, exportNativeCanvas } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { planDesktopCardResize } = await import('/src/admin/cms/resizeStyles.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      avoidInlineStyle: true,
      selectorManager: { componentFirst: true },
      components:
        '<div id="native-holder" data-knc-native="1"><div id="native-card" data-knc-baseline="{}" data-knc-light="height:100px"></div><div id="native-token" class="owner-token" data-knc-baseline="{}" data-knc-light="height:100px"></div><div id="native-untargeted" data-knc-baseline="{}" data-knc-light="height:100px"></div></div>',
      deviceManager: {
        devices: [
          { id: 'Wide', width: '1440px' },
          { id: 'Narrow', width: '820px' },
        ],
      },
    })
    const releaseStyles = connectCanvasStyles(editor)
    await new Promise((resolve) => editor.on('load', resolve))
    const view = editor.Canvas.getDocument().defaultView
    const cards = ['native-card', 'native-token'].map((id) => editor.Components.getById(id))
    const read = () =>
      cards.map((card) => {
        const rect = card.getEl().getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    const settle = async (device, width) => {
      editor.setDevice(device)
      const deadline = globalThis.performance.now() + 5000
      while (view.innerWidth !== width) {
        await new Promise((resolve) => view.requestAnimationFrame(resolve))
        if (globalThis.performance.now() > deadline) throw new Error('Viewport did not settle')
      }
    }
    try {
      editor.Css.getAll().reset(
        globalThis.structuredClone(
          parseCanvasCss(
            '#native-holder{width:800px}#native-holder>div{height:100px}' +
              '#native-card{width:70%;zoom:0.8}' +
              '.owner-token{--owner-card-width:70%;width:var(--owner-card-width)}' +
              '#native-untargeted{width:33%;zoom:0.9;color:blue}' +
              '@media(min-width:1000px){#native-card,#native-token{color:red}#native-card{inline-size:90%;zoom:1.1}#native-token{all:initial;display:block;height:100px}}',
            editor,
          ),
        ),
      )
      await settle('Narrow', 820)
      const before = read()
      const target = editor.Css.getIdRule('native-card', { mediaText: '' })
      planDesktopCardResize(editor, cards, 0.8, {
        target,
        style: target.getStyle('', { withNested: true }),
        mode: 'light',
      }).apply()
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const after = read()
      const live = readCanvasCss(editor)
      await settle('Wide', 1440)
      const wide = read()
      const exported = exportNativeCanvas(editor.getHtml({ cleanId: false }), live, 'light')
      const restored = nativeCanvas(
        { html: exported.html, css: { light: exported.css, dark: exported.css } },
        'light',
      )
      editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(restored.css, editor)))
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const restoredWide = read()
      await settle('Narrow', 820)
      const restoredNarrow = read()
      return { before, after, wide, restoredWide, restoredNarrow, live }
    } finally {
      releaseStyles()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('native-resize-priorities', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  for (const [index, after] of result.after.entries()) {
    assert.ok(Math.abs(after.width / result.before[index].width - 0.8) < 0.015)
    assert.ok(Math.abs(after.height / result.before[index].height - 0.8) < 0.015)
    const expected = [
      { width: 720, height: 110 },
      { width: 800, height: 100 },
    ][index]
    assert.ok(
      Math.abs(result.wide[index].width - expected.width) < 0.1,
      'Inactive logical width or all reset becomes active',
    )
    assert.ok(
      Math.abs(result.wide[index].height - expected.height) < 0.1,
      'Inactive zoom or all reset becomes active',
    )
    assert.ok(Math.abs(result.restoredWide[index].width - result.wide[index].width) < 0.1)
    assert.ok(Math.abs(result.restoredWide[index].height - result.wide[index].height) < 0.1)
    assert.ok(Math.abs(result.restoredNarrow[index].width - after.width) < 0.1)
    assert.ok(Math.abs(result.restoredNarrow[index].height - after.height) < 0.1)
  }
  assert.ok(result.live.includes('--owner-card-width:70%;width:var(--owner-card-width);'))
  const priorities = []
  const untouched = []
  walk(parse(result.live), {
    visit: 'Rule',
    enter(rule) {
      const selector = generate(rule.prelude)
      for (const declaration of rule.block.children)
        if (declaration.type === 'Declaration') {
          if (
            ['#native-card', '#native-token'].includes(selector) &&
            ['width', 'zoom', 'inline-size', 'all'].includes(declaration.property)
          )
            priorities.push(Boolean(declaration.important))
          else if (
            ['.owner-token', '#native-untargeted', '#native-card,#native-token'].includes(selector)
          )
            untouched.push(Boolean(declaration.important))
        }
    },
  })
  assert.ok(priorities.length >= 6)
  assert.ok(
    priorities.every(Boolean),
    'Active and inactive native owner dimensions share persisted priority',
  )
  assert.ok(untouched.length >= 6)
  assert.ok(
    untouched.every((important) => !important),
    'Class, complex and untargeted rules stay authored',
  )
})

test('resize edits underlying styles while paused owner keyframes remain authoritative', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, readCanvasCss, parseCanvasCss, parseCanvasSheet } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { planDesktopCardResize } = await import('/src/admin/cms/resizeStyles.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
      avoidInlineStyle: true,
      selectorManager: { componentFirst: true },
      components:
        '<div id="animation-holder"><div id="animated-card">Edited</div><div id="animation-peer">Other animation user</div></div>',
      deviceManager: { devices: [{ id: 'Desktop', width: '1440px', widthMedia: '769px' }] },
    })
    const release = connectCanvasStyles(editor)
    await new Promise((resolve) => editor.on('load', resolve))
    const doc = editor.Canvas.getDocument()
    const view = doc.defaultView
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.example.test',
    }
    const css =
      '#animation-holder{width:800px}#animated-card,#animation-peer{width:70%;height:40px;zoom:1;animation:owner-size 10s linear paused;animation-delay:-5s}@keyframes owner-size{from{width:100%;zoom:1}to{width:50%;zoom:2}}'
    validateMarkup('', css, policy)
    editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(css, editor)))
    const snapshot = () =>
      ['animated-card', 'animation-peer'].map((id) => {
        const element = doc.getElementById(id)
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height, zoom: view.getComputedStyle(element).zoom }
      })
    const keyframes = () =>
      JSON.stringify(
        parseCanvasSheet(readCanvasCss(editor))
          .children.toArray()
          .find((node) => node.type === 'Atrule' && node.name === 'keyframes'),
      )
    try {
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const before = snapshot()
      const frames = keyframes()
      const plan = planDesktopCardResize(editor, [editor.Components.getById('animated-card')], 0.8)
      plan.apply()
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const active = snapshot()
      const framesUnchanged = frames === keyframes()
      const exported = readCanvasCss(editor)
      validateMarkup('', exported, policy)
      editor.Css.getAll().reset(globalThis.structuredClone(parseCanvasCss(exported, editor)))
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const restored = snapshot()
      const target = editor.Css.getIdRule('animated-card', { mediaText: '' })
      if (!target) throw new Error('The underlying component rule must remain editable')
      target.addStyle({ animation: 'none!important' })
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      return {
        before,
        active,
        restored,
        removed: snapshot(),
        framesUnchanged,
        measurements: plan.measurements,
        probes: readCanvasCss(editor).includes('--cms-internal-resize-'),
      }
    } finally {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      release()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('resize-owner-animation', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(
    result.active,
    result.before,
    'Active owner animation keeps authority over normal dimension edits',
  )
  assert.deepEqual(
    result.restored,
    result.before,
    'Production reimport preserves the paused animation',
  )
  assert.deepEqual(
    result.measurements.map(({ width, zoom }) => ({ width, zoom })),
    [{ width: '70%', zoom: 1 }],
  )
  assert.ok(
    Math.abs(result.removed[0].width - 448) < 0.1,
    'Removing the animation exposes the edited underlying percentage width',
  )
  assert.ok(
    Math.abs(result.removed[0].height - 32) < 0.1,
    'Removing the animation exposes the edited underlying zoom',
  )
  assert.deepEqual(
    result.removed[1],
    result.before[1],
    'Other animation users retain their geometry',
  )
  assert.equal(result.framesUnchanged, true)
  assert.equal(result.probes, false)
  assert.deepEqual(errors, [])
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
