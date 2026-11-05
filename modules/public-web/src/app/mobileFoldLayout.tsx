import { cloneElement, h, isValidElement } from 'preact'
import type { ComponentChild, ComponentChildren, JSX, VNode } from 'preact'
import { PANEL_COMPACT, PANEL_FULL } from './shared'

/** Add the private scroll carrier after CMS projection, preserving every editable identity.
 * At rest display:contents removes its renderer as well as its sticky positioning. WebKit must
 * not retain this container as the page's old fixed-edge color source after returning home.
 * The visual panel remains mounted and owns its existing styles and full-height flex layout.
 */
export function mobileFoldLayout(tree: JSX.Element, pinned: boolean): JSX.Element {
  const visit = (child: ComponentChild): ComponentChild => {
    if (!isValidElement(child)) return child
    const node = child as VNode<Record<string, unknown>>
    if (node.props['data-knc-fold'] === 'panel') {
      const flatten = (value: ComponentChildren): ComponentChild[] =>
        Array.isArray(value) ? value.flatMap(flatten) : [value]
      const children = flatten(node.props['children'] as ComponentChildren)
      const hero = children.findIndex(
        (child) =>
          isValidElement(child) &&
          (child.props as Record<string, unknown>)['data-knc-fold'] === 'hero',
      )
      const panel =
        hero > 0
          ? cloneElement(node, {}, [
              h(
                'div',
                {
                  key: 'mobile-fold-header',
                  'data-knc-fold': 'header-carrier',
                  style: {
                    display: pinned ? 'block' : 'contents',
                    position: pinned ? 'sticky' : 'static',
                    top: 0,
                    flex: 'none',
                    zIndex: 10,
                    background: 'inherit',
                  },
                },
                children.slice(0, hero),
              ),
              ...children.slice(hero),
            ])
          : node
      return h(
        'div',
        {
          key: node.key,
          'data-knc-fold': 'carrier',
          style: {
            display: pinned ? 'block' : 'contents',
            position: pinned ? 'sticky' : 'static',
            top: `calc(${PANEL_COMPACT} - ${PANEL_FULL})`,
            height: PANEL_FULL,
            zIndex: 10,
          },
        },
        panel,
      )
    }
    const children = node.props['children'] as ComponentChildren
    if (children === undefined) return node
    const map = (value: ComponentChildren): ComponentChildren =>
      Array.isArray(value) ? value.map(map) : visit(value)
    return cloneElement(node, {}, map(children))
  }
  return visit(tree) as JSX.Element
}
