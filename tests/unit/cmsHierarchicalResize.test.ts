import { expect, it } from 'vitest'
import { scaledZoom } from '../../src/admin/cms/hierarchicalResize'
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
