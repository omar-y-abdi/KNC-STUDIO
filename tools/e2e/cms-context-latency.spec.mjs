import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { generate, parse, walk } from 'css-tree'
import { nativeBackend } from './cms-backend.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
test.use({ viewport: { width: 1440, height: 1000 } })

// What a stylesheet declares: each block with its declarations in order and the at-rules and
// selectors around it, as a sorted list. getCss groups rules under one at-rule and keeps a leading
// `& ` that readCanvasCss removes, and canvasRules leaves out empty component rules, so an empty
// rule outside any other rule is no leaf here. Equal lists prove the same declarations in the same
// context, in any order; they do not prove equal bytes or an equal cascade between rules of equal
// specificity.
function styleLeaves(source) {
  const leaves = []
  const enclosing = []
  const declarationsOf = (node) =>
    node.block.children
      .toArray()
      .filter((child) => child.type !== 'Rule' && child.type !== 'Atrule')
      .map((child) => generate(child))
  walk(parse(source), {
    enter(node) {
      if (node.type === 'Atrule') {
        const head = `@${node.name} ${node.prelude ? generate(node.prelude) : ''}`.trim()
        if (node.block) {
          const declarations = declarationsOf(node)
          if (declarations.length > 0)
            leaves.push(JSON.stringify([...enclosing, head, declarations]))
          enclosing.push(head)
        } else leaves.push(JSON.stringify([...enclosing, head]))
      }
      if (node.type === 'Rule') {
        const selector = generate(node.prelude).replace(/^& /, '')
        const nested = enclosing.some((head) => !head.startsWith('@'))
        if (nested || !node.block.children.isEmpty)
          leaves.push(JSON.stringify([...enclosing, selector, declarationsOf(node)]))
        enclosing.push(selector)
      }
    },
    leave(node) {
      if (node.type === 'Rule' || (node.type === 'Atrule' && node.block)) enclosing.pop()
    },
  })
  return leaves.sort()
}

test('cms-context-latency', async ({ page, context, evidenceDir }) => {
  await page.clock.install()
  const base = harnessOrigin
  assert.equal(new URL(base).hostname, '127.0.0.1')
  const out = evidenceDir
  await mkdir(out, { recursive: true })
  const backend = await nativeBackend(context)
  const results = []
  page.setDefaultTimeout(15000)
  const button = (name) => page.getByRole('button', { name, exact: true })
  const measure = async (label, action) => {
    await page.evaluate(() => {
      globalThis.cmsCost = {
        snapshots: 0,
        styleReads: 0,
        creates: 0,
        exports: 0,
        parses: 0,
        cssParses: 0,
        ruleAdds: 0,
      }
    })
    const start = Date.now()
    await action()
    // Include deferred dirty-counter callbacks; assertions use counts, not wall time.
    await page.clock.runFor(250)
    const result = {
      label,
      elapsedMs: Date.now() - start,
      ...(await page.evaluate(() => globalThis.cmsCost)),
    }
    const css = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { readCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
      const editor = cmsGrapes.editors.at(-1)
      return {
        canvas: readCanvasCss(editor),
        exported: editor.getCss({ keepUnusedStyles: true }),
      }
    })
    assert.deepEqual(
      styleLeaves(css.canvas),
      styleLeaves(css.exported),
      `${label}: canvas CSS must match the complete export rule for rule, apart from empty top-level rules and rule order`,
    )
    results.push(result)
    return result
  }
  try {
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
    const initiallySelectable = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      return editor.Commands.isActive(editor.getConfig().defaultCommand)
    })
    assert.equal(
      initiallySelectable,
      true,
      'The first visible device viewport must already accept selections',
    )
    assert.equal(
      await frame.locator('#cms-canvas-behavior').count(),
      1,
      'Preview behavior must survive GrapesJS initial frame/head rendering',
    )
    await button('Publicera').click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    for (const [name, width, height] of [
      ['Mobil', 390, 844],
      ['Dator', 1440, 900],
    ]) {
      await page.evaluate(() => {
        const win = globalThis.document.querySelector('.gjs-frame').contentWindow
        globalThis.deviceSizes = []
        globalThis.recordDeviceSize = () =>
          globalThis.deviceSizes.push([win.innerWidth, win.innerHeight])
        win.addEventListener('resize', globalThis.recordDeviceSize)
      })
      await button(name).click()
      await page.waitForFunction(
        ([width, height]) => {
          const win = globalThis.document.querySelector('.gjs-frame').contentWindow
          return win.innerWidth === width && win.innerHeight === height
        },
        [width, height],
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
          ),
      )
      const sizes = await page.evaluate(() => {
        globalThis.document
          .querySelector('.gjs-frame')
          .contentWindow.removeEventListener('resize', globalThis.recordDeviceSize)
        return globalThis.deviceSizes
      })
      assert.ok(sizes.length > 0, `${name}: the actual iframe viewport changed`)
      const selectionReady = await page.evaluate(async () => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        return editor.Commands.isActive(editor.getConfig().defaultCommand)
      })
      assert.equal(
        selectionReady,
        true,
        `${name}: selection must resume as soon as final geometry is ready`,
      )
      assert.deepEqual(
        [...new Set(sizes.map((size) => size.join('x')))],
        [`${width}x${height}`],
        `${name}: device change must not animate through transient page layouts`,
      )
    }
    await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      globalThis.cmsCost = {
        snapshots: 0,
        styleReads: 0,
        creates: 0,
        exports: 0,
        parses: 0,
        cssParses: 0,
        ruleAdds: 0,
      }
      const parse = globalThis.DOMParser.prototype.parseFromString
      globalThis.DOMParser.prototype.parseFromString = function (...args) {
        globalThis.cmsCost.parses++
        return parse.apply(this, args)
      }
      const parseCss = editor.Parser.parseCss
      editor.Parser.parseCss = function (...args) {
        globalThis.cmsCost.cssParses++
        return parseCss.apply(this, args)
      }
      editor.on('project:get', () => globalThis.cmsCost.snapshots++)
      editor.on('component:create', () => globalThis.cmsCost.creates++)
      editor.Css.getAll().on('add', () => globalThis.cmsCost.ruleAdds++)
      const generator = editor.CodeManager.getGenerator('css')
      const build = generator.buildFromModel
      generator.buildFromModel = function (...args) {
        globalThis.cmsCost.styleReads++
        return build.apply(this, args)
      }
      const html = editor.getHtml
      editor.getHtml = function (...args) {
        globalThis.cmsCost.exports++
        return html.apply(this, args)
      }
    })
    const patchContract = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { updateNativeCanvas, updateSiteHeader } =
        await import('/src/admin/cms/updateCanvas.ts')
      const host = globalThis.document.createElement('div')
      globalThis.document.body.append(host)
      const isolated = cmsGrapes.init({
        container: host,
        storageManager: false,
        avoidInlineStyle: true,
      })
      isolated.Storage.setAutosave(false)
      try {
        const original =
          '<div data-knc-native="1"><p id="copy" data-knc-source="copy" title="old" class="old">Original</p><small>Stable unlabelled text</small><img id="photo" data-knc-source="photo" src="/old.png"></div>'
        isolated.setComponents(original)
        const copy = isolated.Components.getById('copy')
        const next = original
          .replace(' title="old"', '')
          .replace('class="old"', 'class="new"')
          .replace('Original', 'Changed &amp; literal')
          .replace('/old.png', '/new.png')
        const css = isolated.Parser.parseCss(
          '#copy{color:blue}.unused{width:12px}@media(max-width:600px){#copy{font-size:18px}}',
        )
        const reused = updateNativeCanvas(isolated, next, css)
        const roundtrip =
          updateNativeCanvas(isolated, original, css) && updateNativeCanvas(isolated, next, css)
        const content = isolated.getHtml({ cleanId: false })
        const sameModel = copy === isolated.Components.getById('copy')
        const policyChange = updateNativeCanvas(
          isolated,
          next.replace('data-knc-source="copy"', 'data-knc-source="copy" data-knc-required="true"'),
          css,
        )
        const beforeUnsupported = content
        const structural = updateNativeCanvas(
          isolated,
          next.replace('<p ', '<section ').replace('</p>', '</section>'),
          css,
        )
        const native = {
          reused,
          roundtrip,
          policyChange,
          sameModel,
          structural,
          unchangedOnFallback: isolated.getHtml({ cleanId: false }) === beforeUnsupported,
          image: isolated.Components.getById('photo').get('src'),
          exportedImage: content.includes('src="/new.png"'),
          text: content.includes('Changed &amp; literal'),
          removedTitle: !content.includes('title="old"'),
          classes: copy.getClasses(),
          css: isolated.getCss({ keepUnusedStyles: true }),
        }
        const header =
          '<header id="cms-site-header"><a href="/">Brand</a><nav id="cms-site-menu"><a href="/context-test">Old label</a></nav></header>'
        isolated.setComponents(`${header}<div id="cms-site-content"><h1>Keep body</h1></div>`)
        const headerModel = isolated.Components.getById('cms-site-header')
        const linkModel = headerModel.components().at(1).components().at(0)
        const bodyModel = isolated.Components.getById('cms-site-content')
        isolated.select(bodyModel.components().at(0))
        const selected = isolated.getSelected()
        const styles = isolated.getCss({ keepUnusedStyles: true })
        const undoCount = isolated.UndoManager.getStack().length
        let creates = 0
        isolated.on('component:create', () => creates++)
        const headerReused = updateSiteHeader(
          isolated,
          header.replace('Old label', 'New &amp; &lt;literal&gt;'),
        )
        const updated = isolated.getHtml({ cleanId: false })
        // A late mismatch must not apply earlier text changes from the same plan.
        const headerStructural = updateSiteHeader(
          isolated,
          header
            .replace('Brand', 'Must not apply')
            .replace('</nav>', '<a href="/new">New</a></nav>'),
        )
        return {
          ...native,
          header: {
            reused: headerReused,
            creates,
            sameHeader: headerModel === isolated.Components.getById('cms-site-header'),
            sameLink: linkModel === headerModel.components().at(1).components().at(0),
            sameBody: bodyModel === isolated.Components.getById('cms-site-content'),
            sameSelection:
              selected === bodyModel.components().at(0) && selected === isolated.getSelected(),
            sameCss: styles === isolated.getCss({ keepUnusedStyles: true }),
            sameUndo: undoCount === isolated.UndoManager.getStack().length,
            escaped: updated.includes('New &amp; &lt;literal&gt;'),
            structural: headerStructural,
            unchangedOnFallback: updated === isolated.getHtml({ cleanId: false }),
          },
        }
      } finally {
        isolated.destroy()
        host.remove()
      }
    })
    assert.equal(patchContract.reused, true)
    assert.equal(patchContract.roundtrip, true)
    assert.equal(patchContract.sameModel, true)
    assert.equal(patchContract.policyChange, false)
    assert.equal(patchContract.structural, false)
    assert.equal(patchContract.unchangedOnFallback, true)
    assert.equal(patchContract.image, '/new.png')
    assert.equal(patchContract.exportedImage, true)
    assert.equal(patchContract.text, true)
    assert.equal(patchContract.removedTitle, true)
    assert.deepEqual(patchContract.classes, ['new'])
    assert.deepEqual(patchContract.header, {
      reused: true,
      creates: 0,
      sameHeader: true,
      sameLink: true,
      sameBody: true,
      sameSelection: true,
      sameCss: true,
      sameUndo: true,
      escaped: true,
      structural: false,
      unchangedOnFallback: true,
    })
    assert.match(patchContract.css, /unused/)
    assert.match(patchContract.css, /max-width:\s*600px/)
    await measure('unchanged-view', () => button('SV').click())
    for (const name of ['EN', 'SV', 'Mörk', 'Ljus', 'Mobil', 'Dator'])
      await measure(name, () => button(name).click())
    for (const name of ['EN', 'SV', 'Mörk', 'Ljus']) {
      const cost = await measure(`repeated:${name}`, () => button(name).click())
      assert.equal(cost.cssParses, 0, 'Unchanged contexts must not compile their stylesheet again')
    }
    await frame.getByText('KNC source sv', { exact: true }).first().click()
    await page
      .locator('#cms-inspector')
      .getByLabel('Text', { exact: true })
      .fill('Pending context edit')
    await button('EN').click()
    await button('SV').click()
    await frame.getByText('Pending context edit', { exact: true }).first().waitFor()
    await measure('revert', () => button('Återställ').click())
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
    await button('Företag & SEO').click()
    await measure('hidden-canvas:EN', () => button('EN').click())
    await measure('hidden-canvas:SV', () => button('SV').click())
    await button('Tillbaka till sidan').click()
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
    await button('Lås vy').click()
    await page.locator('.cms-live-preview[aria-busy="false"]').waitFor()
    await measure('hidden-canvas:locked-EN', () => button('EN').click())
    await measure('hidden-canvas:locked-SV', () => button('SV').click())
    await button('Lås upp').click()
    await button('Historik').click()
    const restored = await measure('history:restore', () =>
      button('Återställ till utkast').first().click(),
    )
    assert.ok(restored.parses < 24, 'Complete history snapshots do not require legacy repairs')
    await button('Bokning').click()
    for (const scene of ['booking-options', 'booking-details', 'booking-confirmation', 'default']) {
      const cost = await measure(`scene:${scene}`, () =>
        page.getByLabel('Visa i editorn', { exact: true }).selectOption(scene),
      )
      assert.equal(cost.creates, 0, 'Scene changes must reuse the stored stage models')
      for (const stage of ['booking-options', 'booking-details', 'booking-confirmation'])
        assert.equal(await frame.locator(`[data-knc-surface="${stage}"]`).count(), 1)
    }
    await button('Skapa ny sida').click()
    const create = page.getByRole('dialog', { name: 'Ny sida', exact: true })
    await create.getByLabel('Sidnamn', { exact: true }).fill('Context test')
    await create.getByLabel('Adress', { exact: true }).fill('/context-test')
    await create.getByRole('button', { name: 'Skapa sida', exact: true }).click()
    await frame.getByRole('heading', { name: 'Context test', exact: true }).waitFor()
    for (const name of ['Mörk', 'Ljus', 'EN', 'SV']) {
      const cost = await measure(`authored:${name}`, () => button(name).click())
      assert.equal(
        cost.ruleAdds,
        0,
        'Compiled styles must load as one collection, not per-rule live DOM insertions',
      )
      await frame.getByRole('heading', { name: 'Context test', exact: true }).waitFor()
    }
    for (const name of ['Mörk', 'Ljus', 'EN', 'SV']) {
      const cost = await measure(`authored-repeat:${name}`, () => button(name).click())
      assert.equal(
        cost.cssParses,
        0,
        'Independent page contexts must reuse unchanged compiled styles',
      )
    }
    await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      globalThis.metadataBefore = {
        models: editor.getWrapper().find('*'),
        body: editor.Components.getById('cms-site-content').toHTML(),
      }
    })
    const metadata = await measure('authored:metadata', () =>
      page
        .locator('.cms-page-meta')
        .getByLabel('Namn', { exact: true })
        .fill('New navigation label'),
    )
    assert.equal(metadata.creates, 0, 'A navigation label edit must reuse every canvas component')
    assert.equal(
      metadata.cssParses,
      0,
      'A navigation label edit must not recompile the authored page CSS',
    )
    await frame
      .locator('#cms-site-menu')
      .getByRole('link', { name: 'New navigation label', exact: true })
      .waitFor()
    assert.equal(
      await page.evaluate(async () => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        const models = editor.getWrapper().find('*')
        return (
          models.length === globalThis.metadataBefore.models.length &&
          models.every((model, i) => model === globalThis.metadataBefore.models[i]) &&
          editor.Components.getById('cms-site-content').toHTML() ===
            globalThis.metadataBefore.body &&
          editor.Components.getById('cms-site-header').get('selectable') === false
        )
      }),
      true,
      'The live label changes without replacing models, changing the body or unlocking the header',
    )
    await writeFile(`${out}/context-cost.json`, JSON.stringify(results, null, 2))
    for (const result of results) {
      assert.equal(
        result.snapshots,
        0,
        `${result.label}: CMS must not autosave a second GrapesJS project`,
      )
      assert.equal(
        result.styleReads,
        0,
        `${result.label}: full CSS export must not resolve every component style`,
      )
    }
    assert.equal(results.find((row) => row.label === 'unchanged-view').exports, 0)
    for (const row of results.filter((row) => ['Mörk', 'Ljus', 'revert'].includes(row.label)))
      assert.equal(row.creates, 0, `${row.label}: reuse unchanged native structure`)
    for (const row of results.filter((row) => ['Mobil', 'Dator'].includes(row.label)))
      assert.equal(row.creates, 0, `${row.label}: Home already has both device trees`)
    assert.ok(
      results.find((row) => row.label === 'revert').parses < 24,
      'Complete reset must not reparse both copies of every core page',
    )
    for (const result of results.filter((row) => row.label.startsWith('hidden-canvas:')))
      assert.equal(result.creates, 0, `${result.label}: a hidden canvas must not rebuild`)
    assert.equal(backend.writes.filter((operation) => operation === 'publish').length, 1)
    console.log(
      'PASS CMS context switching: no duplicate storage, style scans or hidden rebuilds; immediate edits survive',
    )
  } finally {
    await writeFile(`${out}/context-cost.json`, JSON.stringify(results, null, 2))
  }
})
