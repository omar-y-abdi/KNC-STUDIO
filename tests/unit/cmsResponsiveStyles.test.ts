import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { generate, parse, walk, type StyleSheet } from 'css-tree'
import {
  canvasDevice,
  editorDevices,
  syncLayout,
  syncPageLayout,
} from '../../src/admin/cms/responsiveStyles'
import { repairDesktopCss } from '../../shared/cms-device-css'
import { siteThemeCss, themeStyleValue } from '../../shared/site-theme'
import { themeDeclarations } from '../../shared/site-theme-declarations'
import { emptyPresentation, type CmsPresentation } from '../../shared/cms'
import { createSitePage, normalizeSitePageContent } from '../../shared/site-page'

describe('narrow Desktop preview', () => {
  it('offers 820px only as a Desktop view with the same saved breakpoint', () => {
    const narrow = editorDevices.find((device) => device.id === 'DesktopNarrow')
    expect(narrow).toEqual({
      id: 'DesktopNarrow',
      name: 'DesktopNarrow',
      width: '820px',
      height: '900px',
      widthMedia: '769px',
    })
    expect(narrow?.widthMedia).toBe(editorDevices[0]?.widthMedia)
    expect(canvasDevice('Desktop', true)).toBe('DesktopNarrow')
    expect(canvasDevice('Desktop', false)).toBe('Desktop')
    expect(canvasDevice('Mobile', true)).toBe('Mobile')
  })
})

describe('forward-only language geometry', () => {
  const id = '10000000-0000-4000-8000-000000000001'
  const created = () => createSitePage({ id, path: '/offers', name: { sv: 'Ny', en: 'New' } })

  for (const lang of ['sv', 'en'] as const)
    for (const mode of ['light', 'dark'] as const)
      for (const media of ['min-width:769px', 'max-width:768px'])
        it(`shares ${lang}/${mode}/${media} geometry using authored language IDs`, () => {
          const before = created()
          const otherLang = lang === 'sv' ? 'en' : 'sv'
          const source = `cms-body-${id}-${lang}-title`
          const target = `cms-body-${id}-${otherLang}-title`
          for (const sheet of ['light', 'dark'] as const)
            before.content[otherLang].css[sheet] +=
              `\n#${target}{color:blue}#untouched{translate:264px 5px}`
          const original = structuredClone(before)
          const edited = structuredClone(before)
          edited.content[lang].html = edited.content[lang].html.replace('Ny', 'Egen text')
          edited.content[lang].css[mode] +=
            `@media(${media}){#${source}{translate:17px 3px!important;width:220px!important;height:12px!important;color:red}}`
          const next = syncPageLayout(before, edited, lang, mode)
          for (const sheet of ['light', 'dark'] as const) {
            expect(next.content[otherLang].css[sheet]).toContain(
              `@media (${media}){#${target}{translate:17px 3px!important;width:220px!important;height:auto!important;max-height:none!important}}`,
            )
            expect(next.content[lang].css[sheet]).toContain('height:auto!important')
            expect(next.content[otherLang].css[sheet]).toContain('color:blue')
            expect(next.content[otherLang].css[sheet]).not.toContain('color:red')
            expect(next.content[otherLang].css[sheet]).toContain('#untouched{translate:264px 5px}')
          }
          expect(next.content[otherLang].html).toBe(before.content[otherLang].html)
          expect(before).toEqual(original)
        })

  it('keeps every untouched sheet byte-identical on a text or appearance-only edit', () => {
    const before = created()
    before.content.en.css.dark += '\n/* existing drift */ #different { width: 71px; }'
    const edited = structuredClone(before)
    edited.content.sv.html += '<p>Only Swedish</p>'
    edited.content.sv.css.light += '#own{color:red}'
    const next = syncPageLayout(before, edited, 'sv', 'light')
    expect(next).toEqual(edited)
    expect(syncLayout('#one{width:2px}', '#one{width:2px;color:red}', ' /* raw */ ')).toBe(
      ' /* raw */ ',
    )
  })

  it('does not mistake a canvas breakpoint repair for an edit of legacy geometry', () => {
    const before = created()
    for (const lang of ['sv', 'en'] as const) {
      before.content[lang].html += '<img id="photo" src="/og-image.png">'
      before.content[lang].css.light +=
        `@media(max-width:1440px){#photo{translate:${lang === 'sv' ? 4 : 264}px 5px!important}}`
    }
    const edited = structuredClone(before)
    edited.content.sv.css.light = repairDesktopCss(edited.content.sv.css.light)
    edited.content.sv.html += '<p>Text only</p>'
    const next = syncPageLayout(before, edited, 'sv', 'light')
    expect(next.content.en).toEqual(before.content.en)
    expect(next.content.sv.css.dark).toBe(before.content.sv.css.dark)
  })

  it('pairs generated inline-style IDs without treating extraction as a geometry edit', () => {
    const before = created()
    for (const lang of ['sv', 'en'] as const)
      before.content[lang] = {
        html: `<p style="width:${lang === 'sv' ? 120 : 230}px">${lang}</p>`,
        css: { light: '', dark: '' },
      }
    const edited = structuredClone(before)
    edited.content.sv = normalizeSitePageContent(edited.content.sv, `${id}-sv`)
    edited.content.sv.html = edited.content.sv.html.replace('>sv<', '>Own Swedish<')
    expect(syncPageLayout(before, edited, 'sv', 'light').content.en).toEqual(before.content.en)
    edited.content.sv.css.light += `@media(max-width:768px){#cms-page-${id}-sv-0{width:180px!important}}`
    const next = syncPageLayout(before, edited, 'sv', 'light')
    expect(next.content.en.html).toBe(before.content.en.html)
    for (const mode of ['light', 'dark'] as const)
      expect(next.content.en.css[mode]).toContain(
        `#cms-page-${id}-en-0{width:180px!important;height:auto!important;max-height:none!important}`,
      )
  })

  it('resets edited legacy Desktop geometry in the other language without rewriting other geometry', () => {
    const before = created()
    for (const lang of ['sv', 'en'] as const)
      before.content[lang].html += '<img id="photo" src="/og-image.png">'
    before.content.sv.css.light += '@media(min-width:769px){#photo{translate:4px 5px}}'
    before.content.en.css.light +=
      '@media(max-width:1440px){#photo{translate:264px 5px}#untouched{width:81px}}'
    const edited = structuredClone(before)
    edited.content.sv.css.light = edited.content.sv.css.light.replace(
      '#photo{translate:4px 5px}',
      '',
    )
    const next = syncPageLayout(before, edited, 'sv', 'light')
    expect(next.content.en.css.light).not.toContain('translate:264px')
    expect(next.content.en.css.light).toContain('@media (max-width:1440px)')
    expect(next.content.en.css.light).toContain('#untouched{width:81px}')
  })

  it('updates a matched image size without imposing text height or touching an unmatched node', () => {
    const before = created()
    for (const lang of ['sv', 'en'] as const)
      before.content[lang].html += '<img id="photo" src="/og-image.png">'
    const edited = structuredClone(before)
    edited.content.en.css.dark +=
      '@media(min-width:769px){#photo{height:77px!important;zoom:1.5!important}}#unmatched{width:9px}'
    const next = syncPageLayout(before, edited, 'en', 'dark')
    expect(next.content.sv.css.light).toContain('#photo{height:77px!important;zoom:1.5!important}')
    expect(next.content.sv.css.light).not.toContain('height:auto')
    expect(next.content.sv.css.light).not.toContain('width:9px')
  })

  it('shares canonical document-root geometry without copying its colors', () => {
    const before = created()
    before.content.sv.css.light += 'html body{padding:20px;color:red}'
    before.content.en.css.dark += 'html body{padding:33px;color:blue}'
    const edited = structuredClone(before)
    edited.content.sv.css.light = edited.content.sv.css.light.replace(
      'padding:20px',
      'padding:42px',
    )
    const next = syncPageLayout(before, edited, 'sv', 'light')
    expect(next.content.en.css.dark).toContain('html body{color:blue}')
    expect(next.content.en.css.dark).toContain('html body{padding:42px}')
    expect(next.content.en.css.dark).not.toContain('color:red')
  })

  it('mirrors identical IDs and resets, but never guesses at unmatched language-like IDs', () => {
    const before = created()
    for (const lang of ['sv', 'en'] as const) {
      before.content[lang].html +=
        '<img id="photo" src="/og-image.png"><div id="custom-sv">Own</div>'
      before.content[lang].css.light += '#photo{width:90px}'
    }
    before.content.en.html = before.content.en.html.replace('custom-sv', 'custom-en')
    const edited = structuredClone(before)
    edited.content.sv.css.light = '#custom-sv{width:17px}'
    const next = syncPageLayout(before, edited, 'sv', 'light')
    expect(next.content.en.css.light).not.toContain('#photo{width:90px}')
    expect(next.content.en.css.light).not.toContain('width:17px')
    expect(next.content.en.css.light).not.toContain('custom-sv')
  })
})

describe('independent device geometry', () => {
  it('repairs an already parsed sheet in place', () => {
    const sheet = parse(
      '@media(max-width:1440px){#owner{width:10px}}@media(max-width:1440px){.source{width:20px}}',
    ) as StyleSheet
    expect(repairDesktopCss(sheet)).toBe(sheet)
    expect(generate(sheet)).toBe(
      '@media (min-width:769px){#owner{width:10px}}@media (max-width:1440px){.source{width:20px}}',
    )
  })
  it('repairs only the old desktop ID-rule breakpoint, retaining source class breakpoints', () => {
    const fixed = repairDesktopCss(
      '@media(max-width:1440px){#knc-about{translate:10px 0!important}}@media(max-width:1440px){.source{display:none}}',
    )
    expect(fixed).toContain('@media (min-width:769px){#knc-about')
    expect(fixed).toContain('@media (max-width:1440px){.source')
    expect(repairDesktopCss(fixed)).toBe(fixed)
  })
  it('shares geometry across themes without copying colors or affecting mobile', () => {
    const next = syncLayout(
      '',
      '@media(min-width:769px){#review{translate:10px 0!important;color:red!important}}',
      '@media(max-width:768px){#review{translate:-3px 0!important}}#review{color:white}',
    )
    expect(next).toContain('@media (min-width:769px){#review{translate:10px 0!important}}')
    expect(next).toContain('@media (max-width:768px){#review{translate:-3px 0!important}}')
    expect(next).toContain('color:white')
    expect(next).not.toContain('color:red')
  })
  it('removes reset geometry from the other theme without erasing unrelated rules', () => {
    const before = '@media(min-width:769px){#review{translate:10px 0!important}}'
    expect(syncLayout(before, '', before + '#review{color:white}')).not.toContain('translate')
    expect(syncLayout(before, '', before + '#review{color:white}')).toContain('color:white')
  })
})

describe('site theme defaults and owner overrides', () => {
  it('binds only mode-matched stored muted colors with byte-exact fallbacks', () => {
    const fixture: CmsPresentation = JSON.parse(
      gunzipSync(
        readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
      ).toString(),
    ).presentation
    const muted = {
      light: new Set(['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.62)']),
      dark: new Set(['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.72)']),
    }
    const touched = new Set([...muted.light, ...muted.dark])
    const found = new Set<string>()
    for (const page of fixture.pages)
      for (const lang of ['sv', 'en'] as const) {
        const visit = (node: DefaultTreeAdapterMap['node']): void => {
          if ('attrs' in node)
            for (const mode of ['light', 'dark'] as const) {
              const css = node.attrs.find((attr) => attr.name === `data-knc-${mode}`)?.value ?? ''
              walk(parse(css, { context: 'declarationList' }), {
                visit: 'Declaration',
                enter(declaration) {
                  const literal = generate(declaration.value)
                  if (declaration.property !== 'color' || !touched.has(literal)) return
                  found.add(literal)
                  for (const renderMode of ['light', 'dark'] as const) {
                    const rendered = themeStyleValue('color', literal, renderMode)
                    expect(rendered).toBe(
                      muted[renderMode].has(literal) ? `var(--knc-muted,${literal})` : literal,
                    )
                    // With no theme variables, CSS computes var() to this exact fallback value.
                    const fallback =
                      rendered === literal ? literal : rendered.slice('var(--knc-muted,'.length, -1)
                    expect(fallback).toBe(literal)
                  }
                },
              })
            }
          if ('childNodes' in node) node.childNodes.forEach(visit)
        }
        visit(parseFragment(page.content[lang].html))
      }
    expect(found).toEqual(touched)
    for (const mode of ['light', 'dark'] as const)
      expect(siteThemeCss(emptyPresentation(), mode)).not.toContain('--knc-muted:')
  })

  it('keeps light-mode white overlays literal while aliasing light muted black', () => {
    expect(themeStyleValue('color', 'rgba(255,255,255,.7)', 'light')).toBe('rgba(255,255,255,.7)')
    expect(themeStyleValue('color', 'rgba(0,0,0,.62)', 'light')).toBe(
      'var(--knc-muted,rgba(0,0,0,.62))',
    )
  })

  it.each(['light', 'dark'] as const)('aliases only matching %s muted text literals', (mode) => {
    const light = ['rgba(0,0,0,.6)', 'rgba(0, 0, 0, 0.6)', 'rgba(0,0,0,.62)', 'rgba(0, 0, 0, 0.62)']
    const dark = [
      'rgba(255,255,255,.55)',
      'rgba(255, 255, 255, 0.55)',
      'rgba(255,255,255,.7)',
      'rgba(255, 255, 255, 0.7)',
      'rgba(255,255,255,.72)',
      'rgba(255, 255, 255, 0.72)',
    ]
    for (const literal of mode === 'light' ? light : dark) {
      expect(themeStyleValue('color', literal, mode)).toBe(`var(--knc-muted,${literal})`)
      for (const property of ['fill', 'stroke'])
        expect(themeStyleValue(property, literal, mode)).toBe(literal)
    }
    for (const literal of mode === 'light' ? dark : light)
      expect(themeStyleValue('color', literal, mode)).toBe(literal)
  })

  it.each(['light', 'dark'] as const)('keeps solid grey colors literal in %s', (mode) => {
    const literals = [
      '#666666',
      '#666',
      'rgb(102, 102, 102)',
      '#999999',
      '#999',
      'rgb(153, 153, 153)',
    ]
    for (const literal of literals) expect(themeStyleValue('color', literal, mode)).toBe(literal)
  })
  it('tokenizes captured declarations through the separate parser module', () => {
    expect(
      themeDeclarations('background:#fff;color:#123456;font-family:Georgia,serif', 'light'),
    ).toBe(
      'background:var(--knc-background,#fff);color:#123456;font-family:var(--knc-fontFamily,Georgia,serif)',
    )
    expect(themeDeclarations('background:#1c1c1e!important;color:#f5f5f7', 'dark')).toBe(
      'background:var(--knc-background,#1c1c1e)!important;color:var(--knc-text,#f5f5f7)',
    )
  })
  it('binds original defaults with their exact fallback, without rewriting bespoke colors', () => {
    expect(themeStyleValue('background', 'rgb(255, 255, 255)', 'light')).toBe(
      'var(--knc-background,rgb(255, 255, 255))',
    )
    expect(themeStyleValue('color', '#123456', 'light')).toBe('#123456')
    expect(themeStyleValue('font-family', 'Georgia, serif', 'light')).toBe(
      'var(--knc-fontFamily,Georgia, serif)',
    )
    expect(themeStyleValue('background', 'var(--knc-background,#fff)', 'light')).toBe(
      'var(--knc-background,#fff)',
    )
  })
  it('emits only explicitly configured theme values', () => {
    const p = emptyPresentation()
    p.themes.light = { background: '#f0e4d4', fontFamily: 'Georgia, serif' }
    expect(siteThemeCss(p, 'light')).toContain('--knc-background:#f0e4d4')
    expect(siteThemeCss(p, 'dark')).not.toContain('--knc-background')
  })
})
