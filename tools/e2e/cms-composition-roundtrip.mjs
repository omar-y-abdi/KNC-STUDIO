import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const browser = await (process.env.CMS_ENGINE === 'webkit' ? webkit : chromium).launch()
const page = await browser.newPage()
try {
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
    return { lengths, homeColor, aboutCss: about.content.sv.css.light }
  })
  console.log(JSON.stringify({ roundtripLengths: result.lengths, homeColor: result.homeColor }))
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
} finally {
  await browser.close()
}
