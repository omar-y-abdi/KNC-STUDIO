import { expect, it } from 'vitest'
import { scaledZoom } from '../../src/admin/cms/hierarchicalResize'
import { desktopMarqueeCardStyle } from '../../src/admin/cms/resizeStyles'
import { syncLayout } from '../../src/admin/cms/responsiveStyles'

it('scales from the current measured geometry without cumulative drift', () => {
  expect(scaledZoom(1, 400, 200)).toBe(0.5)
  expect(scaledZoom(0.5, 200, 400)).toBe(1)
  expect(scaledZoom(0.75, 300, 225)).toBe(0.5625)
})
it('rejects invalid geometry and bounds excessive scaling', () => {
  for (const size of [0, -1, NaN, Infinity]) expect(scaledZoom(1, size, 200)).toBe(1)
  expect(scaledZoom(1, 400, 1)).toBe(0.1)
  expect(scaledZoom(1, 400, 4000)).toBe(4)
})
it('scales content-box cards without changing owner padding, tokens or alignment', () => {
  const style = {
    'box-sizing': 'content-box',
    padding: 'var(--owner-padding,14px)',
    border: '1px solid var(--owner-border)',
    'align-self': 'end',
    'margin-left': '10px',
    'margin-right': '10px',
    color: 'var(--owner-color)',
  }
  const geometry = {
    width: 'auto',
    zoom: 1,
    horizontalInset: 30,
    horizontalMargin: 20,
    stretch: true,
  }
  const first = desktopMarqueeCardStyle(style, 0.8, geometry)
  expect(first).toEqual({
    ...style,
    width: 'calc(80% - 50px)',
    zoom: '0.8',
  })
  expect(
    desktopMarqueeCardStyle(first, 0.6, { ...geometry, width: String(first.width), zoom: 0.8 }),
  ).toEqual({
    ...style,
    width: 'calc(60% - 50px)',
    zoom: '0.6',
  })
  expect(style).not.toHaveProperty('width')
})
it('preserves an explicit width and non-stretched alignment instead of sizing from the full track', () => {
  const style = {
    width: '170px',
    'box-sizing': 'border-box',
    'justify-self': 'center',
    padding: '20px',
  }
  expect(
    desktopMarqueeCardStyle(style, 0.75, {
      width: '170px',
      zoom: 1,
      horizontalInset: 0,
      horizontalMargin: 20,
      stretch: false,
    }),
  ).toEqual({
    ...style,
    zoom: '0.75',
  })
})
it('scales percentage terms in authored widths without scaling their fixed inset twice', () => {
  const style = { width: 'calc(70% - 12px)!important' }
  expect(
    desktopMarqueeCardStyle(style, 0.8, {
      width: style.width,
      zoom: 1,
      horizontalInset: 30,
      horizontalMargin: 20,
      stretch: false,
    }),
  ).toEqual({
    width: 'calc(56% - 12px)!important',
    zoom: '0.8',
  })
})
it('keeps intrinsic auto sizing on a card aligned to the start', () => {
  const style = { 'justify-self': 'start', 'margin-left': '10px', 'margin-right': '10px' }
  expect(
    desktopMarqueeCardStyle(style, 0.8, {
      width: 'auto',
      zoom: 1,
      horizontalInset: 30,
      horizontalMargin: 20,
      stretch: false,
    }),
  ).toEqual({ ...style, zoom: '0.8' })
})
it('shares layout scale across themes without changing colors or other devices', () => {
  const result = syncLayout(
    '@media(max-width:768px){#card{zoom:1;color:red}}',
    '@media(max-width:768px){#card{zoom:.5;color:red}}',
    '#card{color:white}@media(min-width:769px){#card{zoom:1}}',
  )
  expect(result).toContain('@media (max-width:768px){#card{zoom:.5}}')
  expect(result).toContain('color:white')
  expect(result).toContain('@media (min-width:769px){#card{zoom:1}}')
})
