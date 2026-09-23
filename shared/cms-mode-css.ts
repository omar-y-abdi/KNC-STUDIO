import { generate, parse, walk } from 'css-tree'
import type { CmsMode } from './cms.ts'

/** Captured legal styles use OS color-scheme queries. A CMS variant has an explicit
 * selected mode, which must not change with the editor's or visitor's OS setting. */
export function modeCss(css: string, mode: CmsMode): string {
  if (!css.includes('prefers-color-scheme')) return css
  const tree = parse(css)
  walk(tree, {
    visit: 'Atrule',
    enter(node, item, list) {
      if (node.name !== 'media' || !node.prelude || !node.block || !item || !list) return
      const selected = /^\(prefers-color-scheme:(light|dark)\)$/.exec(generate(node.prelude))
      if (!selected) return
      if (selected[1] === mode) list.insertList(node.block.children, item)
      list.remove(item)
    },
  })
  return generate(tree)
}
