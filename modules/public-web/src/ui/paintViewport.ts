// Paint the two viewport-edge surfaces: the page background (html/body, behind the bottom URL bar)
// and the `theme-color` meta (top header/notch area). Shared by the public shell and the admin hook.

/** Set the page background + upsert the `theme-color` meta. */
export function paintViewport(pageBg: string, themeColor: string, scheme?: 'light' | 'dark'): void {
  if (scheme) {
    document.documentElement.style.colorScheme = scheme
    document.body.style.colorScheme = scheme
    let schemeMeta = document.querySelector('meta[name="color-scheme"]')
    if (schemeMeta === null) {
      schemeMeta = document.createElement('meta')
      schemeMeta.setAttribute('name', 'color-scheme')
      document.head.appendChild(schemeMeta)
    }
    schemeMeta.setAttribute('content', scheme)
  }
  document.documentElement.style.background = pageBg
  document.body.style.background = pageBg
  let meta = document.querySelector('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  // The OS-specific bootstrap tags are only for the first paint. Once a visitor chooses a
  // theme, expose one unconditional color so browser chrome does not retain an OS variant.
  meta.removeAttribute('media')
  meta.setAttribute('content', themeColor)
  for (const item of document.querySelectorAll('meta[name="theme-color"]'))
    if (item !== meta) item.remove()
}
