// Paint the two viewport-edge surfaces: the page background (html/body, behind the bottom URL bar)
// and the `theme-color` meta (top header/notch area). Shared by the public shell and the admin hook.

/** Set the page background + upsert the `theme-color` meta. */
export function paintViewport(pageBg: string, themeColor: string, scheme?: 'light' | 'dark'): void {
  if (scheme) {
    document.documentElement.style.colorScheme = scheme
    document.body.style.colorScheme = scheme
  }
  document.documentElement.style.background = pageBg
  document.body.style.background = pageBg
  let meta = document.querySelector('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  // Once the app selects a mode, override every system-preference variant as well.
  for (const item of document.querySelectorAll('meta[name="theme-color"]'))
    item.setAttribute('content', themeColor)
}
