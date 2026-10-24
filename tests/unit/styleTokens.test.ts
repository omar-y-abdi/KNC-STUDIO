import { readFileSync } from 'node:fs'
import { generate, parse, walk } from 'css-tree'
import { describe, expect, it } from 'vitest'
import { mobMuted, shellPalette } from '../../src/app/shared'

// STY-12: public/tokens.css is derived from the homepage palette; this ties the two together.
const tokensCss = readFileSync(new URL('../../public/tokens.css', import.meta.url), 'utf8')

const HOMEPAGE: Readonly<Record<string, (dark: boolean) => string>> = {
  '--bb-bg': (dark) => shellPalette(dark).bg,
  '--bb-text': (dark) => shellPalette(dark).text,
  '--bb-muted': mobMuted,
  '--bb-line': (dark) => shellPalette(dark).line,
  '--bb-surface': (dark) => shellPalette(dark).navBg,
  '--bb-accent': (dark) => shellPalette(dark).accent,
  '--bb-accent-text': (dark) => shellPalette(dark).accentText,
}

/** `#rrggbb` and `rgb[a](...)` as [r, g, b, alpha], so formatting differences do not matter. */
function channels(color: string): readonly number[] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1]
  if (hex !== undefined) return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).concat(1)
  const parts = /^rgba?\(([^)]*)\)$/.exec(color)?.[1]?.split(',').map(Number)
  if (parts === undefined || parts.some(Number.isNaN)) throw new Error(`Unsupported colour ${color}`)
  return parts.length === 3 ? [...parts, 1] : parts
}

/** The two arguments of `light-dark(light, dark)`, split at the top-level comma. */
function lightDark(value: string): readonly [string, string] {
  const inner = /^light-dark\((.*)\)$/.exec(value)?.[1] ?? ''
  let depth = 0
  for (const [index, char] of [...inner].entries()) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0
    if (char === ',' && depth === 0) return [inner.slice(0, index), inner.slice(index + 1)]
  }
  throw new Error(`Not a light-dark() pair: ${value}`)
}

function declarations(): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  walk(parse(tokensCss, { parseCustomProperty: true }), {
    visit: 'Declaration',
    enter(node) {
      if (node.property.startsWith('--')) found.set(node.property, generate(node.value))
    },
  })
  return found
}

describe('public/tokens.css', () => {
  it('defines exactly the homepage palette as light-dark() tokens', () => {
    const tokens = declarations()
    expect([...tokens.keys()].sort()).toEqual(Object.keys(HOMEPAGE).sort())
    for (const [name, homepage] of Object.entries(HOMEPAGE)) {
      const [light, dark] = lightDark(tokens.get(name) ?? '')
      expect(channels(light), `${name} light`).toEqual(channels(homepage(false)))
      expect(channels(dark), `${name} dark`).toEqual(channels(homepage(true)))
    }
  })

  it('styles only .bb-* classes and :root', () => {
    const selectors: string[] = []
    walk(parse(tokensCss), {
      visit: 'Selector',
      enter(node) {
        selectors.push(generate(node))
      },
    })
    expect(selectors.length).toBeGreaterThan(0)
    expect(selectors.filter((selector) => !/^(\.bb-|:root$)/.test(selector))).toEqual([])
  })

  it('never defines the owner theme-override channel', () => {
    expect([...declarations().keys()].filter((name) => name.startsWith('--knc-'))).toEqual([])
  })
})
