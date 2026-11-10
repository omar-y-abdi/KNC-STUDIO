import { describe, expect, it } from 'vitest'
import { generate, parse } from 'css-tree'
import { extractAboutSheet, stripHomeSheet } from '../../modules/studio/src/composedCanvas'

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

describe('IDs that do not decide the page', () => {
  it.each([
    // An ID inside :not() only excludes, and one inside :has() tests a relative: neither decides.
    '#home:not(#about){--x:1}',
    '.label:has(#about){--x:1}',
  ])('leaves %s on Home', (rule) => {
    expect(split(rule, '')).toEqual({ home: rule, about: '' })
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

  it("keeps About's rule whole in Home where it still names Home's element by #", () => {
    const rule = '#home,[id="about"]{--x:1}'
    expect(split('', rule)).toEqual({ home: rule, about: '[id="about"]{--x:1}' })
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
