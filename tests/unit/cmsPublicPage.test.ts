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
  it('renders authored HTML/CSS as the public root without a second presentation tree', () => {
    const html = renderCmsPage(shell, page, 'en', 'dark', 'https://bladeblendstudio.se/')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('data-cms-public="1"')
    expect(html).toContain('data-cms-mode="dark"')
    expect(html).toContain('<main><h1>Hello</h1></main>')
    expect(html).toContain(
      '<style id="cms-page-light" media="(prefers-color-scheme: light)">body{color:#222}</style>',
    )
    expect(html).toContain(
      '<style id="cms-page-dark" media="(prefers-color-scheme: dark)">body{color:#ddd}</style>',
    )
    expect(html).toContain('English title')
    expect(html).toContain('English description')
    expect(html).toContain('href="https://bladeblendstudio.se/"')
    expect(html).toContain('property="og:locale" content="en_US"')
    expect(html).toContain('property="og:locale:alternate" content="sv_SE"')
  })
})
