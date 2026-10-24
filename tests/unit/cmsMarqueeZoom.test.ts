import { generate, parse } from 'css-tree'
import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsDocument, type CmsPage } from '../../shared/cms'
import {
  normalizeMarqueeCardZoom,
  normalizeMarqueeZoom,
  unresolvedMarqueeZoom,
} from '../../src/admin/cms/normalizeDocument'

const ids = { group: 'strip', cards: ['card-a', 'card-b'] }
const width = (scale: string): string => `calc((100vw - 24px) * ${scale})`
const css = (value: string): string => generate(parse(value))

describe('normalizeMarqueeCardZoom', () => {
  it('turns mobile card zoom into the card width form and keeps its priority', () => {
    expect(
      normalizeMarqueeCardZoom(
        '@media (max-width: 768px){#card-a{zoom:.5!important;padding:20px!important}}',
        ids,
      ),
    ).toBe(
      css(
        `@media (max-width:768px){#card-a{padding:20px!important;width:${width('0.5')}!important;flex-basis:${width('0.5')}!important}}`,
      ),
    )
  })

  it('moves legacy strip zoom onto every card instead of sizing the 100vw strip', () => {
    const result = normalizeMarqueeCardZoom(
      '@media (max-width:768px){#strip{zoom:0.5;gap:8px}#card-b{zoom:50%}}',
      ids,
    )
    expect(result).toBe(
      css(
        `@media (max-width:768px){#strip{gap:8px}#card-b{width:${width('0.25')};flex-basis:${width('0.25')}}}` +
          `@media (max-width:768px){#card-a{width:${width('0.5')};flex-basis:${width('0.5')}}}`,
      ),
    )
  })

  it('applies the last zoom of a card when theme sync appended later mobile blocks', () => {
    expect(
      normalizeMarqueeCardZoom(
        '@media (max-width:768px){#card-a{zoom:.5}}@media (max-width:768px){#card-a{zoom:.75;width:10px}}',
        ids,
      ),
    ).toBe(
      css(
        `@media (max-width:768px){#card-a{}}@media (max-width:768px){#card-a{width:${width('0.75')};flex-basis:${width('0.75')}}}`,
      ),
    )
  })

  it('lets an !important zoom win over a later one in either order', () => {
    const half = `width:${width('0.5')}!important;flex-basis:${width('0.5')}!important`
    expect(
      normalizeMarqueeCardZoom(
        '@media(max-width:768px){#card-a{zoom:.5!important}#card-a{zoom:1}}',
        ids,
      ),
    ).toBe(css(`@media (max-width:768px){#card-a{${half}}#card-a{}}`))
    expect(
      normalizeMarqueeCardZoom(
        '@media(max-width:768px){#card-a{zoom:.75}#card-a{zoom:.5!important}}',
        ids,
      ),
    ).toBe(css(`@media (max-width:768px){#card-a{}#card-a{${half}}}`))
    expect(
      normalizeMarqueeCardZoom(
        '@media(max-width:768px){#card-a{zoom:.5}#card-a{zoom:normal}}',
        ids,
      ),
    ).toBe(css('@media (max-width:768px){#card-a{}#card-a{}}'))
  })

  it('resolves calc() over numbers before it removes the zoom', () => {
    for (const value of ['calc(.5)', 'calc(1 / 2)', 'calc((1 - .5) * 1)', 'calc(0.25 * 2)'])
      expect(
        normalizeMarqueeCardZoom(`@media (max-width:768px){#card-a{zoom:${value}}}`, ids),
      ).toBe(
        css(`@media (max-width:768px){#card-a{width:${width('0.5')};flex-basis:${width('0.5')}}}`),
      )
  })

  it('keeps CSS it cannot resolve byte for byte and reports the value', () => {
    for (const source of [
      '@media (max-width:768px){#card-a{zoom:var(--scale)}}',
      '@media (max-width:768px){#strip{zoom:calc(50%)}#card-b{zoom:.5}}',
      '@media (max-width:768px){#card-a{zoom:.5}#card-a{zoom:calc(1px / 2)}}',
    ])
      expect(normalizeMarqueeCardZoom(source, ids)).toBe(source)
    const legacy = documentWith(
      aboutPage('@media (max-width:768px){#strip{zoom:var(--scale)}#card-a{zoom:.5}}'),
    )
    expect(normalizeMarqueeZoom(legacy, () => ids)).toBe(legacy)
    expect(unresolvedMarqueeZoom(legacy, () => ids)).toEqual(['var(--scale)'])
    const overridden = documentWith(
      aboutPage('@media (max-width:768px){#card-a{zoom:var(--scale)}#card-a{zoom:.5}}'),
    )
    expect(
      unresolvedMarqueeZoom(
        normalizeMarqueeZoom(overridden, () => ids),
        () => ids,
      ),
    ).toEqual([])
    const plain = documentWith(aboutPage('@media (max-width:768px){#card-a{zoom:.5!important}}'))
    const unread = (): never => {
      throw new Error('Plain zoom values are never parsed for the notice')
    }
    expect(unresolvedMarqueeZoom(plain, unread)).toEqual([])
    const zero = documentWith(aboutPage('@media (max-width:768px){#card-a{zoom:0}}'))
    expect(unresolvedMarqueeZoom(zero, () => ids)).toEqual(['0'])
  })

  it('drops an identity zoom without inventing a width', () => {
    expect(
      normalizeMarqueeCardZoom('@media (max-width:768px){#card-a{zoom:normal;color:red}}', ids),
    ).toBe(css('@media (max-width:768px){#card-a{color:red}}'))
  })

  it('leaves Desktop zoom, photo zoom and other selectors alone', () => {
    const source =
      '@media (min-width:769px){#card-a{zoom:.5}}@media (max-width:768px){#photo-a{zoom:.5}.card-a{zoom:.5}#card-a .x{zoom:.5}}#card-a{zoom:.5}'
    expect(normalizeMarqueeCardZoom(source, ids)).toBe(source)
  })

  it('is idempotent and returns CSS without strip zoom byte for byte', () => {
    const once = normalizeMarqueeCardZoom(
      '@media (max-width:768px){#strip{zoom:.8}#card-a{zoom:.5!important}}',
      ids,
    )
    expect(normalizeMarqueeCardZoom(once, ids)).toBe(once)
    const untouched = '@media (max-width: 768px) { #card-a { padding: 20px } }'
    expect(normalizeMarqueeCardZoom(untouched, ids)).toBe(untouched)
  })
})

function aboutPage(cssValue: string): CmsPage {
  const variant = { html: '<div>strip</div>', css: { light: cssValue, dark: cssValue } }
  return {
    id: '10000000-0000-4000-8000-000000000002',
    path: '/about',
    kind: 'page',
    name: { sv: 'Om oss', en: 'About' },
    title: { sv: 'Om oss', en: 'About' },
    description: { sv: '', en: '' },
    inMenu: true,
    content: { sv: structuredClone(variant), en: structuredClone(variant) },
  }
}

function documentWith(page: CmsPage): CmsDocument {
  const document = emptyDocument()
  document.presentation.pages = [page]
  return document
}

describe('normalizeMarqueeZoom', () => {
  it('converts every About variant with the strip identities read from its HTML', () => {
    const legacy = documentWith(aboutPage('@media (max-width:768px){#card-a{zoom:.5}}'))
    const read = (html: string) => (html === '<div>strip</div>' ? ids : null)
    const result = normalizeMarqueeZoom(legacy, read)
    for (const lang of ['sv', 'en'] as const)
      for (const mode of ['light', 'dark'] as const)
        expect(result.presentation.pages[0]?.content[lang].css[mode]).toBe(
          css(
            `@media (max-width:768px){#card-a{width:${width('0.5')};flex-basis:${width('0.5')}}}`,
          ),
        )
    expect(legacy.presentation.pages[0]?.content.sv.css.light).toContain('zoom')
  })

  it('returns the adopted document itself when no strip zoom is stored', () => {
    const current = documentWith(aboutPage('@media (max-width:768px){#card-a{padding:2px}}'))
    expect(normalizeMarqueeZoom(current, () => ids)).toBe(current)
    const withoutStrip = documentWith(aboutPage('@media (max-width:768px){#card-a{zoom:.5}}'))
    expect(normalizeMarqueeZoom(withoutStrip, () => null)).toBe(withoutStrip)
  })
})
