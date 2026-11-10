// Paint the two viewport-edge surfaces: the page background (html/body, behind the bottom URL bar)
// and the `theme-color` meta (top header/notch area). Shared by the public shell and the admin hook.

/** The first `<meta>` of that name, appended to the head when the document has none. */
function namedMeta(name: string): Element {
  let meta = document.querySelector(`meta[name="${name}"]`)
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.appendChild(meta)
  }
  return meta
}

/** Set the page background + upsert the `theme-color` meta. */
export function paintViewport(pageBg: string, themeColor: string, scheme?: 'light' | 'dark'): void {
  if (scheme) {
    document.documentElement.style.colorScheme = scheme
    document.body.style.colorScheme = scheme
    namedMeta('color-scheme').setAttribute('content', scheme)
  }
  document.documentElement.style.background = pageBg
  document.body.style.background = pageBg
  const meta = namedMeta('theme-color')
  // The OS-specific bootstrap tags are only for the first paint. Once a visitor chooses a
  // theme, expose one unconditional color so browser chrome does not retain an OS variant.
  meta.removeAttribute('media')
  meta.setAttribute('content', themeColor)
  for (const item of document.querySelectorAll('meta[name="theme-color"]'))
    if (item !== meta) item.remove()
}

function edgeTint(edge: 'top' | 'bottom', color: string): HTMLElement {
  const tint = document.createElement('div')
  tint.setAttribute('data-viewport-edge', edge)
  tint.setAttribute('aria-hidden', 'true')
  const declarations: readonly (readonly [string, string])[] = [
    ['position', 'fixed'],
    [edge, '0'],
    ['left', '0'],
    ['right', '0'],
    ['height', '24px'],
    // Above the mobile panel (10), below the privacy banner and dialogs (30+).
    ['z-index', '20'],
    ['pointer-events', 'none'],
    ['background-color', color],
    // Safari reads the background colour; the mask paints none of it.
    ['mask-image', 'linear-gradient(transparent, transparent)'],
    ['-webkit-mask-image', 'linear-gradient(transparent, transparent)'],
  ]
  for (const [name, value] of declarations) tint.style.setProperty(name, value)
  return tint
}

/** iOS 26 Safari tints its bars from a fixed box at each edge and keeps a viewport-sized sticky
 *  box's first colour; fresh strips override it. Returns their remover. */
export function paintEdgeTints(top: string, bottom: string): () => void {
  const tints = [edgeTint('top', top), edgeTint('bottom', bottom)]
  for (const tint of tints) document.body.appendChild(tint)
  return () => {
    for (const tint of tints) tint.remove()
  }
}
