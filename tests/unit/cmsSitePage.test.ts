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
  const languageHref = (html: string): URL => {
    const value = html.match(/href="(\/extra\?lang=[^"]+)"/)?.[1]
    if (!value) throw new Error('Independent page language link is missing')
    return new URL(value.replaceAll('&amp;', '&'), 'https://example.test')
  }
  const themeHref = (html: string): URL => {
    const value = html.match(
      /<a\b(?=[^>]*aria-label="(?:Växla ljust\/mörkt|Toggle light\/dark)")[^>]*href="([^"]+)"/,
    )?.[1]
    if (!value) throw new Error('Independent page theme link is missing')
    return new URL(value.replaceAll('&amp;', '&'), 'https://example.test')
  }
  const actionHref = (html: string, action: 'language' | 'theme'): URL => {
    const marker = action === 'language' ? 'cms-site-action-language' : 'cms-site-action-theme'
    const tag = (html.match(/<a\b[^>]*>/g) ?? []).find((anchor) =>
      (anchor.match(/\bclass="([^"]+)"/)?.[1] ?? '').split(/\s+/).includes(marker),
    )
    const value = tag?.match(/\bhref="([^"]+)"/)?.[1]
    if (!value) throw new Error(`Independent page ${action} action is missing`)
    return new URL(value.replaceAll('&amp;', '&'), 'https://example.test')
  }
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
  it('makes the shared language pill switch to the opposite language on independent pages', () => {
    const { document, home, page } = fixture()
    home.content.sv.html = home.content.sv.html.replace(
      '<button>EN</button>',
      '<button aria-label="Byt språk till engelska" aria-pressed="false"><span>SV</span><span>EN</span></button><button aria-label="Växla ljust/mörkt">Theme</button>',
    )
    home.content.en.html = home.content.en.html.replace(
      '<button>EN</button>',
      '<button aria-label="Switch language to Swedish" aria-pressed="true"><span>SV</span><span>EN</span></button><button aria-label="Toggle light/dark">Theme</button>',
    )
    const created = createSitePage(document.presentation, page)
    const svOutput = renderSitePage(document.presentation, created, 'sv', 'light').html
    const enOutput = renderSitePage(document.presentation, created, 'en', 'dark').html
    expect(languageHref(svOutput).searchParams.get('lang')).toBe('en')
    expect(languageHref(svOutput).searchParams.get('mode')).toBe('light')
    expect(themeHref(svOutput).searchParams.get('mode')).toBe('dark')
    expect(languageHref(enOutput).searchParams.get('lang')).toBe('sv')
    expect(languageHref(enOutput).searchParams.get('mode')).toBe('dark')
    expect(themeHref(enOutput).searchParams.get('mode')).toBe('light')
  })
  it('retargets generated controls by their stable class while preserving native IDs and owner labels', () => {
    const { document, home, page } = fixture()
    for (const lang of ['sv', 'en'] as const)
      home.content[lang].html = home.content[lang].html.replace(
        '<button>EN</button>',
        `<button id="native-lang" class="owner-pill" aria-label="${lang === 'sv' ? 'Byt språk till engelska' : 'Switch language to Swedish'}"><span>SV</span><span>EN</span></button><button id="native-theme" class="owner-theme" aria-label="${lang === 'sv' ? 'Växla ljust/mörkt' : 'Toggle light/dark'}">Theme</button>`,
      )
    const created = createSitePage(document.presentation, page)
    for (const lang of ['sv', 'en'] as const) {
      created.content[lang].html = created.content[lang].html
        .replace(
          /aria-label="(?:Byt språk till engelska|Switch language to Swedish)"/,
          'aria-label="Owner language label"',
        )
        .replace(
          /aria-label="(?:Växla ljust\/mörkt|Toggle light\/dark)"/,
          'aria-label="Owner theme label"',
        )
        .replace(
          '</header>',
          '<a id="owner-external" aria-label="Byt språk till engelska" href="https://example.org/extra?lang=sv">External</a><a id="owner-local" href="/extra?lang=sv&amp;mode=light">Owner link</a></header>',
        )
      for (const mode of ['light', 'dark'] as const) {
        const output = renderSitePage(document.presentation, created, lang, mode).html
        const language = actionHref(output, 'language')
        const theme = actionHref(output, 'theme')
        expect(language.searchParams.get('lang')).toBe(lang === 'sv' ? 'en' : 'sv')
        expect(language.searchParams.get('mode')).toBe(mode)
        expect(theme.searchParams.get('lang')).toBe(lang)
        expect(theme.searchParams.get('mode')).toBe(mode === 'light' ? 'dark' : 'light')
        expect(output).toContain('id="native-lang"')
        expect(output).toContain('id="native-theme"')
        expect(output).toContain('owner-pill cms-site-action-language')
        expect(output).toContain('owner-theme cms-site-action-theme')
        expect(output).toContain('aria-label="Owner language label"')
        expect(output).toContain('aria-label="Owner theme label"')
        expect(output).toContain('href="https://example.org/extra?lang=sv"')
        expect(output).toContain('id="owner-local" href="/extra?lang=sv&amp;mode=light"')
      }
    }
  })
  it('recognizes the combined SV/EN pill before materialization even with an owner label', () => {
    const { document, home, page } = fixture()
    for (const lang of ['sv', 'en'] as const)
      home.content[lang].html = home.content[lang].html.replace(
        '<button>EN</button>',
        '<button id="native-lang" aria-label="Välj alternativ"><span>SV</span><span>EN</span></button>',
      )
    const created = createSitePage(document.presentation, page)
    for (const lang of ['sv', 'en'] as const) {
      const output = renderSitePage(document.presentation, created, lang, 'light').html
      expect(actionHref(output, 'language').searchParams.get('lang')).toBe(
        lang === 'sv' ? 'en' : 'sv',
      )
      expect(output).toContain('id="native-lang"')
      expect(output).toContain('aria-label="Välj alternativ"')
    }
  })
  it('converts a legacy two-button language pill into one opposite-language link', () => {
    const { document, home, page } = fixture()
    for (const lang of ['sv', 'en'] as const)
      home.content[lang].html = home.content[lang].html.replace(
        '<button>EN</button>',
        '<div id="legacy-lang-pill"><button aria-pressed="true">SV</button><button aria-pressed="false">EN</button></div>',
      )
    const created = createSitePage(document.presentation, page)
    const svOutput = renderSitePage(document.presentation, created, 'sv', 'light').html
    const enOutput = renderSitePage(document.presentation, created, 'en', 'dark').html
    expect(languageHref(svOutput).searchParams.get('lang')).toBe('en')
    expect(languageHref(enOutput).searchParams.get('lang')).toBe('sv')
    expect(languageHref(enOutput).searchParams.get('mode')).toBe('dark')
    expect(svOutput).not.toContain('<a id="legacy-lang-pill"><a')
    expect(enOutput).not.toContain('<a id="legacy-lang-pill"><a')
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
