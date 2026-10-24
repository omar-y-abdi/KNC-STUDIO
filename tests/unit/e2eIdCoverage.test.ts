import { describe, expect, it } from 'vitest'
import { coverageProblems, describeProblem } from '../../tools/e2e/id-coverage.mjs'

const tree = (nodes: [string, string][], tracks: Record<string, string[]> = {}) => ({
  nodes: nodes.map(([id, tag]) => ({ id, tag })),
  tracks,
})

describe('coverageProblems', () => {
  it('accepts a live tree that carries every stored id with its tag, plus extra live nodes', () => {
    const stored = tree([
      ['knc-about-0', 'section'],
      ['knc-about-0-i0-i1', 'h2'],
    ])
    const live = tree([
      ['knc-about-0', 'section'],
      ['knc-about-0-i0-i1', 'h2'],
      ['knc-about-0-i0-i2', 'p'],
    ])
    expect(coverageProblems(stored, live)).toEqual([])
  })

  it('reports a stored id that the live tree no longer renders', () => {
    const problems = coverageProblems(tree([['knc-about-0-i0-i3', 'h3']]), tree([]))
    expect(problems).toEqual([
      { kind: 'missing', id: 'knc-about-0-i0-i3', stored: 'h3', live: null },
    ])
  })

  it('reports a re-tagged node with both tags', () => {
    const problems = coverageProblems(
      tree([['knc-about-0-i0-i3', 'h3']]),
      tree([['knc-about-0-i0-i3', 'h4']]),
    )
    expect(problems).toEqual([
      { kind: 'retagged', id: 'knc-about-0-i0-i3', stored: 'h3', live: 'h4' },
    ])
  })

  it('reports a repeated stored id, which makes the projection keep the unprojected tree', () => {
    const stored = tree([
      ['knc-x-0', 'div'],
      ['knc-x-0', 'div'],
    ])
    expect(coverageProblems(stored, tree([['knc-x-0', 'div']]))).toEqual([
      { kind: 'duplicate', id: 'knc-x-0', stored: 'div', live: null },
    ])
  })

  it('compares marquee tracks by distinct tile shape, whatever the viewport-driven tile count', () => {
    const tile = 'div(div(img()))'
    const stored = tree([], { track: [tile, tile, tile, tile] })
    expect(coverageProblems(stored, tree([], { track: [tile, tile] }))).toEqual([])
    expect(
      coverageProblems(stored, tree([], { track: [tile, 'div(div(picture(img())))'] })),
    ).toEqual([
      { kind: 'reshaped', id: 'track', stored: tile, live: `${tile} div(div(picture(img())))` },
    ])
    expect(coverageProblems(stored, tree([]))).toEqual([
      { kind: 'reshaped', id: 'track', stored: tile, live: null },
    ])
  })
})

describe('describeProblem', () => {
  it('names the capture, the surface and the id', () => {
    expect(
      describeProblem('about (Desktop home sv light)', {
        kind: 'retagged',
        id: 'knc-about-0-i0-i3',
        stored: 'h3',
        live: 'h4',
      }),
    ).toBe('about (Desktop home sv light): retagged knc-about-0-i0-i3 (stored <h3>, live <h4>)')
  })
})
