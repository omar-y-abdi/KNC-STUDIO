import type { Editor } from 'grapesjs'

export interface CmsViewState {
  pageId: string
  device: 'Desktop' | 'Mobile'
  zoom: number
  selectedId: string | null
  scrollX: number
  scrollY: number
}

export function captureViewState(
  editor: Editor,
  pageId: string,
  device: 'Desktop' | 'Mobile',
  zoom: number,
): CmsViewState {
  const frame = editor.Canvas.getWindow()
  return {
    pageId,
    device,
    zoom,
    selectedId: editor.getSelected()?.getId() ?? null,
    scrollX: frame?.scrollX ?? 0,
    scrollY: frame?.scrollY ?? 0,
  }
}

export function restoreViewState(editor: Editor, state: CmsViewState): void {
  const frame = editor.Canvas.getWindow()
  requestAnimationFrame(() => {
    if (state.selectedId) {
      const component = editor.Components.getById(state.selectedId)
      if (component) editor.select(component)
    }
    frame?.scrollTo(state.scrollX, state.scrollY)
  })
}
