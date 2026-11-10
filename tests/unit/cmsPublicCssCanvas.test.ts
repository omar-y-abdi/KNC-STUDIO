import { readFileSync } from 'node:fs'
import { generate, walk } from 'css-tree'
import { expect, it } from 'vitest'
import { isUnkeptSyntax, parseCanvasSheet } from '../../modules/studio/src/nativeCanvas'

// The Studio stores every rule the public app loads as page CSS (nativePages.ts); its canvas refuses
// the whole page over one unkept node (parseCanvasCss).
const publicSheets = [
  'modules/public-web/src/ui/styles/global.css',
  'public/tokens.css',
  'modules/public-web/src/ui/styles/fonts.css',
]

function unkept(css: string): string[] {
  const nodes: string[] = []
  walk(parseCanvasSheet(css), (node) => {
    if (isUnkeptSyntax(node)) nodes.push(generate(node))
  })
  return nodes
}

it.each(publicSheets)('the Studio canvas keeps every rule of %s', (path) => {
  expect(unkept(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))).toEqual([])
})

it('finds a selector function with two alternatives and keeps one with a single argument', () => {
  expect(unkept('a :is(b, c) { color: red }')).toEqual([':is(b,c)'])
  expect(unkept('a:not([inert], [inert] *) { color: red }')).toEqual([':not([inert],[inert] *)'])
  expect(unkept(':where(a b):not(#c.d), :is(e:has(> f)) g { color: red }')).toEqual([])
})
