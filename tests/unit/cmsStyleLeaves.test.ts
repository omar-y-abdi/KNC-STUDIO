import { describe, expect, it } from 'vitest'
import { styleLeaves } from '../../tools/e2e/cms-style-leaves.mjs'

// cms-context-latency compares readCanvasCss with GrapesJS getCss through styleLeaves. Both
// export the same rule models, so a difference in cascade order is a defect, while GrapesJS's own
// grouping and serialization are not.
describe('styleLeaves', () => {
  it.each([
    ['rule order', '#x{color:red}#x{color:blue}', '#x{color:blue}#x{color:red}'],
    [
      'an empty named layer that orders a later layer',
      '@layer first{}@layer{#x{color:blue!important}}@layer first{.x{color:red!important}}',
      '@layer{#x{color:blue!important}}@layer first{.x{color:red!important}}',
    ],
    [
      'anonymous layer order',
      '@layer{#x{color:red}}@layer{#x{color:blue}}',
      '@layer{#x{color:blue}}@layer{#x{color:red}}',
    ],
    [
      'rule order within one media query',
      '@media (min-width:769px){#x{color:red}#x{color:blue}}',
      '@media (min-width:769px){#x{color:blue}#x{color:red}}',
    ],
    ['layer statement order', '@layer a,b;', '@layer b,a;'],
    [
      'the order of an anonymous and a named layer',
      '@layer{#x{color:red}}@layer a{#x{color:blue}}',
      '@layer a{#x{color:blue}}@layer{#x{color:red}}',
    ],
    [
      'the order of a rule and a media query holding a nested at-rule',
      '#x{color:red}@media (min-width:1px){@supports (display:grid){#x{color:blue}}}',
      '@media (min-width:1px){@supports (display:grid){#x{color:blue}}}#x{color:red}',
    ],
    [
      'the order of keyframes and a rule',
      '@keyframes k{from{opacity:0}}#x{color:red}',
      '#x{color:red}@keyframes k{from{opacity:0}}',
    ],
    // CSS nesting keeps a declaration that follows a nested group rule after that rule in the
    // cascade, so the first sheet of each pair paints green and the second blue.
    [
      'declaration order around a nested at-rule',
      '.x{color:red;@media(min-width:1px){color:blue}color:green}',
      '.x{color:red;color:green;@media(min-width:1px){color:blue}}',
    ],
    [
      'declaration order around an at-rule nested in an at-rule',
      '.x{@media(min-width:1px){color:red;@supports(display:block){color:blue}color:green}}',
      '.x{@media(min-width:1px){color:red;color:green;@supports(display:block){color:blue}}}',
    ],
  ])('tells sheets apart that differ in %s', (_, first, second) => {
    expect(styleLeaves(first)).not.toEqual(styleLeaves(second))
  })

  it.each([
    [
      'getCss grouping media rules after the plain rules',
      '#a{color:red}@media (min-width:769px){#a{width:1px}}#b{color:blue}@media (min-width:769px){#b{width:2px}}',
      '#a{color:red}#b{color:blue}@media (min-width:769px){#a{width:1px}#b{width:2px}}',
    ],
    [
      'getCss ordering media queries by width',
      '@media (min-width:1024px){#a{width:1px}}@media (min-width:769px){#a{width:2px}}',
      '@media (min-width:769px){#a{width:2px}}@media (min-width:1024px){#a{width:1px}}',
    ],
    [
      'getCss writing a font face after the plain rules',
      '@font-face{font-family:a;src:url(a.woff2)}#x{color:red}',
      '#x{color:red}@font-face{font-family:a;src:url(a.woff2)}',
    ],
    [
      'the "& " getCss keeps on a layer envelope rule',
      '@layer{#x{color:red!important}}',
      '@layer{& #x{color:red !important;}}',
    ],
    [
      'empty component rules that readCanvasCss leaves out',
      '#x{color:red}',
      '#x{color:red}#y{}@media (min-width:769px){#y{}}',
    ],
    ['css-tree normalization', '#x{color:red!important}', '#x { color : red !important ; }'],
    [
      'the "& " and spacing getCss writes around an interleaved nested at-rule',
      '@layer{.x{color:red;@media (min-width:1px){color:blue}color:green}}',
      '@layer{& .x{color:red;@media (min-width:1px){color:blue;}color :green;}}',
    ],
    ['an empty anonymous layer', '#x{color:red}', '#x{color:red}@layer{}'],
  ])('equates sheets that differ only in %s', (_, canvas, exported) => {
    expect(styleLeaves(canvas)).toEqual(styleLeaves(exported))
  })
})
