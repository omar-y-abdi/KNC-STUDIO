import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const browser = await (process.env.CMS_ENGINE === 'webkit' ? webkit : chromium).launch()
const page = await browser.newPage()
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  const results = await page.evaluate(async () => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { nativeTree, projectNativeTree } = await import('/src/cms/NativeSurface.tsx')
    const Placeholder = () => h('span', null, 'No photo')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const check = (slotBefore, photoAfter) => {
      const tree = new globalThis.DOMParser().parseFromString(
        `<div data-knc-source="knc-about-0"><div ${slotBefore ? 'data-knc-slot' : 'data-knc-source'}="knc-about-0-i0"></div></div>`,
        'text/html',
      )
      const source = nativeTree(
        h(
          'div',
          null,
          photoAfter
            ? h('img', { src: '/icons/phone.svg', alt: 'New portrait' })
            : h(Placeholder, {}),
        ),
        'about',
      )
      render(projectNativeTree(source, tree.body.firstElementChild), host)
      return photoAfter
        ? Boolean(host.querySelector('img[alt="New portrait"]'))
        : host.textContent === 'No photo'
    }
    const result = { firstPortrait: check(true, true), removedPortrait: check(false, false) }
    render(null, host)
    host.remove()
    return result
  })
  assert.equal(
    results.firstPortrait,
    true,
    'Assigning the first portrait replaces the captured placeholder slot',
  )
  assert.equal(
    results.removedPortrait,
    true,
    'Removing a portrait restores its live placeholder instead of dropping the node',
  )
  console.log(
    'PASS resource projection: live slot/element transitions retain newly assigned and removed portraits',
  )
} finally {
  await browser.close()
}
