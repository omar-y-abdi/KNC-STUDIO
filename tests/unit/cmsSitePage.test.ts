import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsPage } from '../../shared/cms'
import { renderSitePage, createSitePage, normalizeSitePageContent } from '../../shared/site-page'
import { renderCmsPage } from '../../src/worker'

function fixture() {
  const variant = (html: string) => ({ html, css: { light: '', dark: '' } })
  const make = (path: string, html: string): CmsPage => ({
    id: crypto.randomUUID(),
    kind: 'page',
    path,
    inMenu: true,
    name: { sv: 'Ägarens sida', en: 'Owner page' },
    title: { sv: 'Titel', en: 'Title' },
    description: { sv: '', en: '' },
    content: { sv: variant(html), en: variant(html) },
  })
  const home = make(
    '/',
    `<div data-knc-native="1"><div data-knc-surface="desktop-home" data-knc-light="color:#111;background:#fff;font-family:Inter" data-knc-dark="color:#eee;background:#111;font-family:Inter"><div id="knc-header" data-knc-light="background:#eee"><h1><svg role="img"><text>Original logo</text></svg></h1><button>EN</button></div><main><div><div>Home hero</div><div id="knc-info">Open daily</div></div></main></div></div>`,
  )
  const about = make(
    '/about',
    '<section><footer><a href="/privacy">Integritetspolicy</a></footer></section>',
  )
  const page = make('/extra', '<main id="owner-content"><h1>My page</h1><p>Owner copy</p></main>')
  const document = emptyDocument()
  document.presentation.pages = [home, about, page]
  return { document, home, page }
}

describe('new pages extend the published website', () => {
  it('seeds an independent fully authored page with theme baselines outside device media rules', () => {
    const { document, page, home } = fixture()
    const created = createSitePage(document.presentation, page)
    for (const lang of ['sv', 'en'] as const) {
      expect(created.content[lang].html).toContain('id="cms-site-shell"')
      expect(created.content[lang].html).not.toContain('style=')
      expect(created.content[lang].html).not.toContain('data-knc-')
      for (const mode of ['light', 'dark'] as const) {
        const output = renderSitePage(document.presentation, created, lang, mode)
        expect(output.html.match(/id="cms-site-shell"/g)).toHaveLength(1)
        expect(output.css).toContain('[id="cms-site-shell"]{')
      }
    }
    home.content.sv.html = home.content.sv.html.replace('Original logo', 'Unrelated edit')
    expect(renderSitePage(document.presentation, created, 'sv', 'light').html).toContain(
      'Original logo',
    )
    expect(createSitePage(document.presentation, created)).toEqual(created)
  })

  it('preserves inline baseline styles for both themes when the editor serializes shared HTML', () => {
    const normalized = normalizeSitePageContent(
      {
        html: '<main style="padding:64px 32px"><h1>Page</h1></main>',
        css: { light: 'h1{color:black}', dark: 'h1{color:white}' },
      },
      'test-sv',
    )
    expect(normalized.html).toContain('id="cms-page-test-sv-0"')
    expect(normalized.html).not.toContain('style=')
    expect(normalized.css.light).toContain('padding:64px 32px')
    expect(normalized.css.dark).toContain('padding:64px 32px')
    expect(normalized.css.dark).toContain('h1{color:white}')
    expect(normalizeSitePageContent(normalized, 'test-sv')).toEqual(normalized)
  })
  it('uses current branding, menu, theme and footer in the actual Worker response', () => {
    const { document, home, page } = fixture()
    const original = structuredClone(document)
    const rendered = renderSitePage(document.presentation, page, 'sv', 'dark')
    expect(rendered.html).toContain('Original logo')
    expect(rendered.html).toContain('color:#eee;background:#111')
    expect(rendered.html).toContain('Integritetspolicy')
    expect(rendered.html).toContain('href="/extra?lang=sv&amp;mode=dark"')
    expect(rendered.html).not.toContain('data-knc-')
    expect(document).toEqual(original)
    const shell = '<html lang="sv"><head></head><body><div id="root"></div></body></html>'
    expect(
      renderCmsPage(
        shell,
        page,
        'sv',
        'dark',
        'https://bladeblendstudio.se/extra',
        '',
        document.presentation,
      ),
    ).toContain(rendered.html)
    home.content.sv.html = home.content.sv.html.replace('Original logo', 'Updated logo')
    expect(renderSitePage(document.presentation, page, 'sv', 'dark').html).toContain('Updated logo')
    expect(page.content.sv.html).not.toContain('logo')
  })
  it('does not resurrect chrome after the owner deletes the full seeded layout', () => {
    const { document, page } = fixture()
    const created = createSitePage(document.presentation, page)
    created.content.sv.html = '<p>Just my content</p>'
    const rendered = renderSitePage(document.presentation, created, 'sv', 'light')
    expect(rendered.html).toBe('<p>Just my content</p>')
    expect(rendered.html).not.toContain('cms-site-header')
  })
})
