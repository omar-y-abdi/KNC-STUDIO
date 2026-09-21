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
    expect(html).toContain('<style id="cms-page-light" media="not all">body{color:#222}</style>')
    expect(html).toContain('<style id="cms-page-dark" media="all">body{color:#ddd}</style>')
    expect(html).toContain('English title')
    expect(html).toContain('English description')
    expect(html).toContain('href="https://bladeblendstudio.se/"')
    expect(html).toContain('property="og:locale" content="en_US"')
    expect(html).toContain('property="og:locale:alternate" content="sv_SE"')
  })
})
