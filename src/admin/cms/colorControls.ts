import type { Editor } from 'grapesjs'

/** A Style Manager property as this module reads it. GrapesJS properties satisfy it; composite
 * and stack properties also list their sub-properties. */
export interface StyleProperty {
  getType(): string
  getFullValue(value?: string, opts?: { skipImportant?: boolean }): string
  getProperties?(): readonly StyleProperty[]
}

/** The part of a GrapesJS color view this module drives. PropertyView sets itself on its model
 * as `view`; the color view's setValue shows a value and makes it the color it commits. */
export interface ColorView {
  setValue(value: string): void
}

const isColorView = (value: unknown): value is ColorView =>
  typeof value === 'object' &&
  value !== null &&
  'setValue' in value &&
  typeof value.setValue === 'function'

/** Every mounted color control among the properties, sub-properties of composites and stacks
 * included, with its property's value as PropertyView shows it after a change. */
export function colorControls(
  properties: readonly StyleProperty[],
): { view: ColorView; value: string }[] {
  return properties.flatMap((property) => {
    const view: unknown = 'view' in property ? property.view : undefined
    return [
      ...(property.getType() === 'color' && isColorView(view)
        ? [{ view, value: property.getFullValue(undefined, { skipImportant: true }) }]
        : []),
      ...colorControls(property.getProperties?.() ?? []),
    ]
  })
}

/** A GrapesJS color input commits the color it last showed whenever a component is selected
 * (InputColor, grapesjs 0.23.6), into the Style Manager's targets, which still belong to the
 * former selection. A render shows the default of a property without a value, so a passive
 * selection could write that default into the former rule. Before each selection, every color
 * control takes its property's value again: the commit then repeats what the targets hold, and
 * a picker change in progress still completes. */
export function connectColorControls(editor: Editor): () => void {
  const sync = (): void => {
    const properties = editor.StyleManager.getSectors({ array: true }).flatMap((sector) =>
      sector.getProperties(),
    )
    for (const { view, value } of colorControls(properties)) view.setValue(value)
  }
  editor.on('component:select:before', sync)
  return () => {
    editor.off('component:select:before', sync)
  }
}
