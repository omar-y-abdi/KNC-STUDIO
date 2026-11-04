import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { generate, parse, walk, type CssNode, type List, type StyleSheet } from 'css-tree'
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

describe('targeted cascade geometry', () => {
  it('maps only matched component IDs while retaining selector branches, layers and conditions', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const before = createSitePage({ id, path: '/offers', name: { sv: 'Ny', en: 'New' } })
    const frame = (lang: string) => `cms-body-${id}-${lang}-frame`
    const card = (lang: string) => `cms-body-${id}-${lang}-card`
    const css = (lang: string) =>
      `@layer owners{@supports(display:grid){@container(min-width:300px){@media(min-width:769px){#foreign-sv #${frame(lang)} .card:where(#${card(lang)}){width:70%;color:blue}}}}}.owner{--owner-width:70%;color:var(--owner-color)}`
    for (const lang of ['sv', 'en'] as const)
      before.content[lang] = {
        html: `<div id="${frame(lang)}" class="owner"><div id="${card(lang)}" class="card"><img src="/og-image.png"></div></div>`,
        css: { light: css(lang), dark: css(lang) },
      }
    const edited = structuredClone(before)
    edited.content.sv.css.light = edited.content.sv.css.light
      .replace('width:70%;color:blue', 'width:56%;zoom:0.8!important;color:orange')
      .concat('@media(min-width:769px){.card:where(#ghost-sv){width:1px}}')
    const next = syncPageLayout(before, edited, 'sv', 'light')
    for (const lang of ['sv', 'en'] as const)
      for (const mode of ['light', 'dark'] as const) {
        const result = generate(parse(next.content[lang].css[mode]))
        expect(result).toContain(`#foreign-sv #${frame(lang)} .card:where(#${card(lang)})`)
        expect(result).toContain(
          '@layer owners{@supports (display:grid){@container (min-width:300px){@media (min-width:769px)',
        )
        expect(result).toContain('width:56%;zoom:0.8!important')
        expect(result).toContain('--owner-width:70%')
        if (lang !== 'sv' || mode !== 'light') {
          expect(result).toContain('color:blue')
          expect(result).not.toContain('orange')
          expect(result).not.toContain('ghost-sv')
        }
        if (lang === 'en') expect(result).not.toContain(`#${card('sv')}`)
      }
    expect(next.content.en.html).toBe(before.content.en.html)
  })

  it('keeps repeated anonymous layers separate when one component override changes', () => {
    const before =
      '@layer{.card:where(#photo){width:70%!important;color:red}}@layer{.card:where(#photo){width:40%!important;color:gray}}'
    const after = before.replace('70%', '56%')
    const result = syncLayout(before, after, before.replace('red', 'blue').replace('gray', 'white'))
    expect(result).toBe(
      '@layer{.card:where(#photo){color:blue;width:56%!important}}@layer{.card:where(#photo){width:40%!important;color:white}}',
    )
  })

  it('does not turn equivalent layer-order serialization into a geometry edit', () => {
    const before = '@layer base,overrides;@layer base{.card:where(#photo){width:70%;color:red}}'
    const after =
      '@layer base{}@layer overrides{}@layer base{.card:where(#photo){width:70%;color:orange}}'
    const other =
      ' /* independent geometry */ @layer base{.card:where(#photo){width:90%;color:blue}}'
    expect(syncLayout(before, after, other)).toBe(other)
  })

  it('inserts a new nested override before later owner conditions in an existing media group', () => {
    const before =
      '@media(min-width:769px){.owner{width:70%;@supports(display:grid){&.later{width:80%}}}}'
    const after =
      '@media(min-width:769px){.owner{width:70%;@media(min-width:769px){&:where(#card){width:56%;zoom:0.8}}@supports(display:grid){&.later{width:80%}}}}'
    const other =
      '@media(min-width:769px){.owner{width:70%;color:blue;@supports(display:grid){&.later{width:80%}}}}@media(min-width:769px){#unrelated{color:white}}'
    const result = syncLayout(before, after, other)
    expect(result).toContain(
      '.owner{width:70%;color:blue;@media (min-width:769px){&:where(#card){width:56%;zoom:0.8}}@supports (display:grid){&.later{width:80%}}}',
    )
    expect(result).toContain('#unrelated{color:white}')
    expect(syncLayout(after, before, result)).not.toContain('width:56%')
  })

  it('keeps separate width and zoom guards on their own sides of a later owner condition', () => {
    const before =
      '.owner{width:70%;color:red;@supports(display:grid){&:where(:hover){width:80%}}zoom:1}'
    const after = before
      .replace('width:70%;', 'width:70%;@media(min-width:769px){&:where(#card){width:56%}}')
      .replace('zoom:1', 'zoom:1;@media(min-width:769px){&:where(#card){zoom:0.8}}')
    const other = before.replace('color:red', 'color:blue')
    // The two target rules have equal specificity to the later hover rule. Moving width
    // beside zoom would make the counterpart keep 56% on hover while the source uses 80%.
    const tree = parse(syncLayout(before, after, other))
    if (tree.type !== 'StyleSheet') throw new Error('The synced stylesheet is missing')
    const owner = tree.children.first
    if (owner?.type !== 'Rule') throw new Error('The owner rule is missing')
    expect(generate(owner.prelude)).toBe('.owner')
    const children = owner.block.children.toArray()
    expect(
      children
        .filter(
          (node) =>
            node.type === 'Atrule' ||
            (node.type === 'Declaration' && ['width', 'zoom'].includes(node.property)),
        )
        .map((node) => generate(node)),
    ).toEqual([
      'width:70%',
      '@media (min-width:769px){&:where(#card){width:56%}}',
      '@supports (display:grid){&:where(:hover){width:80%}}',
      'zoom:1',
      '@media (min-width:769px){&:where(#card){zoom:0.8}}',
    ])
    // Appearance stays independent; its placement relative to geometry is immaterial.
    expect(
      children.flatMap((node) =>
        node.type === 'Declaration' && node.property === 'color' ? [generate(node.value)] : [],
      ),
    ).toEqual(['blue'])
  })

  it('keeps a missing anonymous layer ordinal stable across repeated important geometry edits', () => {
    const before = '@layer{.appearance{color:red}}@layer{.card:where(#photo){width:40%!important}}'
    const after = before.replace('40%', '56%')
    const first = syncLayout(before, after, '.appearance{color:blue}')
    expect(first).toBe(
      '.appearance{color:blue}@layer{}@layer{.card:where(#photo){width:56%!important}}',
    )
    const second = syncLayout(after, after.replace('56%', '64%'), first)
    // Important declarations in the earlier layer would beat the next edit in the later
    // layer, so retaining a stale 56% in the placeholder is observably wrong.
    expect(second).toBe(
      '.appearance{color:blue}@layer{}@layer{.card:where(#photo){width:64%!important}}',
    )
  })

  it('does not mistake equivalent flat media splitting for geometry edits', () => {
    const before = '@media(min-width:769px){.card:where(#photo){width:70%;zoom:1;color:red}}'
    const after =
      '@media(min-width:769px){.card:where(#photo){width:70%;color:orange}}@media(min-width:769px){.card:where(#photo){zoom:1}}'
    const other = ' /* independent geometry */ .card:where(#photo){width:90%;color:blue}'
    expect(syncLayout(before, after, other)).toBe(other)
  })

  it('synchronizes an earlier important geometry edit ahead of a later normal declaration', () => {
    const before =
      '@media(min-width:769px){.card:where(#photo){width:70%!important}}@media(min-width:769px){.card:where(#photo){width:40%}}'
    const next = syncLayout(before, before.replace('70%', '56%'), before)
    expect(next).toContain('width:56%!important')
    expect(next).not.toContain('width:70%!important')
  })

  it('does not synchronize losing normal geometry edits over an earlier important declaration', () => {
    const before =
      '@media(min-width:769px){.card:where(#photo){width:70%!important}}@media(min-width:769px){.card:where(#photo){width:40%}}'
    const other = ' /* independent geometry */ .card:where(#photo){width:90%;color:blue}'
    expect(syncLayout(before, before.replace('40%', '41%'), other)).toBe(other)
  })

  it('keeps source order for equally important geometry declarations', () => {
    const before =
      '@media(min-width:769px){.card:where(#photo){width:70%!important}}@media(min-width:769px){.card:where(#photo){width:40%!important}}'
    const other = ' /* independent geometry */ .card:where(#photo){width:90%;color:blue}'
    expect(syncLayout(before, before.replace('70%', '56%'), other)).toBe(other)
    expect(syncLayout(before, before.replace('40%', '56%'), before)).toContain(
      'width:56%!important',
    )
  })

  it('removes stale changed geometry from a combined counterpart guard before placing split edits', () => {
    const before =
      '.owner{width:70%;color:red;--owner-width:90%;@supports(display:grid){&:where(:hover){width:80%}}zoom:1}'
    const after = before
      .replace('width:70%;', 'width:70%;@media(min-width:769px){&:where(#card){width:56%}}')
      .replace('zoom:1', 'zoom:1;@media(min-width:769px){&:where(#card){zoom:0.8}}')
    const other = before
      .replace('color:red', 'color:blue')
      .replace('zoom:1', 'zoom:1;@media(min-width:769px){&:where(#card){width:90%;zoom:1.5}}')
    const next = syncLayout(before, after, other)
    const geometry: string[] = []
    walk(parse(next), {
      visit: 'Declaration',
      enter(node) {
        if (node.property === 'width' || node.property === 'zoom') geometry.push(generate(node))
      },
    })
    expect(geometry).toEqual(['width:70%', 'width:56%', 'width:80%', 'zoom:1', 'zoom:0.8'])
    expect(next).toContain('&:where(:hover)')
    expect(next).toContain('color:blue')
    expect(next).toContain('--owner-width:90%')
  })

  it('updates split-media geometry in a counterpart with repeated terminal target rules', () => {
    const before =
      '@media(min-width:769px){.card:where(#photo){width:70%}}@media(min-width:769px){.card:where(#photo){zoom:1}}'
    const other =
      '@media(min-width:769px){.card:where(#photo){width:90%}.card:where(#photo){zoom:1.5;color:blue}}'
    const next = syncLayout(before, before.replace('zoom:1', 'zoom:0.8'), other)
    const geometry: string[] = []
    walk(parse(next), {
      visit: 'Declaration',
      enter(node) {
        if (node.property === 'width' || node.property === 'zoom') geometry.push(generate(node))
      },
    })
    expect(geometry).toEqual(['width:90%', 'zoom:0.8'])
    expect(next).toContain('color:blue')
  })

  it('does not mistake terminal target-rule splitting for geometry edits in the reverse direction', () => {
    const before =
      '@media(min-width:769px){.card:where(#photo){width:70%}.card:where(#photo){zoom:1;color:red}}'
    const after =
      '@media(min-width:769px){.card:where(#photo){width:70%}}@media(min-width:769px){.card:where(#photo){zoom:1;color:orange}}'
    const other = ' /* independent geometry */ .card:where(#photo){width:90%;zoom:1.5;color:blue}'
    expect(syncLayout(before, after, other)).toBe(other)
  })
})

describe('resize guards on a component rule', () => {
  // A guard ties with its component rule on specificity and importance, so the last one wins.
  const valuesOf = (css: string, property: string): string[] => {
    const values: string[] = []
    walk(parse(css), {
      visit: 'Declaration',
      enter(node) {
        if (node.property === property) values.push(generate(node.value))
      },
    })
    return values
  }
  const guard = (id: string, width: string): string =>
    `@media (min-width:769px){&:where(#${id}){width:${width}!important}}`

  it('keeps every sheet ordered when one edit delivers the authored width and its guard', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const card = (lang: string): string => `cms-body-${id}-${lang}-card`
    let page = createSitePage({ id, path: '/offers', name: { sv: 'Ny', en: 'New' } })
    for (const lang of ['sv', 'en'] as const)
      page.content[lang] = {
        html: `<div id="${card(lang)}"><img src="/og-image.png"></div>`,
        css: { light: '#native{color:red}', dark: '#native{color:blue}' },
      }
    for (const [width, zoom] of [
      ['56%', '.8'],
      ['44.8%', '.64'],
      ['35.84%', '.512'],
    ] as const) {
      const edited = structuredClone(page)
      edited.content.sv.css.light = `#native{color:red}@media (min-width:769px){#${card('sv')}{width:70%!important;${guard(card('sv'), width)}justify-self:end!important;zoom:${zoom}!important}}`
      page = syncPageLayout(page, edited, 'sv', 'light')
      for (const lang of ['sv', 'en'] as const)
        for (const mode of ['light', 'dark'] as const) {
          const sheet = page.content[lang].css[mode]
          expect(valuesOf(sheet, 'width')).toEqual(['70%', width])
          expect(valuesOf(sheet, 'zoom')).toEqual([zoom])
          expect(valuesOf(sheet, 'justify-self')).toEqual(['end'])
          expect(sheet).not.toContain('{}')
        }
    }
  })

  it('moves an authored width that arrives after its guard ahead of that guard', () => {
    const before = `@media(min-width:769px){#card{color:red;${guard('card', '40%')}}}`
    const after = before.replace('color:red;', 'color:red;width:71%!important;')
    const result = syncLayout(before, after, before.replace('color:red', 'color:blue'))
    expect(valuesOf(result, 'width')).toEqual(['71%', '40%'])
    expect(result).toContain('color:blue')
    expect(result).not.toContain('{}')
  })

  it('repairs a stored guard that precedes its authored width on the next resize', () => {
    const before = `@media(min-width:769px){#card{width:70%!important;${guard('card', '40%')}}}`
    const stored = `@media (min-width:769px){#card{${guard('card', '40%')}}}@media (min-width:769px){#card{width:70%!important}}@media (min-width:769px){#card{justify-self:end!important}}`
    const result = syncLayout(before, before.replace('40%', '32%'), stored)
    expect(valuesOf(result, 'width')).toEqual(['70%', '32%'])
    expect(valuesOf(result, 'justify-self')).toEqual(['end'])
    expect(result).not.toContain('{}')
  })

  it('never moves a declaration across a media condition', () => {
    const before = `@media(min-width:769px){#card{width:70%!important;${guard('card', '40%')}}}`
    const other = `${before}@media(max-width:768px){#card{width:50%!important}}`
    const result = syncLayout(before, before.replace('40%', '32%'), other)
    expect(result).toContain('@media (max-width:768px){#card{width:50%!important}}')
    expect(valuesOf(result, 'width')).toEqual(['70%', '32%', '50%'])
  })

  it('removes only the rules a sync emptied', () => {
    const before = '@media(min-width:769px){#card{zoom:1}}'
    const result = syncLayout(
      before,
      before.replace('zoom:1', 'zoom:.8'),
      `${before}#authored{}@layer{#card{color:blue}}`,
    )
    expect(result).toBe(
      '#authored{}@layer{#card{color:blue}}@media (min-width:769px){#card{zoom:.8}}',
    )
  })

  const cardPage = (css: string): ReturnType<typeof createSitePage> => {
    const page = createSitePage({
      id: '10000000-0000-4000-8000-000000000002',
      path: '/offers',
      name: { sv: 'Ny', en: 'New' },
    })
    for (const lang of ['sv', 'en'] as const)
      page.content[lang] = {
        html: '<div id="card"><div></div></div>',
        css: { light: css, dark: css },
      }
    return page
  }
  const variantSheets = (page: ReturnType<typeof createSitePage>): [string, ...string[]] => [
    page.content.sv.css.light,
    page.content.sv.css.dark,
    page.content.en.css.light,
    page.content.en.css.dark,
  ]
  const addMargin = (
    page: ReturnType<typeof createSitePage>,
  ): ReturnType<typeof createSitePage> => {
    const edited = structuredClone(page)
    edited.content.sv.css.light += '@media (min-width:769px){#card{margin-left:10px}}'
    return syncPageLayout(page, edited, 'sv', 'light')
  }
  // The grouped rule also writes #card's width, so no move may cross it.
  const grouped = (last: string): string =>
    `#card{width:70%!important;${guard('card', '40%')}}#card, :where(#unused){width:80%!important}#card{width:${last}!important}`
  const ungrouped = (last: string): string =>
    `#card{width:70%!important;${guard('card', '40%')}}#card{width:${last}!important}`

  it('keeps the authored width behind a grouped rule when an edit adds only margin', () => {
    for (const sheet of variantSheets(addMargin(cardPage(grouped('90%'))))) {
      expect(valuesOf(sheet, 'width')).toEqual(['70%', '40%', '80%', '90%'])
      expect(valuesOf(sheet, 'margin-left')).toEqual(['10px'])
      expect(sheet).not.toContain('{}')
    }
  })

  it('does not move an unchanged width ahead of its guard when an edit changes other geometry', () => {
    for (const sheet of variantSheets(addMargin(cardPage(ungrouped('90%'))))) {
      expect(valuesOf(sheet, 'width')).toEqual(['70%', '40%', '90%'])
      expect(valuesOf(sheet, 'margin-left')).toEqual(['10px'])
    }
  })

  it('keeps a changed width after a grouped rule, so the grouped rule cannot win', () => {
    const page = cardPage(grouped('90%'))
    const edited = structuredClone(page)
    edited.content.sv.css.light = grouped('95%')
    const [edit, ...others] = variantSheets(syncPageLayout(page, edited, 'sv', 'light'))
    expect(valuesOf(edit, 'width')).toEqual(['70%', '40%', '80%', '95%'])
    for (const sheet of others) {
      // Other sheets drop their stale top-level widths, then append the changed one after the group.
      expect(valuesOf(sheet, 'width')).toEqual(['40%', '80%', '95%'])
      expect(sheet).not.toContain('{}')
    }
  })

  const editSheet = (before: string, after: string): [string, ...string[]] => {
    const page = cardPage(before)
    const edited = structuredClone(page)
    edited.content.sv.css.light = after
    return variantSheets(syncPageLayout(page, edited, 'sv', 'light'))
  }
  const middled = (middle: string, last: string): string =>
    `#card{width:70%!important;${guard('card', '40%')}}${middle}#card{width:${last}!important}`

  for (const [shape, middle, between] of [
    ['with nothing between them', '', []],
    [
      'across a media-scoped grouped rule',
      '@media (min-width:769px){#card, :where(#unused){width:80%!important}}',
      ['80%'],
    ],
    [
      'across an @supports grouped rule',
      '@supports (display:grid){#card, :where(#unused){width:80%!important}}',
      ['80%'],
    ],
  ] as const)
    it(`keeps a changed width behind its guard ${shape}`, () => {
      const [edit, ...others] = editSheet(middled(middle, '90%'), middled(middle, '95%'))
      expect(valuesOf(edit, 'width')).toEqual(['70%', '40%', ...between, '95%'])
      expect(edit).not.toContain('{}')
      for (const sheet of others) {
        // Other sheets drop their stale top-level widths, then append the changed one last.
        expect(valuesOf(sheet, 'width')).toEqual(['40%', ...between, '95%'])
        expect(sheet).not.toContain('{}')
      }
    })

  it('keeps the Desktop order when an edit changes only a Mobile width', () => {
    const sheet = (mobile: string): string =>
      `${ungrouped('90%')}@media (max-width:768px){#card{width:${mobile}!important}}`
    for (const variant of editSheet(sheet('50%'), sheet('55%')))
      expect(valuesOf(variant, 'width')).toEqual(['70%', '40%', '90%', '55%'])
  })

  it('keeps an unchanged width behind a guard the edit changes', () => {
    const sheet = (width: string): string =>
      `#card{width:70%!important;${guard('card', width)}}#card{width:90%!important}`
    for (const variant of editSheet(sheet('40%'), sheet('32%')))
      expect(valuesOf(variant, 'width')).toEqual(['70%', '32%', '90%'])
  })

  it('does not move a changed width ahead of a guard the edited sheet lacks', () => {
    const page = cardPage('#card{width:90%!important}')
    for (const lang of ['sv', 'en'] as const)
      page.content[lang].css.dark = `#card{${guard('card', '40%')}}#card{width:90%!important}`
    const edited = structuredClone(page)
    edited.content.sv.css.light = '#card{width:95%!important}'
    const next = syncPageLayout(page, edited, 'sv', 'light')
    for (const lang of ['sv', 'en'] as const) {
      expect(valuesOf(next.content[lang].css.light, 'width')).toEqual(['95%'])
      expect(valuesOf(next.content[lang].css.dark, 'width')).toEqual(['40%', '95%'])
    }
  })

  const twoGuards = (width: string, middle = ''): string =>
    `#card{width:70%!important;${guard('card', '40%')}}${middle}#card{width:${width}!important;${guard('card', '32%')}}`

  it('moves a changed width between two guards ahead of the last one', () => {
    const [edit, ...others] = editSheet(twoGuards('90%'), twoGuards('95%'))
    expect(valuesOf(edit, 'width')).toEqual(['70%', '40%', '95%', '32%'])
    for (const variant of others) {
      expect(valuesOf(variant, 'width')).toEqual(['40%', '95%', '32%'])
      expect(variant).not.toContain('{}')
    }
  })

  const mobileRule = '@media (max-width:768px){#card{width:50%!important}}'

  it('moves a changed width across nothing but the last guard', () => {
    const [, ...others] = editSheet(twoGuards('90%', mobileRule), twoGuards('95%', mobileRule))
    for (const variant of others)
      expect(valuesOf(variant, 'width')).toEqual(['40%', '50%', '95%', '32%'])
  })

  it('leaves a width between two guards in place when the last guard changes', () => {
    const sheet = (last: string): string =>
      `#card{width:70%!important;${guard('card', '40%')}}${mobileRule}#card{width:90%!important;${guard('card', last)}}`
    for (const variant of editSheet(sheet('32%'), sheet('30%')))
      expect(valuesOf(variant, 'width')).toEqual(['70%', '40%', '50%', '90%', '30%'])
  })

  it('keeps a guard behind a width changed inside @supports inside @media', () => {
    const sheet = (width: string): string =>
      `#card{width:70%!important;${guard('card', '40%')}}@media (min-width:769px){@supports (display:grid){#card{width:${width}!important}}}`
    const [, ...others] = editSheet(sheet('90%'), sheet('95%'))
    for (const variant of others) expect(valuesOf(variant, 'width')).toEqual(['70%', '40%', '95%'])
  })

  for (const wrapper of ['@supports (display:grid)', '@layer'])
    it(`keeps a guard behind a width changed inside ${wrapper}`, () => {
      const sheet = (width: string): string =>
        `#card{width:70%!important;${guard('card', '40%')}}${wrapper}{#card{width:${width}!important}}`
      const [, ...others] = editSheet(sheet('90%'), sheet('95%'))
      for (const variant of others)
        expect(valuesOf(variant, 'width')).toEqual(['70%', '40%', '95%'])
    })

  // One grouped Desktop block: a resize guard, then a deliberate narrow-Desktop rule. All three
  // widths apply at 820px, so the 90% rule wins there only while it stays last.
  const narrowDesktop = (first: string, width: string, appended = ''): string =>
    `@media (min-width:769px){${first}#card{width:70%!important;${guard('card', width)}}@media (max-width:1100px){#card{width:90%!important}}}${appended}`
  const resizeAfterPadding = (
    first: string,
    padded: string,
    resized: string,
    fixture = narrowDesktop,
  ): [string, ...string[]] => {
    let page = cardPage(fixture(first, '40%'))
    // Two separate edits, each synchronized from the stored result of the one before.
    for (const css of [padded, resized]) {
      const edited = structuredClone(page)
      edited.content.sv.css.light = css
      page = syncPageLayout(page, edited, 'sv', 'light')
    }
    return variantSheets(page)
  }
  const paddingRule = '@media (min-width:769px){#card{padding-left:10px}}'
  const resizedRule = '@media (min-width:769px){#card{padding-left:10px;zoom:0.8}}'

  // The editor imports the grouped block as one rule, so a Desktop edit adds a separate rule. The
  // padding change empties the first #card block in the other sheets, and only there.
  for (const [shape, padded, resized] of [
    [
      'adds a Desktop rule',
      narrowDesktop('#card{padding-left:1px}', '40%', paddingRule),
      narrowDesktop('#card{padding-left:1px}', '32%', resizedRule),
    ],
    [
      'changes the first rule in place',
      narrowDesktop('#card{padding-left:10px}', '40%'),
      narrowDesktop('#card{padding-left:10px}', '32%'),
    ],
  ] as const)
    it(`replaces a resized guard ahead of a later narrow-Desktop rule after an edit that ${shape}`, () => {
      const [edit, ...others] = resizeAfterPadding('#card{padding-left:1px}', padded, resized)
      expect(edit).toBe(resized)
      for (const sheet of others) {
        // 40% is replaced, not kept beside 32%, and 32% stays ahead of the narrow-Desktop rule.
        expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '90%'])
        expect(valuesOf(sheet, 'padding-left')).toEqual(['10px'])
      }
    })

  // Controls: the counterparts keep the earlier block, so the guard keeps its identity.
  for (const [control, first] of [
    ['keeps another declaration', '#card{padding-left:1px;color:black}'],
    ['styles another element', '#other{padding-left:1px}'],
  ] as const)
    it(`replaces a resized guard in place when the earlier block ${control}`, () => {
      const [edit, ...others] = resizeAfterPadding(
        first,
        narrowDesktop(first, '40%', paddingRule),
        narrowDesktop(first, '32%', resizedRule),
      )
      for (const sheet of [edit, ...others])
        expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '90%'])
    })

  // A guard inside @supports is named by its nearest differently headed siblings: the #card rules
  // around it. Removing the emptied first rule renumbers those as well.
  const supported =
    (later: string) =>
    (first: string, width: string, appended = ''): string =>
      `@media (min-width:769px){${first}#card{width:70%!important}@supports (display:grid){#card{${guard('card', width)}}}${later}}${appended}`
  const laterRules = [
    [
      'a narrow-Desktop rule',
      '#card{color:red}@media (max-width:1100px){#card{width:90%!important}}',
    ],
    ['a later Desktop rule', '#card{width:90%!important}'],
  ] as const
  for (const [shape, later] of laterRules)
    it(`replaces a resized guard inside @supports ahead of ${shape} after a padding edit`, () => {
      const fixture = supported(later)
      const first = '#card{padding-left:1px}'
      const resized = fixture(first, '32%', resizedRule)
      const [edit, ...others] = resizeAfterPadding(
        first,
        fixture(first, '40%', paddingRule),
        resized,
        fixture,
      )
      expect(edit).toBe(resized)
      for (const sheet of others) {
        expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '90%'])
        expect(valuesOf(sheet, 'padding-left')).toEqual(['10px'])
      }
    })

  it('keeps the guard identity when the next resize is made in a synced sheet', () => {
    const first = '#card{padding-left:1px}'
    let page = cardPage(narrowDesktop(first, '40%'))
    const edit = (mode: 'light' | 'dark', css: string): void => {
      const edited = structuredClone(page)
      edited.content.sv.css[mode] = css
      page = syncPageLayout(page, edited, 'sv', mode)
    }
    edit('light', narrowDesktop(first, '40%', paddingRule))
    edit('light', narrowDesktop(first, '32%', resizedRule))
    // The dark sheet dropped the emptied rule, so it numbers the guard's rule one lower than light.
    edit('dark', page.content.sv.css.dark.replace('32%', '25.6%'))
    for (const sheet of variantSheets(page))
      expect(valuesOf(sheet, 'width')).toEqual(['70%', '25.6%', '90%'])
  })

  // The cleanup still drops the rules a sync emptied.
  for (const [shape, before, after] of [
    [
      'the same edit removes the guard after it',
      narrowDesktop('#card{padding-left:1px}', '40%'),
      '@media (min-width:769px){#card{padding-left:10px}#card{width:70%!important}@media (max-width:1100px){#card{width:90%!important}}}',
    ],
    [
      'it styles another element',
      narrowDesktop('#other{padding-left:1px}', '40%'),
      narrowDesktop(
        '#other{padding-left:1px}',
        '40%',
        '@media (min-width:769px){#other{padding-left:10px}}',
      ),
    ],
  ] as const)
    it(`drops an emptied rule when ${shape}`, () => {
      const page = cardPage(before)
      for (const lang of ['sv', 'en'] as const) page.content[lang].html += '<div id="other"></div>'
      const edited = structuredClone(page)
      edited.content.sv.css.light = after
      const [, ...others] = variantSheets(syncPageLayout(page, edited, 'sv', 'light'))
      for (const sheet of others) {
        expect(sheet).not.toContain('{}')
        expect(valuesOf(sheet, 'padding-left')).toEqual(['10px'])
      }
    })

  /** The four sheets after each edit, each synchronized from the stored result of the one before. */
  const syncEach = (start: string, edits: readonly string[]): [string, ...string[]][] => {
    let page = cardPage(start)
    return edits.map((css) => {
      const edited = structuredClone(page)
      edited.content.sv.css.light = css
      page = syncPageLayout(page, edited, 'sv', 'light')
      return variantSheets(page)
    })
  }
  const original = narrowDesktop('#card{padding-left:1px}', '40%')
  // The edited sheet drops its first rule as well, directly or after a padding edit has emptied
  // the other sheets' copy of it. Then all four sheets hold the same rules around the guard again.
  const droppedFirst = [
    ['before the resize', [narrowDesktop('', '40%'), narrowDesktop('', '32%')], []],
    [
      'after a padding edit that adds a rule',
      [
        narrowDesktop('#card{padding-left:1px}', '40%', paddingRule),
        narrowDesktop('', '40%', paddingRule),
        narrowDesktop('', '32%', resizedRule),
      ],
      ['10px'],
    ],
    [
      'after a padding edit in place',
      [
        narrowDesktop('#card{padding-left:10px}', '40%'),
        narrowDesktop('', '40%'),
        narrowDesktop('', '32%'),
      ],
      [],
    ],
    [
      'in the same edit as the resize',
      [
        narrowDesktop('#card{padding-left:1px}', '40%', paddingRule),
        narrowDesktop('', '32%', resizedRule),
      ],
      ['10px'],
    ],
  ] as const
  for (const [shape, edits, padding] of droppedFirst)
    it(`replaces a resized guard in place when the edited sheet drops its first rule ${shape}`, () => {
      const sheets = syncEach(original, edits).at(-1) ?? []
      expect(sheets).toHaveLength(4)
      for (const sheet of sheets) {
        expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '90%'])
        expect(valuesOf(sheet, 'padding-left')).toEqual(padding)
      }
    })

  it('replaces two resized guards in place after a padding edit empties the rule before both', () => {
    const block = (first: string, widths: [string, string], appended = ''): string =>
      `@media (min-width:769px){${first}#card{width:70%!important;${guard('card', widths[0])}}#card{width:75%!important;${guard('card', widths[1])}}@media (max-width:1100px){#card{width:90%!important}}}${appended}`
    const first = '#card{padding-left:1px}'
    const sheets = syncEach(block(first, ['40%', '35%']), [
      block(first, ['40%', '35%'], paddingRule),
      block(first, ['32%', '28%'], resizedRule),
    ]).at(-1)
    for (const sheet of sheets ?? [])
      expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '75%', '28%', '90%'])
    expect(sheets).toHaveLength(4)
  })

  // A first resize nests the guard in the rule that holds the authored width. The padding edit
  // before it emptied the first #card rule in the other sheets, and only there.
  const unresized = (first: string, appended = ''): string =>
    `@media (min-width:769px){${first}#card{width:70%!important}@media (max-width:1100px){#card{width:90%!important}}}${appended}`
  const firstResize = [
    [
      'adds a Desktop rule',
      unresized('#card{padding-left:1px}', paddingRule),
      narrowDesktop('#card{padding-left:1px}', '32%', resizedRule),
    ],
    [
      'changes the first rule in place',
      unresized('#card{padding-left:10px}'),
      narrowDesktop('#card{padding-left:10px}', '32%'),
    ],
  ] as const
  for (const [shape, padded, resized] of firstResize)
    it(`nests a first guard ahead of a later narrow-Desktop rule after an edit that ${shape}`, () => {
      const [edit, ...others] =
        syncEach(unresized('#card{padding-left:1px}'), [padded, resized]).at(-1) ?? []
      expect(edit).toBe(resized)
      expect(others).toHaveLength(3)
      for (const sheet of others) {
        // 32% follows the authored width and stays ahead of the narrow-Desktop rule.
        expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '90%'])
        expect(valuesOf(sheet, 'padding-left')).toEqual(['10px'])
      }
    })

  // Appearance belongs to one theme, so the light sheets can hold a color rule for the card that
  // the dark sheets lack, ahead of the rule that gains the guard.
  for (const [shape, tint] of [
    [
      'a Desktop group of its own',
      (css: string): string => `@media (min-width:769px){#card{color:red}}${css}`,
    ],
    [
      'the grouped block',
      (css: string): string =>
        css.replace('@media (min-width:769px){', '@media (min-width:769px){#card{color:red}'),
    ],
  ] as const)
    it(`nests a first guard ahead of a later narrow-Desktop rule when only the light sheets hold a color rule in ${shape}`, () => {
      const [, padded, resized] = firstResize[0]
      const start = unresized('#card{padding-left:1px}')
      let page = cardPage(start)
      for (const lang of ['sv', 'en'] as const) page.content[lang].css.light = tint(start)
      for (const css of [padded, resized]) {
        const edited = structuredClone(page)
        edited.content.sv.css.light = tint(css)
        page = syncPageLayout(page, edited, 'sv', 'light')
      }
      for (const sheet of variantSheets(page))
        expect(valuesOf(sheet, 'width')).toEqual(['70%', '32%', '90%'])
    })

  // Layout drift that no sync touched: the dark sheets hold one more width rule ahead of the
  // card's rule, so the width rules number it differently there and only its occurrence names it.
  it('nests a first guard in place where another sheet holds more width rules ahead of it', () => {
    const block = (first: string, guarded = ''): string =>
      `@media (min-width:769px){${first}#card{width:70%!important${guarded}}@media (max-width:1100px){#card{width:90%!important}}}`
    const page = cardPage(block('#card{padding-left:1px}'))
    for (const lang of ['sv', 'en'] as const)
      page.content[lang].css.dark = block('#card{width:50%}')
    const edited = structuredClone(page)
    edited.content.sv.css.light = block('#card{padding-left:1px}', `;${guard('card', '32%')}`)
    const next = syncPageLayout(page, edited, 'sv', 'light')
    for (const lang of ['sv', 'en'] as const)
      expect(next.content[lang].css.dark).toBe(
        block('#card{width:50%}', `;${guard('card', '32%')}`),
      )
  })

  // The card's rules sit inside the rule of the element around it, which declares a width too.
  // css-tree reads a nested rule only when it starts with &, and no plain edit reaches such a
  // rule, so here the rule ahead of the card's rule empties when its guard is removed. The edited
  // sheet keeps it empty and the other sheets drop it. The first guard belongs to the innermost
  // rule that holds it.
  it('nests a first guard in its own rule when that rule is nested in another rule that declares a width', () => {
    const wrapped = (first: string, guarded = ''): string =>
      `@media (min-width:769px){#other{width:50%;${first}& #card{width:70%!important${guarded}}@media (max-width:1100px){& #card{width:90%!important}}}}`
    const nested = `;${guard('card', '32%')}`
    const resized = wrapped('& #card{}', nested)
    const [edit, ...others] =
      syncEach(wrapped(`& #card{${guard('card', '40%')}}`), [wrapped('& #card{}'), resized]).at(
        -1,
      ) ?? []
    expect(edit).toBe(resized)
    expect(others).toHaveLength(3)
    for (const sheet of others) expect(sheet).toBe(wrapped('', nested))
  })

  // What a guard competes with, in source order: each declaration of a property that a guard
  // writes, with every rule and at-rule around it and the guards marked. Values may differ per
  // sheet, so they are left out.
  const guardLayout = (css: string): string[] => {
    const found: { scope: string[]; property: string }[] = []
    const visit = (nodes: List<CssNode> | undefined, scope: string[]): void =>
      nodes?.forEach((node) => {
        if (node.type === 'Declaration') found.push({ scope, property: node.property })
        else if (node.type === 'Rule')
          visit(node.block.children, [...scope, generate(node.prelude)])
        else if (node.type === 'Atrule')
          visit(node.block?.children, [
            ...scope,
            `@${node.name}${node.prelude ? ` ${generate(node.prelude)}` : ''}`,
          ])
      })
    const tree = parse(css)
    if (tree.type !== 'StyleSheet') throw new Error('The stylesheet is missing')
    visit(tree.children, [])
    const isGuard = (scope: string[]): boolean => scope.at(-1)?.startsWith('&:where(') ?? false
    const guarded = new Set(
      found.filter(({ scope }) => isGuard(scope)).map(({ property }) => property),
    )
    return found
      .filter(({ property }) => guarded.has(property))
      .map(({ scope, property }) =>
        [...scope, isGuard(scope) ? `${property} (guard)` : property].join(' > '),
      )
  }

  // After every sync, each sheet holds the guard where the edited sheet holds it, between the
  // same rules, so the next resize finds it there. Edits before a first resize write no guard,
  // so after those no sheet holds one.
  for (const [sequence, start, edits, guardless = 0] of [
    [
      'a padding edit that adds a rule',
      original,
      [
        narrowDesktop('#card{padding-left:1px}', '40%', paddingRule),
        narrowDesktop('#card{padding-left:1px}', '32%', resizedRule),
      ],
    ],
    [
      'a padding edit in place',
      original,
      [
        narrowDesktop('#card{padding-left:10px}', '40%'),
        narrowDesktop('#card{padding-left:10px}', '32%'),
      ],
    ],
    ...laterRules.map(([shape, later]) => {
      const fixture = supported(later)
      const first = '#card{padding-left:1px}'
      return [
        `a padding edit before a guard inside @supports ahead of ${shape}`,
        fixture(first, '40%'),
        [fixture(first, '40%', paddingRule), fixture(first, '32%', resizedRule)],
      ] as const
    }),
    ...droppedFirst.map(
      ([shape, edits]) =>
        [`the edited sheet dropping its first rule ${shape}`, original, edits] as const,
    ),
    ...firstResize.map(
      ([shape, padded, resized]) =>
        [
          `a padding edit that ${shape}, a first resize and the next one`,
          unresized('#card{padding-left:1px}'),
          [padded, resized, resized.replace('32%', '25.6%')],
          1,
        ] as const,
    ),
    [
      'a padding edit and a first resize in one edit',
      unresized('#card{padding-left:1px}'),
      [narrowDesktop('#card{padding-left:1px}', '32%', resizedRule)],
    ],
  ] as const)
    it(`gives every sheet the edited sheet's guard layout after each sync of ${sequence}`, () => {
      for (const [step, [edit, ...others]] of syncEach(start, edits).entries()) {
        const layout = guardLayout(edit)
        expect(layout.filter((entry) => entry.endsWith('(guard)'))).toHaveLength(
          step < guardless ? 0 : 1,
        )
        for (const sheet of others) expect(guardLayout(sheet)).toEqual(layout)
      }
    })

  // A sync appends a changed plain rule at the end, so another sheet can hold more rules under a
  // header than the edited sheet. They follow every earlier one, so the guard's bound still holds.
  it('nests a first guard in place when the sync appended a copy of the rule that bounds it', () => {
    const sheet = (other: string, guarded = ''): string =>
      `@media (min-width:769px){#card{width:70%!important${guarded}}@media (max-width:1100px){#card{width:90%!important}}}#other{color:red;width:${other}}@media (min-width:769px){#card{padding-left:1px}}`
    let page = cardPage(sheet('10px'))
    for (const lang of ['sv', 'en'] as const) page.content[lang].html += '<div id="other"></div>'
    for (const css of [sheet('20px'), sheet('20px', `;${guard('card', '32%')}`)]) {
      const edited = structuredClone(page)
      edited.content.sv.css.light = css
      page = syncPageLayout(page, edited, 'sv', 'light')
    }
    const [edit, ...others] = variantSheets(page)
    for (const variant of others) {
      expect(variant).toContain('#other{color:red}')
      expect(variant).toContain('#other{width:20px}')
      expect(guardLayout(variant)).toEqual(guardLayout(edit))
    }
  })

  // Controls: no sync drops a rule here, so a rule that gains its first guard or loses its last
  // one leaves every sheet numbered alike. The four sheets start alike, and every sync keeps them.
  const desktop = (rules: string): string =>
    `@media (min-width:769px){${rules}@media (max-width:1100px){#card{width:90%!important}}}`
  const sized = (width: string, guarded = ''): string =>
    `#card{width:${width}!important${guarded && `;${guard('card', guarded)}`}}`
  for (const [shape, start, edits] of [
    [
      'an earlier rule gains a guard while a later guard is resized',
      desktop(sized('70%') + sized('80%', '40%')),
      [desktop(sized('70%', '50%') + sized('80%', '32%'))],
    ],
    [
      'an earlier rule gains a guard, then a later guard is resized',
      desktop(sized('70%') + sized('80%', '40%')),
      [
        desktop(sized('70%', '50%') + sized('80%', '40%')),
        desktop(sized('70%', '50%') + sized('80%', '32%')),
      ],
    ],
    [
      'an earlier rule loses its guard, then a later guard is resized',
      desktop(sized('70%', '50%') + sized('80%', '40%')),
      [desktop(sized('70%') + sized('80%', '40%')), desktop(sized('70%') + sized('80%', '32%'))],
    ],
    [
      'a first resize nests a guard in its rule, then the next one resizes it',
      desktop(sized('70%')),
      [desktop(sized('70%', '32%')), desktop(sized('70%', '25.6%'))],
    ],
  ] as const)
    it(`keeps every sheet equal to the edited sheet when ${shape}`, () => {
      for (const [edit, ...others] of syncEach(start, edits))
        for (const sheet of others) expect(sheet).toBe(edit)
    })
})

describe('conditional component geometry', () => {
  /** Each declaration of `property` in source order, with every rule and at-rule around it. */
  const scoped = (css: string, property: string): string[] => {
    const found: string[] = []
    const visit = (nodes: List<CssNode> | undefined, scope: string[]): void =>
      nodes?.forEach((node) => {
        if (node.type === 'Declaration') {
          if (node.property === property) found.push([...scope, generate(node)].join(' > '))
        } else if (node.type === 'Rule')
          visit(node.block.children, [...scope, generate(node.prelude)])
        else if (node.type === 'Atrule')
          visit(node.block?.children, [
            ...scope,
            `@${node.name}${node.prelude ? ` ${generate(node.prelude)}` : ''}`,
          ])
      })
    const tree = parse(css)
    if (tree.type !== 'StyleSheet') throw new Error('The stylesheet is missing')
    visit(tree.children, [])
    return found
  }

  // A plain component rule inside @supports, @layer or @container applies under its own
  // conditions, so a change of the unconditional rule must neither remove nor absorb it.
  for (const wrapper of [
    '@supports (display:grid)',
    '@layer',
    '@layer owners',
    '@container (min-width:300px)',
  ]) {
    it(`keeps a same-selector rule inside ${wrapper} when the top-level rule after it changes`, () => {
      const before = `${wrapper}{#card{width:20px}}#card{width:10px}`
      const after = before.replace('10px', '11px')
      expect(scoped(syncLayout(before, after, before), 'width')).toEqual(scoped(after, 'width'))
    })

    it(`synchronizes a top-level change ahead of a same-selector rule inside ${wrapper}`, () => {
      const before = `#card{width:10px}${wrapper}{#card{width:20px}}`
      const after = before.replace('10px', '11px')
      expect(scoped(syncLayout(before, after, before), 'width').sort()).toEqual(
        scoped(after, 'width').sort(),
      )
    })
  }

  const cardPage = (css: string): ReturnType<typeof createSitePage> => {
    const page = createSitePage({
      id: '10000000-0000-4000-8000-000000000003',
      path: '/offers',
      name: { sv: 'Ny', en: 'New' },
    })
    for (const lang of ['sv', 'en'] as const)
      page.content[lang] = {
        html: '<div id="card"><div></div></div>',
        css: { light: css, dark: css },
      }
    return page
  }

  // The other language and theme receive a changed plain-ID width under all of its conditions.
  for (const [label, wrap] of [
    [
      '@supports inside Desktop media',
      (rule: string) => `@media (min-width:769px){@supports (display:grid){${rule}}}`,
    ],
    [
      'Desktop media inside @supports',
      (rule: string) => `@supports (display:grid){@media (min-width:769px){${rule}}}`,
    ],
    [
      'narrow-Desktop media inside Desktop media',
      (rule: string) => `@media (min-width:769px){@media (max-width:1100px){${rule}}}`,
    ],
    [
      'Desktop media inside a named layer',
      (rule: string) => `@layer owners{@media (min-width:769px){${rule}}}`,
    ],
    ['a container query', (rule: string) => `@container (min-width:300px){${rule}}`],
  ] as const)
    it(`synchronizes a deliberate width change inside ${label} with its conditions`, () => {
      const sheet = (width: string): string => wrap(`#card{width:${width}!important}`)
      const page = cardPage(sheet('200px'))
      const edited = structuredClone(page)
      edited.content.sv.css.light = sheet('220px')
      const next = syncPageLayout(page, edited, 'sv', 'light')
      for (const lang of ['sv', 'en'] as const)
        for (const mode of ['light', 'dark'] as const)
          expect(scoped(next.content[lang].css[mode], 'width')).toEqual(
            scoped(sheet('220px'), 'width'),
          )
    })

  // A text element's changed width brings its text height along, under the same conditions.
  it('adds the text height of a conditional width change under its conditions', () => {
    const sheet = (width: string): string =>
      `@media (min-width:769px){@supports (display:grid){#card{width:${width}!important}}}`
    const page = cardPage(sheet('200px'))
    for (const lang of ['sv', 'en'] as const) page.content[lang].html = '<p id="card">Text</p>'
    const edited = structuredClone(page)
    edited.content.sv.css.light = sheet('220px')
    const next = syncPageLayout(page, edited, 'sv', 'light')
    for (const lang of ['sv', 'en'] as const)
      for (const mode of ['light', 'dark'] as const)
        for (const [property, value] of [
          ['width', '220px'],
          ['height', 'auto'],
          ['max-height', 'none'],
        ] as const)
          expect(scoped(next.content[lang].css[mode], property)).toEqual([
            `@media (min-width:769px) > @supports (display:grid) > #card > ${property}:${value}!important`,
          ])
  })

  // A changed rule goes back where the edited sheet holds it: ahead of a later rule for the same
  // element, which keeps the last word wherever both apply.
  for (const [shape, sheet] of [
    [
      'ahead of a narrow-Desktop rule',
      (width: string): string =>
        `#card{width:${width}}@media (max-width:1100px){#card{width:20px}}`,
    ],
    [
      'in its Desktop group ahead of a narrow-Desktop rule',
      (width: string): string =>
        `@media (min-width:769px){#card{width:${width}}@media (max-width:1100px){#card{width:20px}}}`,
    ],
    [
      'ahead of a same-selector rule inside @supports',
      (width: string): string => `#card{width:${width}}@supports (display:grid){#card{width:20px}}`,
    ],
  ] as const)
    it(`keeps a changed width ${shape}`, () => {
      expect(syncLayout(sheet('10px'), sheet('11px'), sheet('10px'))).toBe(sheet('11px'))
    })

  // Where the edited sheet holds the changed rule after the later one, the change comes last.
  it('appends a changed width that the edited sheet holds after a narrow-Desktop rule', () => {
    const narrow = '@media (max-width:1100px){#card{width:20px}}'
    const before = `#card{width:10px}${narrow}`
    expect(syncLayout(before, `${before}#card{width:11px}`, before)).toBe(
      `${narrow}#card{width:11px}`,
    )
  })

  // Only a later plain rule for the same element holds a change back from the end.
  for (const [follower, later] of [
    ["another element's rule", '#other{width:5px}'],
    ['a resolver override', '.sec :where(#card){width:5px}'],
  ] as const)
    it(`keeps a changed Desktop width after the element's unconditional rule when ${follower} follows`, () => {
      const sheet = (width: string): string =>
        `#card{width:50%}@media (min-width:769px){#card{width:${width}}}${later}`
      const result = syncLayout(sheet('10px'), sheet('11px'), sheet('10px'))
      expect(scoped(result, 'width').filter((entry) => !entry.endsWith('width:5px'))).toEqual([
        '#card > width:50%',
        '@media (min-width:769px) > #card > width:11px',
      ])
    })

  // Each anonymous layer is a layer of its own, so a change stays in the layer it was made in.
  for (const [layer, after] of [
    ['the first', '@layer{#card{width:25px}}@layer{#card{width:30px}}'],
    ['the second', '@layer{#card{width:20px}}@layer{#card{width:35px}}'],
  ] as const)
    it(`keeps a width changed in ${layer} of two anonymous layers inside that layer`, () => {
      const before = '@layer{#card{width:20px}}@layer{#card{width:30px}}'
      expect(syncLayout(before, after, before)).toBe(after)
    })

  // A new conditional rule arrives under its conditions and leaves the unconditional rule alone.
  for (const wrapper of ['@supports (display:grid)', '@layer owners'])
    it(`adds a same-selector rule inside ${wrapper} that another sheet lacks`, () => {
      const before = '#card{width:10px;color:blue}'
      const after = `#card{width:10px;color:red}${wrapper}{#card{width:20px}}`
      expect(syncLayout(before, after, before)).toBe(`${before}${wrapper}{#card{width:20px}}`)
    })

  // A rule can hold another element's rule inside a layer. The change replaces that copy.
  for (const layer of ['@layer', '@layer owners'])
    it(`replaces a width changed in ${layer} nested in a parent rule`, () => {
      const sheet = (width: string): string => `#parent{${layer}{#card{width:${width}}}}`
      expect(syncLayout(sheet('10px'), sheet('11px'), sheet('10px'))).toBe(sheet('11px'))
    })

  // The nested copy has conditions of its own, so a change outside the parent rule leaves it.
  for (const [shape, changed] of [
    ['a top-level rule for the element', (width: string): string => `#card{width:${width}}`],
    [
      'the element in a top-level layer',
      (width: string): string => `@layer{#card{width:${width}}}`,
    ],
  ] as const)
    it(`leaves a width in a layer nested in a parent rule alone when ${shape} changes`, () => {
      const sheet = (width: string): string => `${changed(width)}#parent{@layer{#card{width:20px}}}`
      const result = syncLayout(sheet('10px'), sheet('11px'), sheet('10px'))
      expect(scoped(result, 'width').sort()).toEqual(scoped(sheet('11px'), 'width').sort())
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
