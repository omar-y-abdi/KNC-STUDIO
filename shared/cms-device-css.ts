/** Older Studio builds accidentally used the canvas width as a max-width breakpoint.
 * Only their element-ID rules are repaired; source stylesheet class/media rules stay intact. */
import { generate, parse, walk, type Atrule, type StyleSheet } from 'css-tree'
export function repairDesktopCss(css: string): string {
  if (!/max-width\s*:\s*1440px/.test(css)) return css
  const tree = parse(css)
  walk(tree, {
    visit: 'Atrule',
    enter(node) {
      if (
        node.name !== 'media' ||
        !node.prelude ||
        !node.block ||
        !/^\(max-width:\s*1440px\)$/.test(generate(node.prelude))
      )
        return
      const rules = node.block.children.toArray()
      if (
        !rules.length ||
        !rules.every((rule) => rule.type === 'Rule' && /^#[\w-]+$/.test(generate(rule.prelude)))
      )
        return
      node.prelude = (
        (parse('@media(min-width:769px){}') as StyleSheet).children.first as Atrule
      ).prelude
    },
  })
  return generate(tree)
}
