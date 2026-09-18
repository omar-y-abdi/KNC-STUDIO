import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureEditorView,
  clearEditorViewState,
  loadEditorViewState,
  normalizeViewZoom,
  restoreEditorView,
  saveEditorViewState,
  type CmsEditorViewState,
} from '../../src/admin/cms/viewState'

interface FakeComponent {
  attributes: Record<string, string>
  getAttributes: () => Record<string, string>
}

function component(attributes: Record<string, string>): FakeComponent {
  return {
    attributes: { ...attributes },
    getAttributes() {
      return { ...this.attributes }
    },
  }
}

function editorFixture() {
  const first = component({ 'data-cms-node': 'first' })
  const target = component({ 'data-cms-node': 'target' })
  let selected: FakeComponent | null = target
  let coords = { x: 41, y: 17 }
  let scroll = { x: 13, y: 27 }
  let zoom = 75
  let device = 'Mobile'
  const frameWindow = {
    get scrollX() {
      return scroll.x
    },
    get scrollY() {
      return scroll.y
    },
    scrollTo(x: number, y: number) {
      scroll = { x, y }
    },
  }
  const wrapper = {
    find(selector: string) {
      if (selector.includes('"target"')) return [target]
      if (selector.includes('"first"')) return [first]
      return []
    },
  }
  const editor = {
    getSelected: () => selected,
    getWrapper: () => wrapper,
    select(next?: FakeComponent) {
      selected = next ?? null
    },
    getDevice: () => device,
    setDevice(next: string) {
      device = next
    },
    Canvas: {
      getWindow: () => frameWindow,
      getCoords: () => ({ ...coords }),
      setCoords(x: number, y: number) {
        coords = { x, y }
      },
      getZoom: () => zoom,
      setZoom(next: number) {
        zoom = next
      },
    },
  }
  return {
    editor,
    first,
    target,
    getState: () => ({ selected, coords, scroll, zoom, device }),
    mutate() {
      selected = first
      coords = { x: 0, y: 0 }
      scroll = { x: 0, y: 0 }
      zoom = 100
      device = 'Desktop'
    },
  }
}

function inspectorFixture() {
  const nodes: Record<string, { scrollTop: number }> = {
    '.cms-authored-inspector': { scrollTop: 90 },
    '#cms-gjs-styles': { scrollTop: 51 },
    '#cms-gjs-traits': { scrollTop: 33 },
    '#cms-gjs-layers': { scrollTop: 72 },
    '#cms-gjs-blocks': { scrollTop: 44 },
  }
  return {
    root: {
      querySelector(selector: string) {
        return nodes[selector] ?? null
      },
    },
    nodes,
  }
}

beforeEach(() => clearEditorViewState())

describe('CMS GrapesJS view-state restoration', () => {
  it('round-trips stable selection, canvas scroll/coords, device, zoom, tab, compare and inspector scroll', () => {
    const fixture = editorFixture()
    const inspector = inspectorFixture()
    const snapshot = captureEditorView(fixture.editor as never, {
      tab: 'layers',
      compare: true,
      root: inspector.root as never,
    })

    expect(snapshot).toMatchObject({
      device: 'Mobile',
      zoom: 75,
      tab: 'layers',
      compare: true,
      coords: { x: 41, y: 17 },
      scroll: { x: 13, y: 27 },
      selected: { kind: 'cms', value: 'target' },
    })

    fixture.mutate()
    for (const node of Object.values(inspector.nodes)) node.scrollTop = 0
    let restoredTab = ''
    let restoredCompare = false

    restoreEditorView(fixture.editor as never, snapshot, {
      root: inspector.root as never,
      setTab: (value) => {
        restoredTab = value
      },
      setCompare: (value) => {
        restoredCompare = value
      },
    })

    expect(fixture.getState()).toMatchObject({
      selected: fixture.target,
      coords: { x: 41, y: 17 },
      scroll: { x: 13, y: 27 },
      zoom: 75,
      device: 'Mobile',
    })
    expect(restoredTab).toBe('layers')
    expect(restoredCompare).toBe(true)
    expect(inspector.nodes['.cms-authored-inspector']?.scrollTop).toBe(90)
    expect(inspector.nodes['#cms-gjs-layers']?.scrollTop).toBe(72)
  })

  it('fails soft for a stale component identity instead of selecting another element', () => {
    const fixture = editorFixture()
    const stale: CmsEditorViewState = {
      selected: { kind: 'cms', value: 'missing' },
      coords: { x: 3, y: 4 },
      scroll: { x: 5, y: 6 },
      device: 'Desktop',
      zoom: 60,
      tab: 'style',
      compare: false,
      inspector: {},
    }

    expect(() => restoreEditorView(fixture.editor as never, stale)).not.toThrow()
    expect(fixture.getState().selected).toBeNull()
  })

  it('normalizes invalid zoom values and tolerates missing optional editor APIs', () => {
    expect(normalizeViewZoom(500)).toBe(200)
    expect(normalizeViewZoom(2)).toBe(25)
    expect(normalizeViewZoom(Number.NaN)).toBe(100)

    const sparse = {
      getWrapper: () => ({ find: () => [] }),
      select: () => undefined,
      Canvas: {},
    }
    expect(() =>
      restoreEditorView(sparse as never, {
        selected: null,
        zoom: 500,
        inspector: {},
      }),
    ).not.toThrow()
  })

  it('stores only detached plain editor state per identity', () => {
    const state: CmsEditorViewState = {
      selected: { kind: 'cms', value: 'target' },
      coords: { x: 1, y: 2 },
      scroll: { x: 3, y: 4 },
      device: 'Mobile',
      zoom: 75,
      tab: 'blocks',
      compare: false,
      inspector: { blocks: 19 },
    }

    saveEditorViewState('page:one:sv', state)
    state.coords = { x: 99, y: 99 }

    const restored = loadEditorViewState('page:one:sv')
    expect(restored?.coords).toEqual({ x: 1, y: 2 })
    expect(restored).not.toHaveProperty('html')
    expect(restored).not.toHaveProperty('css')
  })

  it('is wired into AuthoredEditor source replacement and unmount paths', () => {
    const source = readFileSync(resolve('src/admin/cms/AuthoredEditor.tsx'), 'utf8')
    expect(source).toContain("from './viewState'")
    expect(source).toContain('captureEditorView(')
    expect(source).toContain('restoreEditorView(')
    expect(source).toContain('saveEditorViewState(')
    expect(source).toContain('loadEditorViewState(')
  })
})
