// Writes into the document head what app/routeHead.ts decides. The document is a parameter: the app
// passes `document`, a test a stand-in. A tag the shell does not carry is not created, except the
// canonical and the language alternates, which come and go with the route.

import type { OpenGraphLocales, RouteIdentity, RouteTexts } from './routeHead'

export function setMetaContent(page: Document, selector: string, content: string): void {
  page.querySelector(selector)?.setAttribute('content', content)
}

export function writeLocales(page: Document, locales: OpenGraphLocales): void {
  setMetaContent(page, 'meta[property="og:locale"]', locales.locale)
  setMetaContent(page, 'meta[property="og:locale:alternate"]', locales.alternate)
}

function appendLink(page: Document): Element {
  return page.head.appendChild(page.createElement('link'))
}

/** The identity of the route the app itself moved to: robots, canonical, `og:url`, the language
 * alternates and the locales, as the Worker renders them for that address. */
export function writeRouteIdentity(page: Document, identity: RouteIdentity): void {
  setMetaContent(page, 'meta[name="robots"]', identity.robots)
  setMetaContent(page, 'meta[property="og:url"]', identity.url)
  writeLocales(page, identity.locales)
  const canonical = page.querySelector('link[rel="canonical"]')
  if (identity.canonical === null) canonical?.remove()
  else {
    const link = canonical ?? appendLink(page)
    link.setAttribute('rel', 'canonical')
    link.setAttribute('href', identity.canonical)
  }
  const alternates = [...page.querySelectorAll('link[rel="alternate"][hreflang]')]
  identity.alternates.forEach((alternate, index) => {
    const link = alternates[index] ?? appendLink(page)
    link.setAttribute('rel', 'alternate')
    link.setAttribute('hreflang', alternate.hreflang)
    link.setAttribute('href', alternate.href)
  })
  for (const link of alternates.slice(identity.alternates.length)) link.remove()
}

/** The title and the description, in every tag that repeats them. */
export function writeRouteTexts(page: Document, texts: RouteTexts): void {
  page.title = texts.title
  setMetaContent(page, 'meta[name="description"]', texts.description)
  setMetaContent(page, 'meta[property="og:title"]', texts.title)
  setMetaContent(page, 'meta[property="og:description"]', texts.description)
  setMetaContent(page, 'meta[name="twitter:title"]', texts.title)
  setMetaContent(page, 'meta[name="twitter:description"]', texts.description)
}
