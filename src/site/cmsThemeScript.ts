// Theme logic for Worker-rendered authored CMS pages (legal pages, created pages). These pages ship
// without the app bundle, so this classic inline script alone resolves `data-cms-mode="auto"` from
// the visitor's OS scheme, paints html/body with the page surface (body, html, then the page's first
// element, the first that is not transparent) and sets theme-color to it, repaints when the OS
// scheme changes, and points the header theme toggle at the opposite of the shown scheme.
//
// The production CSP (public/_headers) allows exactly this text through its sha256 hash, so it must
// stay byte-static: no interpolation, every input is read from the DOM. Editing it means updating
// that hash; tests/unit/cmsThemeScript.test.ts fails until the two match.
export const CMS_THEME_SCRIPT = String.raw`(() => {
  const root = document.getElementById('root')
  const html = document.documentElement
  const body = document.body
  const requested = root ? root.dataset.cmsMode : undefined
  const darkQuery = matchMedia('(prefers-color-scheme: dark)')
  const scheme = () =>
    requested === 'light' || requested === 'dark' ? requested : darkQuery.matches ? 'dark' : 'light'
  const visible = (color) =>
    color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color) && !/\/\s*0\)$/.test(color)
  const paint = () => {
    const shown = scheme()
    for (const element of [html, body]) {
      element.style.background = ''
      element.style.colorScheme = shown
    }
    const surface = [body, html, root && root.firstElementChild]
      .map((element) => (element ? getComputedStyle(element).backgroundColor : 'transparent'))
      .find(visible)
    if (surface) {
      for (const element of [html, body]) element.style.background = surface
      for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
        meta.setAttribute('content', surface)
    }
    for (const link of document.querySelectorAll('a.cms-site-action-theme')) {
      const url = new URL(link.href)
      url.searchParams.set('mode', shown === 'dark' ? 'light' : 'dark')
      link.href = url.pathname + url.search + url.hash
    }
  }
  paint()
  if (requested === 'auto') darkQuery.addEventListener('change', paint)
})()`
