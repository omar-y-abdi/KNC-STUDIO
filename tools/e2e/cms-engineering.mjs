import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-engineering'
await mkdir(out, { recursive: true })
const results = []

// The real resource component receives deterministic API promises. Only I/O is
// replaced: Reactivity, DOM events, serialization and draft transforms stay real.
async function resources(page, state = 'active') {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async (state) => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { CmsResources } = await import('/src/admin/cms/Resources.tsx')
    const { cmsApi } = await import('/src/admin/cms/api.ts')
    const { emptyDocument } = await import('/shared/cms.ts')
    const asset = {
      id: '20000000-0000-4000-8000-000000000001',
      bucket: 'cms-library', path: 'images/first.webp', name: 'First image',
      mime: 'image/webp', alt: '', bytes: 100, width: 10, height: 10,
      archived: state !== 'active', trashed_at: state === 'trash' ? '2026-01-01T00:00:00Z' : null,
      version: 1,
    }
    const other = { ...asset, id: '20000000-0000-4000-8000-000000000002', path: 'images/second.webp', name: 'Second image' }
    let document = emptyDocument()
    document.presentation.images.hero = { ref: { bucket: asset.bucket, path: asset.path }, alt: '' }
    document.settings.business_name = 'Before'
    const model = { document, assets: [asset, other], errors: [], lifecycle: [], resolve: null, pending: false }
    window.cmsReview = model
    const host = window.document.createElement('div')
    window.document.body.replaceChildren(host)
    const draw = () => render(h(CmsResources, {
      document: model.document, assets: model.assets,
      onDocument: update => {
        model.document = typeof update === 'function' ? update(model.document) : update
        draw()
      },
      onAssets: update => {
        model.assets = typeof update === 'function' ? update(model.assets) : update
        draw()
      },
      onError: error => model.errors.push(error),
    }), host)
    model.redraw = draw
    cmsApi.assetUsage = async id => ({ currentReferences: id === other.id ? 7 : 0, historyReferences: 0 })
    cmsApi.uploadAsset = async () => {
      model.pending = true
      return new Promise(resolve => { model.resolve = () => resolve({ ...asset, id: '20000000-0000-4000-8000-000000000003', path: 'images/new.webp', name: 'Replacement' }) })
    }
    cmsApi.asset = async submitted => {
      model.pending = true
      return new Promise(resolve => { model.resolve = () => resolve({ ...submitted, version: submitted.version + 1 }) })
    }
    cmsApi.assetLifecycle = async (submitted, action) => {
      model.lifecycle.push({ id: submitted.id, action })
      model.pending = true
      return new Promise(resolve => {
        model.resolve = () => resolve({
          asset: { ...submitted, version: submitted.version + 1, archived: true },
          usage: { currentReferences: 0, historyReferences: 0 },
        })
      })
    }
    draw()
  }, state)
  await page.getByRole('button', { name: /First image/ }).click()
  await page.waitForFunction(() => document.querySelector('.cms-resource-detail')?.textContent.includes('Publicerat: 0'))
}

async function nativeInstances(page) {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  return page.evaluate(async () => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { nativeTree, NativeRegion, NativeSiteProvider } = await import('/src/cms/NativeSurface.tsx')
    const { snapshotNative } = await import('/src/admin/cms/nativePages.ts')
    const { emptyDocument } = await import('/shared/cms.ts')
    const surface = 'my-booking-card'
    const make = () => {
      let deep = h('span', { 'data-probe': 'deep' }, 'Deep runtime leaf')
      for (let i = 0; i < 40; i++) deep = h('div', {}, deep)
      return h('article', {}, h('p', { id: 'owner-edit' }, 'Original wording'), deep)
    }
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    render(nativeTree(make(), surface).tree, host)
    const source = new DOMParser().parseFromString(snapshotNative(host.firstElementChild, surface), 'text/html')
    source.getElementById('owner-edit').textContent = 'Literal knc-my-booking-card-0 stays text'
    const anchor = source.createElement('p')
    anchor.id = 'owner-anchor'
    anchor.textContent = 'Owner content'
    source.body.firstElementChild.appendChild(anchor)
    const link = source.createElement('a')
    link.href = '#owner-anchor'
    link.textContent = 'Jump within card'
    source.body.firstElementChild.appendChild(link)
    const html = source.body.innerHTML
    const presentation = emptyDocument().presentation
    presentation.pages = [{
      id: '10000000-0000-4000-8000-000000000004', path: '/my-bookings', kind: 'page',
      name: { sv: 'Bookings', en: 'Bookings' }, title: { sv: '', en: '' },
      description: { sv: '', en: '' }, inMenu: false,
      content: Object.fromEntries(['sv', 'en'].map(lang => [lang, { html, css: { light: '#owner-anchor{color:rgb(1, 2, 3)}', dark: '' } }])),
    }]
    render(h(NativeSiteProvider, { presentation },
      ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'].map(instance =>
        h(NativeRegion, { key: instance, surface, instance, lang: 'sv', mode: 'light' }, make()),
      )), host)
    const cards = [...host.querySelectorAll('article')]
    const ids = [...host.querySelectorAll('[id]')].map(node => node.id)
    return {
      leaves: host.querySelectorAll('[data-probe=deep]').length,
      text: cards.map(card => card.querySelector('p')?.textContent),
      uniqueIds: new Set(ids).size === ids.length,
      localLinks: cards.every(card => {
        const link = [...card.querySelectorAll('a')].find(node => node.textContent === 'Jump within card')
        return link && [...card.querySelectorAll('[id]')].some(node => `#${node.id}` === link.getAttribute('href'))
      }),
      styled: cards.every(card => [...card.querySelectorAll('p')].some(node => node.textContent === 'Owner content' && getComputedStyle(node).color === 'rgb(1, 2, 3)')),
    }
  })
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== name) continue
  const browser = await engine.launch()
  const check = async (title, scenario) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    try {
      await scenario(page)
      results.push({ engine: name, title, passed: true })
    } catch (error) {
      results.push({ engine: name, title, passed: false, error: error.stack ?? String(error) })
      await page.screenshot({ path: `${out}/${name}-${results.length}-failure.png` }).catch(() => {})
    } finally {
      await context.close()
    }
  }
  try {
    await check('Replacement applies to the current draft, not the upload-start snapshot', async page => {
      await resources(page)
      await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'replacement.webp', mimeType: 'image/webp', buffer: Buffer.from('fixture') })
      await page.waitForFunction(() => window.cmsReview.pending)
      await page.evaluate(() => {
        const model = window.cmsReview
        model.document = structuredClone(model.document)
        model.document.settings.business_name = 'Edited during upload'
        model.redraw()
        model.resolve()
      })
      await page.waitForFunction(() => window.cmsReview.assets.some(asset => asset.name === 'Replacement'))
      await page.waitForFunction(() => window.cmsReview.document.presentation.images.hero.ref.path === 'images/new.webp')
      assert.equal(await page.evaluate(() => window.cmsReview.document.settings.business_name), 'Edited during upload')
    })
    await check('Permanent deletion cannot destroy an image referenced only by this draft', async page => {
      await resources(page, 'trash')
      assert.equal(await page.getByRole('button', { name: 'Radera permanent', exact: true }).isDisabled(), true)
    })
    await check('Bulk trash checks local draft references before issuing any writes', async page => {
      await resources(page)
      await page.getByRole('checkbox', { name: 'Markera First image', exact: true }).check()
      await page.getByRole('button', { name: 'Till papperskorg', exact: true }).click()
      await page.waitForFunction(() => window.cmsReview.errors.length || window.cmsReview.lifecycle.length)
      assert.deepEqual(await page.evaluate(() => window.cmsReview.lifecycle), [])
      assert.match(await page.evaluate(() => window.cmsReview.errors.join(' ')), /utkast/i)
    })
    await check('A saved metadata response cannot erase typing after the request began', async page => {
      await resources(page)
      await page.getByLabel('Namn', { exact: true }).fill('Submitted name')
      await page.getByRole('button', { name: 'Spara metadata', exact: true }).click()
      await page.waitForFunction(() => window.cmsReview.pending)
      await page.getByLabel('Namn', { exact: true }).fill('Newer unsaved name')
      await page.evaluate(() => window.cmsReview.resolve())
      await page.waitForFunction(() => window.cmsReview.assets[0].version === 2)
      assert.equal(await page.getByLabel('Namn', { exact: true }).inputValue(), 'Newer unsaved name')
    })
    await check('Lifecycle responses never replace the selected other assets usage', async page => {
      await resources(page)
      await page.getByRole('button', { name: 'Arkivera', exact: true }).click()
      await page.waitForFunction(() => window.cmsReview.pending)
      await page.getByRole('button', { name: /Second image/ }).click()
      await page.waitForFunction(() => document.querySelector('.cms-resource-detail')?.textContent.includes('Publicerat: 7'))
      await page.evaluate(() => window.cmsReview.resolve())
      await page.waitForFunction(() => window.cmsReview.assets[0].version === 2)
      assert.match(await page.locator('.cms-resource-detail').innerText(), /Publicerat: 7/)
    })
    await check('Adding missing scenes preserves owner CSS and is idempotent', async page => {
      await page.goto(`${base}/tools/e2e/admin-harness.html`)
      const actual = await page.evaluate(async () => {
        const { emptyDocument } = await import('/shared/cms.ts')
        const { ensureCorePages } = await import('/src/admin/cms/corePages.ts')
        const document = emptyDocument()
        const original = {
          id: '10000000-0000-4000-8000-000000000003', path: '/booking', kind: 'page',
          name: { sv: 'Booking', en: 'Booking' }, title: { sv: '', en: '' },
          description: { sv: '', en: '' }, inMenu: false,
          content: Object.fromEntries(['sv', 'en'].map(lang => [lang, {
            html: '<div data-knc-native="1"><section data-knc-surface="desktop-booking"><p class="owner-color">Owner heading</p></section></div>',
            css: { light: '.owner-color{color:rgb(0,128,0)}', dark: '.owner-color{color:rgb(0,128,0)}' },
          }])),
        }
        document.presentation.pages = [original]
        const source = structuredClone(original)
        for (const lang of ['sv', 'en']) {
          source.content[lang].html = source.content[lang].html.replace('</div>', '<section data-knc-surface="booking-details">New scene</section></div>')
          for (const mode of ['light', 'dark']) source.content[lang].css[mode] = '.owner-color{color:rgb(255,0,0)}'
        }
        const upgraded = ensureCorePages(document, [source])
        const host = window.document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        // Isolated, synthetic fixture with fixed trusted strings.
        const style = window.document.createElement('style')
        style.textContent = upgraded.presentation.pages[0].content.sv.css.light
        shadow.append(style, new DOMParser().parseFromString(upgraded.presentation.pages[0].content.sv.html, 'text/html').body)
        window.document.body.append(host)
        return {
          color: getComputedStyle(shadow.querySelector('.owner-color')).color,
          stable: JSON.stringify(upgraded) === JSON.stringify(ensureCorePages(upgraded, [source])),
          original: document.presentation.pages[0].content.sv.html.includes('booking-details'),
        }
      })
      assert.equal(actual.color, 'rgb(0, 128, 0)')
      assert.equal(actual.stable, true)
      assert.equal(actual.original, false)
    })
    await check('Repeated templates preserve deep runtime nodes even beyond the identity limit', async page => {
      const actual = await nativeInstances(page)
      assert.equal(actual.leaves, 2)
    })
    await check('Instance scoping never rewrites owner prose', async page => {
      const actual = await nativeInstances(page)
      assert.deepEqual(actual.text, ['Literal knc-my-booking-card-0 stays text', 'Literal knc-my-booking-card-0 stays text'])
    })
    await check('Owner-authored IDs and their links/styles are unique per repeated card', async page => {
      const actual = await nativeInstances(page)
      assert.equal(actual.uniqueIds, true)
      assert.equal(actual.localLinks, true)
      assert.equal(actual.styled, true)
    })
  } finally {
    await browser.close()
  }
}
await writeFile(`${out}/review-results.json`, JSON.stringify(results, null, 2))
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.engine}: ${result.title}${result.error ? `\n${result.error}` : ''}`)
assert.equal(results.filter(result => !result.passed).length, 0, 'Adversarial CMS contracts failed')
