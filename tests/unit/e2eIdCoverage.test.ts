import { describe, expect, it } from 'vitest'
import { coverageProblems, describeProblem } from '../../tools/e2e/id-coverage.mjs'

type Kind = 'source' | 'slot'

// A node is a native element (data-knc-source) unless marked 'slot' (a component wrapper, data-knc-slot).
const tree = (nodes: [string, string, Kind?][], tracks: Record<string, string[]> = {}) => ({
  nodes: nodes.map(([id, tag, kind = 'source']) => ({ id, tag, kind })),
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

  it('accepts a stored slot that the live tree carries as a slot, or as a source of any tag', () => {
    const stored = tree([['knc-home-0-i1-i2', 'div', 'slot']])
    expect(coverageProblems(stored, tree([['knc-home-0-i1-i2', 'div', 'slot']]))).toEqual([])
    expect(coverageProblems(stored, tree([['knc-home-0-i1-i2', 'section']]))).toEqual([])
  })

  it('accepts a stored source that the live tree now carries as a slot', () => {
    const stored = tree([['knc-home-0-i1-i2', 'section']])
    expect(coverageProblems(stored, tree([['knc-home-0-i1-i2', 'div', 'slot']]))).toEqual([])
  })

  it('reports a stored slot that the live tree no longer renders, which makes its component vanish', () => {
    const stored = tree([['knc-home-0-i1-i2', 'div', 'slot']])
    const live = tree([
      ['knc-home-0-i1-i3', 'div'],
      ['knc-home-0-i1-i4', 'div', 'slot'],
    ])
    expect(coverageProblems(stored, live)).toEqual([
      { kind: 'missing-slot', id: 'knc-home-0-i1-i2', stored: 'div', live: null },
    ])
  })

  it('reports an id that a stored source and a stored slot share, in either order', () => {
    const live = tree([['knc-x-0', 'div']])
    const duplicate = [{ kind: 'duplicate', id: 'knc-x-0', stored: 'div', live: null }]
    const sourceFirst = tree([
      ['knc-x-0', 'div'],
      ['knc-x-0', 'div', 'slot'],
    ])
    const slotFirst = tree([
      ['knc-x-0', 'div', 'slot'],
      ['knc-x-0', 'div'],
    ])
    expect(coverageProblems(sourceFirst, live)).toEqual(duplicate)
    expect(coverageProblems(slotFirst, live)).toEqual(duplicate)
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
