import { isReadOnlyPreview } from './editorPolicy'
import type { Component, Editor } from 'grapesjs'
import type { CmsDocument } from '../../../shared/cms'
import type { ResourceDestination } from '../../../shared/cms-resource-assignment'
import { resourceTarget } from '../../../shared/cms-resource-target'

/** A click on an SVG path/text selects the complete replaceable graphic. */
export function resourceGraphic(component: Component): Component | undefined {
  let current: Component | undefined = component
  while (current) {
    if (['img', 'svg'].includes(String(current.get('tagName')).toLowerCase())) return current
    current = current.parent()
  }
  return undefined
}

export function canReplaceResourceGraphic(component: Component): boolean {
  const protectedNode = (node: Component): boolean =>
    Boolean(node.getAttributes()['data-knc-required'] || node.getAttributes()['data-knc-slot'])
  return (
    ['img', 'svg'].includes(String(component.get('tagName')).toLowerCase()) &&
    !protectedNode(component) &&
    !component.findFirstType(protectedNode)
  )
}

/** Resolve native repeated records by the same stable key algorithm as nativeTree.
 * Names, positions and image filenames must never decide which person is edited. */
export function contextualDestination(
  graphic: Component,
  document: CmsDocument,
): ResourceDestination | undefined {
  const chain: Record<string, unknown>[] = []
  for (let current: Component | undefined = graphic; current; current = current.parent())
    chain.push(current.getAttributes())
  return resourceTarget(chain, document.barbers)
}

export function openResourcePicker(
  editor: Editor,
  component: Component,
  document: CmsDocument | undefined,
  destinationPicker: ((destination: ResourceDestination) => void) | undefined,
  graphicPicker: (graphic: Component) => void,
): boolean {
  const graphic = resourceGraphic(component)
  if (!graphic || isReadOnlyPreview(graphic)) return false
  const destination = document && contextualDestination(graphic, document)
  if (destination && destinationPicker) {
    editor.AssetManager.close()
    destinationPicker(destination)
  } else if (canReplaceResourceGraphic(graphic)) {
    editor.AssetManager.close()
    graphicPicker(graphic)
  } else return false
  return true
}

/** GrapesJS has image-view dblclick handlers, not a component:dblclick event.
 * Delegate in the actual iframe so SVGs and photo-less placeholders work too. */
export function connectResourcePicker(
  editor: Editor,
  options: () => {
    locked: boolean
    draft?: CmsDocument
    onOpenResources?: (destination: ResourceDestination) => void
  },
  graphicPicker: (graphic: Component) => void,
): () => void {
  let document: Document | undefined
  const click = (event: MouseEvent): void => {
    const current = options()
    const target = event.target as Element | null
    const placeholder = target?.closest?.(
      '[data-knc-slot] > [aria-hidden="true"][data-knc-surface]',
    )
    const element = target?.closest?.('img,svg') ?? placeholder?.querySelector('svg')
    if (current.locked || !element?.id) return
    const component = editor.Components.getById(element.id)
    if (!component) return
    if (
      openResourcePicker(editor, component, current.draft, current.onOpenResources, graphicPicker)
    ) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const attach = (context?: { window: Window }): void => {
    document?.removeEventListener('dblclick', click, true)
    document = context?.window.document ?? editor.Canvas.getDocument() ?? undefined
    document?.addEventListener('dblclick', click, true)
  }
  editor.on('canvas:frame:load', attach)
  attach()
  return () => {
    editor.off('canvas:frame:load', attach)
    document?.removeEventListener('dblclick', click, true)
  }
}
