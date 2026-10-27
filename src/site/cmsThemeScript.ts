// Theme logic for Worker-rendered authored CMS pages (legal pages, created pages). These pages ship
// without the app bundle, so this classic inline script alone keeps the browser chrome in step with
// the page: theme-color follows the page surface (body, html, then the page's first element, the
// first that is not transparent) and is re-derived when the active rules change (a resize across a
// breakpoint, or an OS scheme flip in auto mode), and the header theme toggle points at the opposite
// of the shown scheme. It never writes html or body backgrounds: those stay under the page CSS
// (gradients, breakpoint rules), and cms-reset already removed the shell's pre-paint grey. An
// explicit `?mode` also pins the root color-scheme, which owner CSS such as
// `:root{color-scheme:light dark}` would otherwise hand back to the OS.
//
// The production CSP (public/_headers) allows exactly this text through its sha256 hash, so it must
// stay byte-static: no interpolation, every input is read from the DOM. Editing it means updating
// that hash; tests/unit/cmsThemeScript.test.ts fails until the two match.
export const CMS_THEME_SCRIPT = String.raw`(() => {
  const root = document.getElementById('root')
  const html = document.documentElement
  const requested = root ? root.dataset.cmsMode : undefined
  const pinned = requested === 'light' || requested === 'dark' ? requested : null
  const darkQuery = matchMedia('(prefers-color-scheme: dark)')
  const visible = (color) =>
    color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color) && !/\/\s*0\)$/.test(color)
  if (pinned) html.style.colorScheme = pinned
  const update = () => {
    const shown = pinned || (darkQuery.matches ? 'dark' : 'light')
    const surface = [document.body, html, root && root.firstElementChild]
      .map((element) => (element ? getComputedStyle(element).backgroundColor : 'transparent'))
      .find(visible)
    if (surface)
      for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
        meta.setAttribute('content', surface)
    for (const link of document.querySelectorAll('a.cms-site-action-theme')) {
      const url = new URL(link.href)
      url.searchParams.set('mode', shown === 'dark' ? 'light' : 'dark')
      link.href = url.pathname + url.search + url.hash
    }
  }
  let frame = 0
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(update)
  }
  update()
  addEventListener('resize', schedule)
  if (!pinned) darkQuery.addEventListener('change', schedule)
})()`
