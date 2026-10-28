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
        '<div id="holder"><div id="card">Card</div><div id="important">Important</div><div id="anonymous">Anonymous</div><div id="conditioned">Conditioned</div><div id="nested">Nested</div><div id="mixed">Mixed</div><div id="uppercase">Uppercase</div><div id="nested-conditions">Conditions</div><div id="container-case">Container</div><div id="editable">Editable</div><div id="margin">Margin</div><div id="animated">Animated</div><div id="prefixed">Prefixed</div></div>',
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
      '@media(min-width:1000px){#editable{width:25%}}' +
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
      editor.Css.getAll().reset(parsed)
      await new Promise((resolve) => view.requestAnimationFrame(resolve))
      const before = snapshot()
      const serialized = readCanvasCss(editor)
      validateMarkup('', serialized, policy)
      const restored = parseCanvasCss(serialized, editor)
      editor.Css.getAll().reset(restored)
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

test('resize cascade primitive resolves variables and layers without exporting probes', async ({
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { connectCanvasStyles, readCanvasCss, parseCanvasCss } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const editor = cmsGrapes.init({
      container: host,
      storageManager: false,
      cssIcons: '',
      telemetry: false,
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
    const releaseStyles = connectCanvasStyles(editor)
    await new Promise((resolve) => editor.on('load', resolve))
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
        '&:where(#probe-card)': {
          '@media(min-width:769px)': {
            '&': { width: '56%!important' },
          },
        },
      })
      const beforeReload = card.getBoundingClientRect().width
      const serialized = readCanvasCss(editor)
      validateMarkup('', serialized, {
        siteOrigin: globalThis.location.origin,
        storageOrigin: 'https://storage.example.test',
      })
      const parserEvents = []
      let parserInput = 'raw'
      const recordParse = ({ input, output, error }) => {
        parserEvents.push({
          kind: parserInput,
          input,
          definitions: output.length,
          error: error && { message: error.message, stack: error.stack },
        })
      }
      let parsed
      editor.on('parse:css', recordParse)
      try {
        editor.Parser.parseCss(serialized)
        parserInput = 'plain-nesting-control'
        editor.Parser.parseCss(
          '#holder{width:800px}@media(min-width:1000px){#probe-card{width:70%!important;:where(&):is(#probe-card):where(#probe-card){width:56%!important}}}',
        )
        parserInput = 'nested-media-control'
        editor.Parser.parseCss('#probe-card{@media(min-width:769px){:is(&){width:56%!important}}}')
        parserInput = 'masked-helper'
        parsed = parseCanvasCss(serialized, editor)
      } finally {
        editor.off('parse:css', recordParse)
      }
      editor.Css.getAll().reset(globalThis.structuredClone(parsed))
      const afterReload = card.getBoundingClientRect().width
      const inspectReload = () => ({
        css: readCanvasCss(editor),
        holderWidth: doc.getElementById('holder')?.getBoundingClientRect().width,
        cardWidth: doc.getElementById('probe-card')?.getBoundingClientRect().width,
        rules: editor.Css.getAll().toJSON(),
        mounted: [...doc.styleSheets].map((sheet) =>
          [...sheet.cssRules].map((rule) => rule.cssText).join(''),
        ),
      })
      const immediate = inspectReload()
      await new Promise((resolve) =>
        view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)),
      )
      const settled = inspectReload()
      // Match the editor's structural import order as a separate diagnostic. A CSS-only
      // collection reset above must still retain the same declarations and geometry.
      const html = editor.getHtml()
      editor.setComponents('')
      editor.Css.getAll().reset(globalThis.structuredClone(parsed))
      editor.setComponents(html)
      const structural = inspectReload()
      return {
        samples,
        beforeReload,
        afterReload,
        serialized,
        parserEvents,
        parsed,
        immediate,
        settled,
        structural,
      }
    } finally {
      // ClassTagsView debounces style/device updates by one task. Let that work finish
      // before destroy removes its selected-component model.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
      releaseStyles()
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
  assert.equal(result.settled.cardWidth, 448)
  assert.equal(result.structural.cardWidth, 448)
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
