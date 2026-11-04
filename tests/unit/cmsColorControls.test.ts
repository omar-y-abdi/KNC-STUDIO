import { expect, it } from 'vitest'
import { colorControls, type StyleProperty } from '../../src/admin/cms/colorControls'

// A Style Manager property as GrapesJS builds it: `view` is set once PropertyView renders it.
const property = (
  type: string,
  value: string,
  options: { view?: unknown; important?: boolean; properties?: StyleProperty[] } = {},
): StyleProperty => {
  const { properties } = options
  const result = {
    getType: () => type,
    getFullValue: (_value?: string, opts?: { skipImportant?: boolean }) =>
      options.important && !opts?.skipImportant ? `${value} !important` : value,
    ...(properties ? { getProperties: () => properties } : {}),
    ...('view' in options ? { view: options.view } : {}),
  }
  return result
}
const view = (name: string): { name: string; setValue(value: string): void } => ({
  name,
  setValue: () => undefined,
})

it('lists every mounted color control, inside composites and stacks too, with its value', () => {
  const color = view('color')
  const background = view('background-color')
  const borderColor = view('border-color')
  const shadowColor = view('box-shadow-color')
  const properties = [
    property('select', 'flex', { view: view('display') }),
    property('color', 'red', { view: color, important: true }),
    property('color', '', { view: background }),
    property('composite', '0 solid', {
      view: view('border'),
      properties: [
        property('number', '0', { view: view('border-width') }),
        property('select', 'solid', { view: view('border-style') }),
        property('color', '', { view: borderColor }),
      ],
    }),
    property('stack', '', {
      view: view('box-shadow'),
      properties: [
        property('number', '0', { view: view('box-shadow-h') }),
        property('color', 'rgba(0,0,0,.2)', { view: shadowColor }),
      ],
    }),
  ]
  // The value without !important, as PropertyView.onValueChange shows it; the property keeps
  // its important flag when the control commits that value.
  expect(colorControls(properties)).toEqual([
    { view: color, value: 'red' },
    { view: background, value: '' },
    { view: borderColor, value: '' },
    { view: shadowColor, value: 'rgba(0,0,0,.2)' },
  ])
})
it('skips color properties without a mounted control', () => {
  const removed = { name: 'removed' }
  expect(
    colorControls([
      property('color', 'black'),
      property('color', 'black', { view: removed }),
      property('composite', '', { properties: [property('color', 'black', { view: null })] }),
    ]),
  ).toEqual([])
})
