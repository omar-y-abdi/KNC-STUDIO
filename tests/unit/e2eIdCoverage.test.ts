import { describe, expect, it } from 'vitest'
import {
  coverageProblems,
  describeOrphan,
  describeProblem,
  ratchetVerdict,
} from '../../tools/e2e/id-coverage.mjs'

type Kind = 'source' | 'slot'

// A node is a native element (data-knc-source) unless marked 'slot' (a component wrapper, data-knc-slot).
// A slot node can also carry a source id (identity): the stored element has both attributes.
const tree = (
  nodes: [string, string, Kind?, string?][],
  tracks: Record<string, string[]> = {},
) => ({
  nodes: nodes.map(([id, tag, kind = 'source', identity]) => ({
    id,
    tag,
    kind,
    ...(identity === undefined ? {} : { identity }),
  })),
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

  it('resolves a stored element with both attributes by its slot, as the projection does', () => {
    const stored = tree([['knc-slot-a', 'div', 'slot', 'knc-source-b']])
    const live = tree([['knc-source-b', 'div']])
    expect(coverageProblems(stored, live)).toEqual([
      { kind: 'missing-slot', id: 'knc-slot-a', stored: 'div', live: null },
    ])
    expect(coverageProblems(stored, tree([['knc-slot-a', 'div', 'slot']]))).toEqual([])
    expect(coverageProblems(stored, tree([['knc-slot-a', 'section']]))).toEqual([])
  })

  it('counts duplicates of a dual element by its source id', () => {
    const stored = tree([
      ['knc-slot-a', 'div', 'slot', 'knc-source-b'],
      ['knc-source-b', 'div'],
    ])
    const live = tree([
      ['knc-slot-a', 'div', 'slot'],
      ['knc-source-b', 'div'],
    ])
    expect(coverageProblems(stored, live)).toEqual([
      { kind: 'duplicate', id: 'knc-source-b', stored: 'div', live: null },
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

describe('describeOrphan', () => {
  it('names the surface, the capture and the id', () => {
    const capture = { lang: 'sv', mode: 'dark', device: 'Mobile', scene: 'home' }
    const orphan = {
      surface: 'mobile-home',
      kind: 'retagged' as const,
      id: 'knc-mobile-home-0-i0',
      stored: 'div',
      live: 'button',
    }
    expect(describeOrphan(capture, orphan)).toBe(
      'mobile-home (Mobile home sv dark): retagged knc-mobile-home-0-i0 (stored <div>, live <button>)',
    )
  })
})

describe('ratchetVerdict', () => {
  const capture = (lang: string, device = 'Desktop') => ({
    lang,
    mode: 'light',
    device,
    scene: 'my-bookings',
  })
  const orphan = {
    surface: 'my-bookings',
    kind: 'missing-slot' as const,
    id: 'knc-my-bookings-0-i0-i1-i3-i3',
    stored: 'div',
    live: null,
  }
  const line = (device: string, lang: string) =>
    `my-bookings (${device} my-bookings ${lang} light): missing-slot knc-my-bookings-0-i0-i1-i3-i3 (stored <div>, live absent)`
  const known = [{ orphan, captures: [capture('sv'), capture('en')] }]
  const found = (...captures: ReturnType<typeof capture>[]) =>
    captures.map((where) => ({ capture: where, orphan }))

  it('holds when the orphan occurs in every capture that lists it, and nowhere else', () => {
    expect(ratchetVerdict(found(capture('sv'), capture('en')), known)).toEqual({
      unexpected: [],
      absent: [],
    })
  })

  it('fails a listed orphan in a capture that does not list it', () => {
    const verdict = ratchetVerdict(
      found(capture('sv'), capture('en'), capture('sv', 'Mobile')),
      known,
    )
    expect(verdict).toEqual({ unexpected: [line('Mobile', 'sv')], absent: [] })
  })

  it('fails a listed orphan that is missing from a listed capture', () => {
    expect(ratchetVerdict(found(capture('sv')), known)).toEqual({
      unexpected: [],
      absent: [line('Desktop', 'en')],
    })
  })

  it('fails an orphan that no entry lists, in a capture that lists another one', () => {
    const other = { ...orphan, id: 'knc-my-bookings-0-i0-i1-i3-i4' }
    const verdict = ratchetVerdict(
      [...found(capture('sv'), capture('en')), { capture: capture('sv'), orphan: other }],
      known,
    )
    expect(verdict.absent).toEqual([])
    expect(verdict.unexpected).toEqual([
      'my-bookings (Desktop my-bookings sv light): missing-slot knc-my-bookings-0-i0-i1-i3-i4 (stored <div>, live absent)',
    ])
  })

  it('counts a repeat of a listed orphan in a listed capture as one too many', () => {
    const verdict = ratchetVerdict(found(capture('sv'), capture('sv'), capture('en')), known)
    expect(verdict).toEqual({ unexpected: [line('Desktop', 'sv')], absent: [] })
  })

  it('fails every listed occurrence when the orphan is gone, as after a fix', () => {
    expect(ratchetVerdict([], known)).toEqual({
      unexpected: [],
      absent: [line('Desktop', 'sv'), line('Desktop', 'en')],
    })
  })
})
