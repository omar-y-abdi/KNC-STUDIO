// style-hover / style-focus replication: inject `.scpN:<pseudo>{css}` with NO !important, so the
// inline-vs-pseudo cascade behaves the usual way (inline styles win over the pseudo rule).
//
// Effect (DOM stylesheet mutation) is isolated to this module: the <style> element is created
// once at import time. The injected rule text is built from app-controlled CSS literals only
// (never user input).

const styleEl: HTMLStyleElement = document.createElement('style')
document.head.appendChild(styleEl)

const cache = new Map<string, string>()
let counter = 0

/**
 * Returns a generated class name whose `:pseudo` rule applies the given `css`.
 * Stable per (pseudo, css) pair so repeated calls reuse the same class + rule.
 */
export function pseudoClass(pseudo: string, css: string): string {
  const key = `${pseudo}|${css}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const cls = `scp${(counter++).toString(36)}`
  const sheet = styleEl.sheet
  if (sheet) {
    sheet.insertRule(`.${cls}:${pseudo}{${css}}`, sheet.cssRules.length)
  }
  cache.set(key, cls)
  return cls
}

/** Shared focus ring used by every text input in the booking form. */
export const FOCUS_CLS: string = pseudoClass(
  'focus',
  'border-color:currentColor;box-shadow:0 0 0 3px rgba(128,128,128,.28);',
)
