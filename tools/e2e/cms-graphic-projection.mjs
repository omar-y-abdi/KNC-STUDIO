import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const browser = await (process.env.CMS_ENGINE === 'webkit' ? webkit : chromium).launch()
const page = await browser.newPage()
await page.route('https://fixture.supabase.co/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"/>',
  }),
)
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { nativeTree, projectNativeTree } = await import('/src/cms/NativeSurface.tsx')
    const { snapshotNative } = await import('/src/admin/cms/nativePages.ts')
    const { replaceSiteResource } = await import('/shared/cms-site-resources.ts')
    const { emptyDocument } = await import('/shared/cms.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    let clicks = 0
    const source = nativeTree(
      h(
        'button',
        { onClick: () => clicks++ },
        h('svg', { width: 34, height: 34, 'aria-hidden': 'true' }, h('path', { d: 'M0 0h30v30Z' })),
      ),
      'about',
    )
    render(source.tree, host)
    const captured = snapshotNative(host.firstElementChild, 'about')
    const graphic = host.querySelector('svg')
    const document = emptyDocument()
    const variant = () => ({ html: captured, css: { light: '', dark: '' } })
    document.presentation.pages = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        path: '/',
        kind: 'page',
        inMenu: true,
        name: { sv: 'Home', en: 'Home' },
        title: { sv: '', en: '' },
        description: { sv: '', en: '' },
        content: { sv: variant(), en: variant() },
      },
    ]
    const asset = {
      id: '28000000-0000-4000-8000-000000000001',
      bucket: 'cms-library',
      path: 'images/icon.webp',
      name: 'Icon',
      alt: '',
      mime: 'image/webp',
      bytes: 100,
      archived: false,
      version: 0,
    }
    const next = replaceSiteResource(
      document,
      { pageId: document.presentation.pages[0].id, id: graphic.id },
      asset,
      'https://fixture.supabase.co',
    )
    const template = new globalThis.DOMParser().parseFromString(
      next.presentation.pages[0].content.sv.html,
      'text/html',
    ).body.firstElementChild
    render(projectNativeTree(source, template), host)
    const image = host.querySelector('img')
    host.querySelector('button').click()
    const graphicResult = {
      present: Boolean(image),
      width: image?.width,
      height: image?.height,
      parentHandler: clicks === 1,
    }
    const protectedSource = nativeTree(
      h('svg', { width: 34, height: 34 }, h('path', { onClick: () => clicks++, d: 'M0 0h30v30Z' })),
      'about',
    )
    render(protectedSource.tree, host)
    const original = new globalThis.DOMParser().parseFromString(
      snapshotNative(host.firstElementChild, 'about'),
      'text/html',
    ).body.firstElementChild
    const malicious = globalThis.document.createElement('img')
    for (const attribute of original.attributes)
      malicious.setAttribute(attribute.name, attribute.value)
    render(projectNativeTree(protectedSource, malicious), host)
    const path = host.querySelector('path')
    path?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }))
    const protectedResult = Boolean(path) && clicks === 2 && !host.querySelector('img')
    render(null, host)
    host.remove()
    return { graphicResult, protectedResult }
  })
  assert.equal(
    result.graphicResult.present,
    true,
    'Decorative SVGs project replacement images, not only role=img logos',
  )
  assert.deepEqual([result.graphicResult.width, result.graphicResult.height], [34, 34])
  assert.equal(result.graphicResult.parentHandler, true)
  assert.equal(
    result.protectedResult,
    true,
    'A graphic replacement cannot remove an interactive descendant',
  )
  console.log(
    'PASS graphic projection: decorative icon, size, parent action and protected descendants',
  )
} finally {
  await browser.close()
}
