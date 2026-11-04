import { describe, expect, it } from 'vitest'
import { generate, ident, parse, walk, type CssNode, type Selector } from 'css-tree'
import { extractAboutSheet, stripHomeSheet } from '../../src/admin/cms/composedCanvas'

// A Home save splits the composed canvas sheet, Home's stored sheet followed by About's, between
// the two pages. These run the split without markup: About's section holds `about` and Home holds
// `home`.
const home = 'home'
const about = 'about'
const aboutIds = new Set([about])
const homeIds = new Set([home])

function split(homeCss: string, aboutCss: string): { home: string; about: string } {
  const canvas = homeCss + aboutCss
  const owners = { home: homeCss, about: aboutCss }
  return {
    home: stripHomeSheet(canvas, aboutIds, { ...owners, own: homeIds }),
    about: extractAboutSheet(canvas, aboutIds, homeIds, owners),
  }
}

describe('selector alternatives naming both pages', () => {
  it.each([
    [':is(#home,#about){--x:1}', ':is(#home){--x:1}', ':is(#about){--x:1}'],
    [':where(#home,#about){--x:1}', ':where(#home){--x:1}', ':where(#about){--x:1}'],
    [':where(:is(#home,#about)){--x:1}', ':where(:is(#home)){--x:1}', ':where(:is(#about)){--x:1}'],
    [
      ':not(:not(:is(#home,#about))){--x:1}',
      ':not(:not(:is(#home))){--x:1}',
      ':not(:not(:is(#about))){--x:1}',
    ],
    [':not(:not(#home,#about)){--x:1}', ':not(:not(#home)){--x:1}', ':not(:not(#about)){--x:1}'],
    [':is(#home,#about) .label{--x:1}', ':is(#home) .label{--x:1}', ':is(#about) .label{--x:1}'],
    [
      '@media (min-width:1px){:is(#home,#about){--x:1}}',
      '@media (min-width:1px){:is(#home){--x:1}}',
      '@media (min-width:1px){:is(#about){--x:1}}',
    ],
    [
      '@supports (display:grid){@media (min-width:1px){:is(#home,#about)::before{--x:1}}}',
      '@supports (display:grid){@media (min-width:1px){:is(#home)::before{--x:1}}}',
      '@supports (display:grid){@media (min-width:1px){:is(#about)::before{--x:1}}}',
    ],
  ])('gives each page its own alternatives of Home rule %s', (rule, homeRule, aboutRule) => {
    expect(split(rule, '')).toEqual({ home: homeRule, about: aboutRule })
  })

  it('gives each page its own alternatives of an About rule, and keeps an unsplit About rule out of Home', () => {
    expect(split('', ':is(#home,#about){--x:1}#about,.label{--y:1}')).toEqual({
      home: ':is(#home){--x:1}',
      about: ':is(#about){--x:1}#about,.label{--y:1}',
    })
  })

  it.each([
    // An ID inside :not() only excludes, and one inside :has() tests a relative: neither decides.
    '#home:not(:is(#about,.none)){--x:1}',
    '.label:has(:is(#home,#about)){--x:1}',
  ])('leaves %s where its alternatives do not decide the page', (rule) => {
    expect(split(rule, '').home).toBe(rule)
  })

  it('drops a selector whose every alternative names the other page, as before', () => {
    expect(split(':is(#about,#about .label){--x:1}', '')).toEqual({
      home: '',
      about: ':is(#about,#about .label){--x:1}',
    })
  })
})

// A rule that names its element by attribute stays whole in the sheet that stores it: splitting
// reads `#` alone. Home's export still recognises About's copy of a rule that styles only About's
// section, as `[id="x"]` with the `=` matcher does; About's rules that name none of its IDs are
// shared site CSS and stay in Home.
describe('id attribute selectors', () => {
  it.each([
    ['[id="about"]{--x:1}', '[id="about"]{--x:1}'],
    ['[id=about]{--x:1}', '[id=about]{--x:1}'],
    ['[ID="about"]{--x:1}', '[ID="about"]{--x:1}'],
    ['[\\69 d="about"]{--x:1}', '[\\69 d="about"]{--x:1}'],
    ['[id=\\61 bout]{--x:1}', '[id=\\61 bout]{--x:1}'],
    ['[id="\\61 bout"]{--x:1}', '[id="about"]{--x:1}'],
    ['[*|id="about"]{--x:1}', '[*|id="about"]{--x:1}'],
    ['[|id="about"]{--x:1}', '[|id="about"]{--x:1}'],
    ['[id="about" s]{--x:1}', '[id="about"s]{--x:1}'],
    ['.label[id="about"]{--x:1}', '.label[id="about"]{--x:1}'],
  ])("keeps About's copy of About-only rule %s out of Home's export", (rule, kept) => {
    expect(split('', rule)).toEqual({ home: '', about: kept })
  })

  it.each([
    ['[id="ABOUT" i]{--x:1}', '[id="ABOUT"i]{--x:1}'],
    ['[id="About" I]{--x:1}', '[id="About"I]{--x:1}'],
    ['[id="ABOUT" \\69]{--x:1}', '[id="ABOUT"\\69]{--x:1}'],
  ])('compares the ID of %s ignoring ASCII case', (rule, kept) => {
    expect(split('', rule)).toEqual({ home: '', about: kept })
  })

  it.each([
    // Without the flag the value matches neither page's element.
    '[id="ABOUT"]{--x:1}',
    '[id^="about"]{--x:1}',
    '[id*="about"]{--x:1}',
    '[id$="about"]{--x:1}',
    '[id~="about"]{--x:1}',
    '[id|="about"]{--x:1}',
    '[id]{--x:1}',
    '[data-id="about"]{--x:1}',
    // An ID inside :not() only excludes About's element.
    '.label:not([id="about"]){--x:1}',
  ])('leaves About rule %s shared: it names no ID where it decides', (rule) => {
    expect(split('', rule)).toEqual({ home: rule, about: rule })
  })

  it.each([
    [':is(#home,[id="about"]){--x:1}', ':is([id="about"],:not(*,#knc-never)){--x:1}'],
    ['#home,[id="about"]{--x:1}', '[id="about"]{--x:1}'],
  ])("keeps About's rule %s whole in Home: it still names Home's element by #", (rule, kept) => {
    expect(split('', rule)).toEqual({ home: rule, about: kept })
  })

  // The sheets of the Studio test of selector alternatives, as Home's save splits them.
  it("leaves no About rule in Home's export of the cross-page selectors", () => {
    const crossHome = 'knc-desktop-home-0-i0'
    const crossAbout = 'knc-about-0-i0'
    const homeCss = [
      `:is(#${crossHome},#${crossAbout}){--cross-mixed:17px;outline:17px solid red!important}`,
      `#${crossHome},#${crossAbout}{--cross-plain:19px}`,
      `:where(#${crossHome},#${crossAbout}){--cross-where:1}`,
      `:where(:is(#${crossHome},#${crossAbout})){--cross-nested:1}`,
      `:not(:not(:is(#${crossHome},#${crossAbout}))){--cross-double-negation:1}`,
      `:is(#${crossHome},:where(#${crossAbout})){--cross-specificity:1}`,
      `[id="${crossHome}"]{--cross-specificity:0}`,
      `:is(#${crossHome},#${crossAbout}):not(:is(#${crossAbout})){--cross-except:1}`,
      `#${crossHome}:not(:is(#${crossAbout},.cross-none)){--cross-negated:1}`,
      `@media (min-width:1px){:is(#${crossHome},#${crossAbout}){--cross-media:1}}`,
      `@media (min-width:1px){#${crossHome},#${crossAbout}{--cross-media-plain:1}}`,
      `#${crossHome}{--home-control:23px}`,
    ].join('')
    const aboutCss = [
      `[id="${crossAbout}"]{--cross-specificity:0}`,
      `:is(#${crossHome},#${crossAbout}){--cross-about-is:1}`,
      `#${crossHome},#${crossAbout}{--cross-about-plain:1}`,
      `#${crossAbout}{--about-control:25px}`,
    ].join('')
    const owners = { home: homeCss, about: aboutCss }
    const own = new Set([crossHome])
    const exported = stripHomeSheet(homeCss + aboutCss, new Set([crossAbout]), { ...owners, own })
    expect(exported).toBe(
      [
        `:is(#${crossHome}){--cross-mixed:17px;outline:17px solid red!important}`,
        `#${crossHome}{--cross-plain:19px}`,
        `:where(#${crossHome}){--cross-where:1}`,
        `:where(:is(#${crossHome})){--cross-nested:1}`,
        `:not(:not(:is(#${crossHome}))){--cross-double-negation:1}`,
        `:is(#${crossHome}){--cross-specificity:1}`,
        `[id="${crossHome}"]{--cross-specificity:0}`,
        `:is(#${crossHome}):not(:is(#${crossAbout})){--cross-except:1}`,
        `#${crossHome}:not(:is(#${crossAbout},.cross-none)){--cross-negated:1}`,
        `@media (min-width:1px){:is(#${crossHome}){--cross-media:1}}`,
        `@media (min-width:1px){#${crossHome}{--cross-media-plain:1}}`,
        `#${crossHome}{--home-control:23px}`,
        `:is(#${crossHome}){--cross-about-is:1}`,
        `#${crossHome}{--cross-about-plain:1}`,
      ].join(''),
    )
    // Home's sheet alone gives About's element nothing: About's ID stands only inside :not().
    let negations = 0
    walk(parse(exported), {
      enter(node: CssNode) {
        if (node.type === 'PseudoClassSelector' && node.name === 'not') negations++
        const id =
          node.type === 'IdSelector'
            ? node.name
            : node.type === 'AttributeSelector' && node.value?.type === 'String'
              ? node.value.value
              : undefined
        if (id === crossAbout) expect(negations).toBeGreaterThan(0)
      },
      leave(node: CssNode) {
        if (node.type === 'PseudoClassSelector' && node.name === 'not') negations--
      },
    })
    expect(extractAboutSheet(homeCss + aboutCss, new Set([crossAbout]), own, owners)).toContain(
      `[id="${crossAbout}"]{--cross-specificity:0}`,
    )
  })

  // The sheets of the Studio test of About's copy of a Home width.
  it("keeps About's rule that names a Home element by attribute whole in About only", () => {
    const id = 'knc-desktop-home-0-i1-i0-i1'
    const homeCss = `[id="${id}"]{width:250px}`
    const aboutCss = `#om-oss-heading,[id="${id}"]{width:300px}`
    const owners = { home: homeCss, about: aboutCss }
    const section = new Set(['om-oss-heading'])
    const own = new Set([id])
    expect(stripHomeSheet(homeCss + aboutCss, section, { ...owners, own })).toBe(homeCss)
    expect(extractAboutSheet(homeCss + aboutCss, section, own, owners)).toBe(aboutCss)
  })
})

// Selectors Level 4 specificity, as the test's own oracle.
function oracle(node: CssNode): [number, number, number] {
  if (node.type === 'SelectorList')
    return node.children
      .toArray()
      .map(oracle)
      .reduce((a, b) => ((a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0 ? a : b), [0, 0, 0])
  if (node.type === 'Selector')
    return node.children
      .toArray()
      .map(oracle)
      .reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0])
  if (node.type === 'IdSelector') return [1, 0, 0]
  if (node.type === 'ClassSelector' || node.type === 'AttributeSelector') return [0, 1, 0]
  if (node.type === 'TypeSelector') return node.name === '*' ? [0, 0, 0] : [0, 0, 1]
  if (node.type === 'PseudoElementSelector') return [0, 0, 1]
  if (node.type === 'PseudoClassSelector') {
    const list = node.children?.first
    if (node.name === 'where') return [0, 0, 0]
    return list?.type === 'SelectorList' ? oracle(list) : [0, 1, 0]
  }
  return [0, 0, 0]
}

function prelude(css: string): Selector {
  const sheet = parse(css)
  let first: Selector | undefined
  walk(sheet, {
    visit: 'Rule',
    enter(rule) {
      if (
        !first &&
        rule.prelude.type === 'SelectorList' &&
        rule.prelude.children.first?.type === 'Selector'
      )
        first = rule.prelude.children.first
    },
  })
  if (!first) throw new Error(`No selector in ${css}`)
  return first
}

describe('the specificity filler', () => {
  it.each([
    // The removed alternative outweighs those left, so the filler carries its specificity.
    [':is(#home,:where(#about)){--x:1}', ':is(:where(#about),:not(*,#knc-never)){--x:1}'],
    [':is(#home .a .b,#about){--x:1}', ':is(#about,:not(*,#knc-never.knc-never.knc-never)){--x:1}'],
    [
      ':is(div#home span.a,.b) .c{--x:1}',
      ':is(.b,:not(*,knc-never knc-never#knc-never.knc-never)) .c{--x:1}',
    ],
    [':not(:not(#home,.b)){--x:1}', ':not(:not(.b,:not(*,#knc-never))){--x:1}'],
    [':where(:is(#home,.b)){--x:1}', ':where(:is(.b,:not(*,#knc-never))){--x:1}'],
  ])(
    'keeps the specificity of About rule %s, matches nothing and names no page ID',
    (rule, kept) => {
      const sheets = split('', rule)
      expect(sheets.about).toBe(kept)
      expect(oracle(prelude(sheets.about))).toEqual(oracle(prelude(rule)))
      const fillers: CssNode[] = []
      walk(parse(sheets.about), {
        visit: 'PseudoClassSelector',
        enter(node) {
          const list = node.children?.first
          if (
            node.name === 'not' &&
            list?.type === 'SelectorList' &&
            generate(list).startsWith('*,')
          )
            fillers.push(node)
        },
      })
      expect(fillers).toHaveLength(1)
      for (const filler of fillers) {
        // Every element matches `*`, so the :not() matches none.
        const list = filler.type === 'PseudoClassSelector' ? filler.children?.first : null
        expect(list?.type === 'SelectorList' && generate(list.children.first ?? list)).toBe('*')
        walk(filler, {
          visit: 'IdSelector',
          enter(id) {
            expect([...aboutIds, ...homeIds]).not.toContain(ident.decode(id.name))
          },
        })
      }
      // A later save keeps the filler in About: no page ID decides it.
      expect(split('', sheets.about).about).toBe(sheets.about)
    },
  )

  it('never keeps a selector alive with fillers alone', () => {
    const about = ':is(:where(#about),:not(*,#knc-never)){--x:1}'
    expect(split('', about)).toEqual({ home: '', about })
  })

  it('adds none where a remaining alternative is as specific', () => {
    expect(split(':is(#home,#about.a){--x:1}', '').about).toBe(':is(#about.a){--x:1}')
    expect(split(':is(#home,#about.a){--x:1}', '').home).toBe(
      ':is(#home,:not(*,#knc-never.knc-never)){--x:1}',
    )
  })
})

describe('derived preview IDs', () => {
  it('drops only rules naming a generated preview ID, wherever it stands', () => {
    const mentions = [
      "#home:not([title='preview-shared-hint']){--a:1}",
      '#home:not(.preview-shared-hint){--b:1}',
      '#home:not(#preview-shared-hint){--c:1}',
      '#home:not([data-preview-shared-hint]){--d:1}',
      '#preview-shared-x1{--e:1}',
    ]
    const stale = ['#preview-shared-0{--f:1}', '#home:not(#preview-shared-12){--g:1}']
    expect(stripHomeSheet([...mentions, ...stale].join(''), new Set())).toBe(
      generate(parse(mentions.join(''))),
    )
  })
})

describe("About's layer order", () => {
  const heading = 'om-oss-heading'
  const ids = new Set([heading])
  const extract = (homeCss: string, aboutCss: string): string =>
    extractAboutSheet(homeCss + aboutCss, ids, new Set(), { home: homeCss, about: aboutCss })
  it.each([
    [
      'a dotted sublayer',
      `@layer brand.first{}@layer brand.second{#${heading}{color:blue!important}}`,
      `@layer brand.first{[id="${heading}"]{color:red!important}}`,
      `@layer brand.first{}@layer brand.second{#${heading}{color:blue!important}}@layer brand.first{[id="${heading}"]{color:red!important}}`,
    ],
    [
      'a layer nested in a layer',
      `@layer nest{@layer first{}}@layer nest{@layer second{#${heading}{color:blue!important}}}`,
      `@layer nest{@layer first{[id="${heading}"]{color:red!important}}}`,
      `@layer nest{@layer first{}}@layer nest{@layer second{#${heading}{color:blue!important}}}@layer nest{@layer first{[id="${heading}"]{color:red!important}}}`,
    ],
    [
      'a sublayer Home names only under a condition',
      `@supports (display:block){@layer cond.first{}}@layer cond.second{#${heading}{color:blue!important}}`,
      `@layer cond.first{[id="${heading}"]{color:red!important}}`,
      `@supports (display:block){@layer cond.first{}}@layer cond.second{#${heading}{color:blue!important}}@layer cond.first{[id="${heading}"]{color:red!important}}`,
    ],
    [
      'a top-level layer',
      `@layer top1{}@layer top2{#${heading}{color:blue!important}}`,
      `@layer top1{[id="${heading}"]{color:red!important}}`,
      `@layer top1{}@layer top2{#${heading}{color:blue!important}}@layer top1{[id="${heading}"]{color:red!important}}`,
    ],
    [
      'an anonymous layer after a sublayer',
      `@layer anon.first{}@layer{#${heading}{color:blue!important}}`,
      `@layer anon.first{[id="${heading}"]{color:red!important}}`,
      `@layer anon{}@layer{#${heading}{color:blue!important}}@layer anon.first{[id="${heading}"]{color:red!important}}`,
    ],
    [
      'a dotted sublayer with normal declarations',
      `@layer dot.first{}@layer dot.second{h2#${heading}{color:blue}}`,
      `@layer dot.first{[id="${heading}"]{color:red}}`,
      `@layer dot.second{h2#${heading}{color:blue}}@layer dot.first{[id="${heading}"]{color:red}}`,
    ],
    [
      'a nested layer with normal declarations',
      `@layer nest{@layer first{}}@layer nest{@layer second{h2#${heading}{color:blue}}}`,
      `@layer nest{@layer first{[id="${heading}"]{color:red}}}`,
      `@layer nest{@layer second{h2#${heading}{color:blue}}}@layer nest{@layer first{[id="${heading}"]{color:red}}}`,
    ],
  ])('keeps the order for %s', (_, homeCss, aboutCss, expected) => {
    expect(extract(homeCss, aboutCss)).toBe(expected)
  })

  it('keeps About unchanged when Home names its layers first and moves nothing', () => {
    const aboutCss = '@layer a.x{.label{color:red}}@layer a.y{.label{color:blue}}@layer b{}'
    expect(extract('@layer b{}@layer a.y{}@layer a.x{}', aboutCss)).toBe(aboutCss)
  })
})

describe('the cost of extracting About', () => {
  // Methods whose work grows with the array they run over. The count adds that length each call;
  // hand-written loops escape it.
  const methods = [
    'every',
    'filter',
    'find',
    'findIndex',
    'findLast',
    'findLastIndex',
    'flatMap',
    'forEach',
    'includes',
    'indexOf',
    'lastIndexOf',
    'map',
    'reduce',
    'slice',
    'some',
  ] as const
  function work(n: number, homeLayers: boolean): { work: number; kept: boolean } {
    const aboutCss = Array.from(
      { length: n },
      (_, i) => `@layer local${i}{.label{color:var(--tone${i},red)}}`,
    ).join('')
    const homeCss = homeLayers
      ? Array.from({ length: n }, (_, i) => `@layer local${i}{}`).join('')
      : ''
    const prototype = Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
    const originals = methods.map((name) => [name, prototype[name]] as const)
    let total = 0
    let css = ''
    for (const [name, original] of originals)
      prototype[name] = function (this: unknown[], ...args: unknown[]) {
        total += this.length
        return Reflect.apply(original as (...args: unknown[]) => unknown, this, args)
      }
    try {
      css = extractAboutSheet(homeCss + aboutCss, new Set(['intro']), new Set(['home-heading']), {
        about: aboutCss,
        home: homeCss,
      })
    } finally {
      for (const [name, original] of originals)
        prototype[name] = original as (...args: unknown[]) => unknown
    }
    return { work: total, kept: css === aboutCss }
  }

  it.each([false, true])(
    'grows linearly with About layers when Home names them: %s',
    (homeLayers) => {
      const counts = [100, 400, 1600].map((n) => work(n, homeLayers))
      expect(counts.map(({ kept }) => kept)).toEqual([true, true, true])
      const [small, medium, large] = counts.map(({ work }) => work)
      // Linear work grows fourfold per step, quadratic sixteenfold.
      expect((medium ?? 0) / (small ?? 1)).toBeLessThanOrEqual(8)
      expect((large ?? 0) / (medium ?? 1)).toBeLessThanOrEqual(8)
    },
  )
})
