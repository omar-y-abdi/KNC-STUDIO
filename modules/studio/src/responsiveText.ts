import type { Editor, Component } from 'grapesjs'

const directText = (node: Element): string =>
  [...node.childNodes]
    .map((child) =>
      child.nodeType === 3 ? child.textContent : child.nodeName === 'BR' ? '\n' : '',
    )
    .join('')
const sourceText = (node: Element): string => {
  try {
    return String(JSON.parse(node.getAttribute('data-knc-baseline') ?? '{}').text ?? '')
  } catch {
    return ''
  }
}

/** Desktop/mobile shell trees differ structurally. Pair only unambiguous original text bindings;
 * keep each target's native element, icons, styles and runtime identity. */
export function syncResponsiveText(editor: Editor, beforeHtml: string, afterHtml: string): void {
  const parser = new DOMParser()
  const before = parser.parseFromString(beforeHtml, 'text/html')
  const after = parser.parseFromString(afterHtml, 'text/html')
  for (const source of after.querySelectorAll('[data-knc-source]')) {
    const previous = before.getElementById(source.id)
    if (!previous || source.closest('svg')) continue
    const text = directText(source)
    if (text === directText(previous)) continue
    const surface =
      source
        .closest('[data-knc-surface^="desktop-"],[data-knc-surface^="mobile-"]')
        ?.getAttribute('data-knc-surface') ?? ''
    if (!/^(desktop|mobile)-/.test(surface)) continue
    const opposite = surface.replace(
      /^(desktop|mobile)-/,
      surface.startsWith('desktop-') ? 'mobile-' : 'desktop-',
    )
    const binding = sourceText(source)
    if (!binding.trim()) continue
    const candidates = [
      ...after.querySelectorAll(`[data-knc-surface="${opposite}"] [data-knc-source]`),
    ].filter((node) => !node.closest('svg') && sourceText(node) === binding)
    if (candidates.length !== 1) continue
    const target = candidates[0]
    if (!target) continue
    const component = editor.getWrapper()?.find(`#${CSS.escape(target.id)}`)[0]
    if (!component) continue
    const escaped = document.createElement('span')
    escaped.textContent = text
    if ([...target.children].every((child) => child.tagName === 'BR')) {
      component.components(escaped.innerHTML.replace(/\r?\n/g, '<br>'))
    } else {
      const nodes = component.components().filter((child: Component) => child.is('textnode'))
      // Mixed text with one caption (e.g. opening hours beside a clock icon).
      if (nodes.length === 1) {
        nodes[0]?.set('content', escaped.innerHTML.replace(/\r?\n/g, '<br>'))
        nodes[0]?.getView()?.render()
      }
    }
  }
}
