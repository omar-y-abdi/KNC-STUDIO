/** Older Studio builds accidentally used the canvas width as a max-width breakpoint.
 * Only their element-ID rules are repaired; source stylesheet class/media rules stay intact. */
import { generate, parse, walk, type Atrule, type StyleSheet } from 'css-tree'
export function isLegacyDesktopMedia(node: Atrule): boolean {
  if (
    node.name !== 'media' ||
    !node.prelude ||
    !node.block ||
    !/^\(max-width:\s*1440px\)$/.test(generate(node.prelude))
  )
    return false
  const rules = node.block.children.toArray()
  return (
    rules.length > 0 &&
    rules.every((rule) => rule.type === 'Rule' && /^#[\w-]+$/.test(generate(rule.prelude)))
  )
}

export function repairDesktopCss(css: string): string
export function repairDesktopCss(css: StyleSheet): StyleSheet
export function repairDesktopCss(css: string | StyleSheet): string | StyleSheet {
  if (typeof css === 'string' && !/max-width\s*:\s*1440px/.test(css)) return css
  const tree = typeof css === 'string' ? (parse(css) as StyleSheet) : css
  walk(tree, {
    visit: 'Atrule',
    enter(node) {
      if (!isLegacyDesktopMedia(node)) return
      node.prelude = (
        (parse('@media(min-width:769px){}') as StyleSheet).children.first as Atrule
      ).prelude
    },
  })
  return typeof css === 'string' ? generate(tree) : tree
}
