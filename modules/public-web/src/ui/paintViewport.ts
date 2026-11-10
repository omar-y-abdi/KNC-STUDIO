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
