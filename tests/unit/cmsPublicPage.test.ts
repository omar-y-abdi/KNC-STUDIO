import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CmsPage } from '../../shared/cms'
import { renderCmsPage } from '../../src/worker'

const page: CmsPage = {
  id: '10000000-0000-4000-8000-000000000001',
  kind: 'page',
  path: '/',
  name: { sv: 'Startsida', en: 'Home' },
  title: { sv: 'Svensk titel', en: 'English title' },
  description: { sv: 'Svensk beskrivning', en: 'English description' },
  inMenu: true,
  content: {
    sv: {
      html: '<main><h1>Hej</h1></main>',
      css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
    },
    en: {
      html: '<main><h1>Hello</h1></main>',
      css: { light: 'body{color:#222}', dark: 'body{color:#ddd}' },
    },
  },
}

const shell = `<!doctype html><html lang="sv"><head><title id="business-title">Old</title><meta id="business-description" name="description" content="old"><meta id="business-og-title" property="og:title" content="old"><meta id="business-og-description" property="og:description" content="old"><meta id="business-twitter-title" name="twitter:title" content="old"><meta id="business-twitter-description" name="twitter:description" content="old"><meta property="og:locale" content="sv_SE"><meta property="og:locale:alternate" content="en_US"><link rel="canonical" href="https://bladeblendstudio.se/"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`

describe('canonical CMS public page rendering', () => {
  it('repairs legacy desktop media in server-rendered CSS before the client mounts', () => {
    const native = structuredClone(page)
    native.content.sv.css.light =
      '@media(max-width:1440px){#reviews{translate:264px 5px!important}}'
    const result = renderCmsPage(shell, native, 'sv', 'light', 'https://bladeblendstudio.se/')
    expect(result).toContain('(min-width:769px){#reviews')
    expect(result).not.toContain('max-width:1440px')
  })
  it('restores dark source attributes without replacing owner edits in the initial response', () => {
    const native = structuredClone(page)
    const metadata = `data-knc-baseline='{"src":"/icons/sun.max.svg","alt":"Light"}' data-knc-dark-attrs='{"src":"/icons/moon.svg","alt":"Dark"}'`
    native.content.sv.html = `<div data-knc-native="1"><img src="/icons/sun.max.svg" alt="Light" ${metadata}><img src="/icons/knc-logo-pole.svg" alt="Owner logo" ${metadata}></div>`
    const result = renderCmsPage(shell, native, 'sv', 'dark', 'https://bladeblendstudio.se/')
    expect(result).toContain('src="/icons/moon.svg" alt="Dark"')
    expect(result).toContain('src="/icons/knc-logo-pole.svg" alt="Owner logo"')
  })
  it.each(['light', 'dark'] as const)(
    'restores compact native source styles in the initial %s response',
    (mode) => {
      const compact = structuredClone(page)
      compact.content.sv.html =
        '<div data-knc-native="1"><main data-knc-baseline="{}" data-knc-light="color: black; padding: 20px" data-knc-dark="color: white; padding: 20px"><p style="margin:8px">Authored</p></main></div>'
      const result = renderCmsPage(shell, compact, 'sv', mode, 'https://bladeblendstudio.se/')
      expect(result).toContain(
        `style="color: ${mode === 'dark' ? 'white' : 'black'}; padding: 20px"`,
      )
      expect(result).toContain('<p style="margin:8px">Authored</p>')
      expect(compact.content.sv.html).not.toContain('style="color:')
    },
  )
  it('renders authored HTML/CSS as the public root without a second presentation tree', () => {
    const html = renderCmsPage(shell, page, 'en', 'dark', 'https://bladeblendstudio.se/')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('data-cms-public="1"')
    expect(html).toContain('data-cms-mode="dark"')
    expect(html).toContain('<main><h1>Hello</h1></main>')
    expect(html).toContain('<style id="cms-page-dark">body{color:#ddd}</style>')
    expect(html).not.toContain('cms-page-light')
    expect(html).toContain('English title')
    expect(html).toContain('English description')
    expect(html).toContain('href="https://bladeblendstudio.se/"')
    expect(html).toContain('property="og:locale" content="en_US"')
    expect(html).toContain('property="og:locale:alternate" content="sv_SE"')
  })
})

// The real shell, so a later edit of its pre-paint block fails these tests instead of reviving the
// two-tone legal page. Vite moves the entry into <head> and adds preloads and the stylesheet.
const sourceShell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const builtShell = sourceShell
  .replace('<script type="module" src="/src/main.tsx"></script>', '')
  .replace(
    '</head>',
    '<script type="module" crossorigin src="/assets/entry.js"></script><link rel="modulepreload" crossorigin href="/assets/chunk.js"><link rel="stylesheet" crossorigin href="/assets/entry.css"></head>',
  )
const legalCss =
  ':root{color:#1c1c1e;background:#f4f3f0}@media (prefers-color-scheme: dark){:root{color:#f5f5f7;background:#1c1c1e}}'
const terms: CmsPage = {
  ...page,
  id: '10000000-0000-4000-8000-000000000006',
  kind: 'terms',
  path: '/terms',
  content: {
    sv: { html: '<main><h1>Bokningsvillkor</h1></main>', css: { light: legalCss, dark: legalCss } },
    en: { html: '<main><h1>Booking terms</h1></main>', css: { light: legalCss, dark: legalCss } },
  },
}
const canonical = 'https://bladeblendstudio.se/terms'
const moduleScripts = (html: string): number =>
  html.match(/<script\b[^>]*type="module"/g)?.length ?? 0

describe('authored pages follow the visitor colour scheme', () => {
  it('renders both media-scoped sheets after a reset of the shell grey when no mode is requested', () => {
    const html = renderCmsPage(sourceShell, terms, 'sv', null, canonical)
    expect(html).toContain('data-cms-mode="auto"')
    expect(html).toContain(
      '<style id="cms-page-light" media="(prefers-color-scheme: light)">:root{color:#1c1c1e;background:#f4f3f0}</style>',
    )
    expect(html).toContain(
      '<style id="cms-page-dark" media="(prefers-color-scheme: dark)">:root{color:#1c1c1e;background:#f4f3f0}:root{color:#f5f5f7;background:#1c1c1e}</style>',
    )
    expect(html).toContain('<meta name="color-scheme" content="light dark" />')
    const shellStyleEnd = html.indexOf('background-color: #242427;')
    const reset = html.indexOf('<style id="cms-reset">html,body{background:none}</style>')
    expect(shellStyleEnd).toBeGreaterThan(0)
    expect(reset).toBeGreaterThan(shellStyleEnd)
    expect(html.indexOf('<style id="cms-page-light"')).toBeGreaterThan(reset)
  })

  it.each(['light', 'dark'] as const)(
    'pins an explicit %s mode to one page sheet and its colour scheme',
    (mode) => {
      const html = renderCmsPage(sourceShell, terms, 'sv', mode, canonical)
      expect(html.match(/<style id="cms-page-/g)).toHaveLength(1)
      expect(html).toContain(`<style id="cms-page-${mode}">:root{`)
      expect(html).not.toContain('(prefers-color-scheme: light)">')
      expect(html).toContain(`<meta name="color-scheme" content="${mode}" />`)
      expect(html).toContain(`data-cms-mode="${mode}"`)
      expect(html).toContain('<style id="cms-reset">html,body{background:none}</style>')
    },
  )

  it.each([null, 'dark'] as const)(
    'serves an island-free page without the app bundle but with its theme script (mode %s)',
    (mode) => {
      const html = renderCmsPage(builtShell, terms, 'sv', mode, canonical)
      expect(moduleScripts(html)).toBe(0)
      expect(html).not.toContain('modulepreload')
      expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/entry.css">')
      expect(html).toMatch(/<script>[^<]+<\/script><\/body>/)
      expect(html).not.toContain('PlayfairDisplay')
      expect(html).toContain('/fonts/InterVariable-Latin.woff2')
    },
  )

  it('removes only parsed shell boot assets and their trailing whitespace, preserving other bytes', () => {
    const retained = [
      '<!-- <script type="module" src="/comment-only.js"></script> -->',
      '<script type="application/ld+json">{"example":"<script type=module>"}</script>',
      '<script nonce="keep">window.label = "<link rel=modulepreload href=/text-only.js>";</script>',
      '<link rel="stylesheet" data-note="a > b" href="/assets/keep.css">',
      '<link rel="prefetch" href="/fonts/PlayfairDisplay-Latin-700.woff2">',
      '<template><script type="module" src="/inert-template.js"></script></template>',
    ].join('\n  ')
    const removed = [
      '<ScRiPt data-note="a > b" TYPE=MoDuLe src="/assets/remove.js"></sCrIpT>',
      "<LINK HREF='/assets/remove-chunk.js' REL='prefetch MODULEPRELOAD'>",
      '<link href=/fonts/PlayfairDisplay-Latin-700.woff2 REL=PRELOAD>',
    ]
      .map((tag) => `${tag}\n \t`)
      .join('')
    const expectedShell = shell.replace('</head>', `${retained}</head>`)
    const actualShell = shell.replace('</head>', `${retained}${removed}</head>`)
    const actual = renderCmsPage(actualShell, terms, 'sv', null, canonical)
    const expected = renderCmsPage(expectedShell, terms, 'sv', null, canonical)
    expect(actual).toBe(expected)
    for (const snippet of retained.split('\n  ')) expect(actual).toContain(snippet)
    expect(actual).not.toContain('/assets/remove')
  })

  it('matches the existing trusted Vite-shell byte output for an explicitly stripped shell', () => {
    let stripped = builtShell
      .replace('<script type="module" crossorigin src="/assets/entry.js"></script>', '')
      .replace('<link rel="modulepreload" crossorigin href="/assets/chunk.js">', '')
    for (const weight of ['700', '400', '700-Italic']) {
      const font = `<link\n      rel="preload"\n      as="font"\n      type="font/woff2"\n      href="/fonts/PlayfairDisplay-Latin-${weight}.woff2"\n      crossorigin\n    />\n    `
      // Literal source slices include each old match's trailing whitespace. No parser oracle.
      expect(stripped).toContain(font)
      stripped = stripped.replace(font, '')
    }
    expect(renderCmsPage(builtShell, terms, 'sv', null, canonical)).toBe(
      renderCmsPage(stripped, terms, 'sv', null, canonical),
    )
  })

  it('keeps the Playfair preload when the page CSS uses Playfair', () => {
    const styled = structuredClone(terms)
    styled.content.sv.css.light += 'h1{font-family:"Playfair Display",serif}'
    styled.content.sv.css.dark = styled.content.sv.css.light
    expect(renderCmsPage(builtShell, styled, 'sv', null, canonical)).toContain(
      '/fonts/PlayfairDisplay-Latin-700.woff2',
    )
  })

  it('keeps the app bundle for a runtime island', () => {
    const island = structuredClone(terms)
    island.content.sv.html = '<main><div id="knc-booking-runtime"></div></main>'
    const html = renderCmsPage(builtShell, island, 'sv', null, canonical)
    expect(moduleScripts(html)).toBe(1)
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/chunk.js">')
    expect(html).toMatch(/<script>[^<]+<\/script><\/body>/)
  })

  it('leaves native markup to the app: explicit light first paint, bundle, no reset or theme script', () => {
    const native = structuredClone(page)
    native.content.sv.html = '<div data-knc-native="1"><main>Native</main></div>'
    const html = renderCmsPage(builtShell, native, 'sv', null, 'https://bladeblendstudio.se/')
    expect(html).toContain('data-cms-mode="light"')
    expect(html).toContain('<style id="cms-page-light">body{color:#111}</style>')
    expect(html).not.toContain('cms-page-dark')
    expect(html).not.toContain('cms-reset')
    expect(html).not.toMatch(/<script>[^<]+<\/script><\/body>/)
    expect(html).toContain('<meta name="color-scheme" content="light dark" />')
    expect(moduleScripts(html)).toBe(1)
  })
})
