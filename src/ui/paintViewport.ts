// Paint the two viewport-edge surfaces: the page background (html/body, behind the bottom URL bar)
// and the `theme-color` meta (top header/notch area). Shared by the public shell and the admin hook.

/** Set the page background + upsert the `theme-color` meta. */
export function paintViewport(pageBg: string, themeColor: string): void {
  document.documentElement.style.background = pageBg
  document.body.style.background = pageBg
  let meta = document.querySelector('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', themeColor)
}
