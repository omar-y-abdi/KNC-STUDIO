import { generate, parse, walk } from 'css-tree'

const documentRoot = 'html body'

function rewriteRootSelector(
  css: string,
  wrapperId: string,
  direction: 'bind' | 'canonicalize',
): string {
  if (!wrapperId) return css
  const tree = parse(css)
  let changed = false
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      if (rule.prelude.type !== 'SelectorList') return
      rule.prelude.children.forEach((selector, item, list) => {
        if (selector.type !== 'Selector') return
        const rootId = selector.children.first
        const matches =
          direction === 'bind'
            ? generate(selector) === documentRoot
            : selector.children.size === 1 &&
              rootId?.type === 'IdSelector' &&
              rootId.name === wrapperId
        if (!matches) return
        const replacement = parse(direction === 'bind' ? '#cms-root' : documentRoot, {
          context: 'selector',
        })
        if (replacement.type !== 'Selector') throw new Error('Invalid CMS root selector')
        if (direction === 'bind') {
          const id = replacement.children.first
          if (id?.type !== 'IdSelector') throw new Error('Invalid CMS root selector')
          id.name = wrapperId
        }
        list.replace(item, list.createItem(replacement))
        changed = true
      })
    },
  })
  return changed ? generate(tree) : css
}

/** Use the editor's selectable wrapper for stored document-body rules. */
export function bindCmsRootStyles(css: string, wrapperId: string): string {
  return rewriteRootSelector(css, wrapperId, 'bind')
}

/** Persist root styles against the real page body, never a transient GrapesJS ID. */
export function canonicalizeCmsRootStyles(css: string, wrapperId: string): string {
  return rewriteRootSelector(css, wrapperId, 'canonicalize')
}
