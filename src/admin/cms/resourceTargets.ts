import { isReadOnlyPreview } from './editorPolicy'
import type { Component, Editor } from 'grapesjs'
import type { CmsDocument } from '../../../shared/cms'
import type { ResourceDestination } from '../../../shared/cms-resource-assignment'
import { nativeNodeId } from '../../cms/instanceScope'

/** A click on an SVG path/text selects the complete replaceable graphic. */
export function resourceGraphic(component: Component): Component | undefined {
  let current: Component | undefined = component
  while (current) {
    if (['img', 'svg'].includes(String(current.get('tagName')).toLowerCase())) return current
    current = current.parent()
  }
  return undefined
}

/** Resolve native repeated records by the same stable key algorithm as nativeTree.
 * Names, positions and image filenames must never decide which person is edited. */
export function contextualDestination(
  graphic: Component,
  document: CmsDocument,
): ResourceDestination | undefined {
  let child = graphic
  let parent = graphic.parent()
  while (parent) {
    if (parent.getAttributes()['data-knc-fold'] === 'barber-marquee') {
      const source = String(parent.getAttributes()['data-knc-source'] ?? '')
      if (!source.startsWith('knc-about-')) return undefined
      const identity = child.getAttributes()['data-knc-source']
      const person = document.barbers.find(({ id }) => {
        const key = [...id].map((char) => char.charCodeAt(0).toString(16)).join('x')
        return identity === nativeNodeId('about', `${source.slice('knc-about-'.length)}-k${key}`)
      })
      if (person) return { purpose: 'profile', barberId: person.id }
      return undefined
    }
    child = parent
    parent = parent.parent()
  }
  const attrs = graphic.getAttributes()
  const viewBox = String(attrs['viewBox'] ?? attrs['viewbox'] ?? '')
  if (['0 0 460 258', '0 0 460 330'].includes(viewBox) && attrs['data-knc-source'])
    return { purpose: 'logo' }
  try {
    const path = new URL(String(attrs['src'] ?? ''), 'https://site.invalid').pathname
    const gallery = path.match(/\/storage\/v1\/object\/public\/gallery\/(salon|cuts|logo)\//)
    if (gallery) return { purpose: gallery[1] as 'salon' | 'cuts' | 'logo' }
    const profile = path.match(/\/storage\/v1\/object\/public\/barber-photos\/([a-z0-9-]+)\//)
    if (profile && document.barbers.some((person) => person.id === profile[1]))
      return { purpose: 'profile', barberId: profile[1] ?? '' }
  } catch {
    // An invalid authored URL is not a resource assignment target.
  }
  return undefined
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
  } else if (!graphic.getAttributes()['data-knc-required']) {
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
    const element = (event.target as Element | null)?.closest?.('img,svg')
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
