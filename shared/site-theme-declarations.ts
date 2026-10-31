import { generate, parse, walk } from 'css-tree'
import type { CmsMode } from './cms'
import { themeStyleValue } from './site-theme'

/** Tokenize captured inline declarations outside the public theme helpers. */
export function themeDeclarations(css: string, mode: CmsMode): string {
  const tree = parse(css, { context: 'declarationList' })
  walk(tree, {
    visit: 'Declaration',
    enter(declaration) {
      const value = parse(
        themeStyleValue(declaration.property, generate(declaration.value), mode),
        { context: 'value' },
      )
      if (value.type === 'Value') declaration.value = value
    },
  })
  return generate(tree)
}
