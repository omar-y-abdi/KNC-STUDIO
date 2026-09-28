import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
// @deno-types="npm:@types/css-tree@2.3.11"
import { parse, walk, generate } from 'css-tree'
import { mediaKey, mediaUrl, type CmsDocument, type MediaRef } from './cms.ts'
import { resourceReference, validateMarkup, type MarkupPolicy } from './cms-markup.ts'

/** Validate the draft once, then look up any number of assets without reparsing it. */
export function resourceUsageIndex(
  document: CmsDocument,
  policy: MarkupPolicy,
): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const add = (key: string, place: string): void => {
    const places = index.get(key) ?? []
    if (!places.includes(place)) places.push(place)
    index.set(key, places)
  }
  for (const image of document.gallery)
    add(`gallery/${image.storage_path}`, `Galleri: ${image.kind}`)
  for (const [id, path] of Object.entries(document.photos))
    add(`barber-photos/${path}`, `Profil: ${id}`)
  const logo = document.settings['homepage_logo_path']
  if (logo) add(`gallery/${logo}`, 'Sidans logotyp')
  for (const [id, image] of Object.entries(document.presentation.images))
    add(mediaKey(image.ref), `Sidelement: ${id}`)
  for (const font of Object.values(document.presentation.fonts ?? {}))
    add(mediaKey(font.ref), `Typsnitt: ${font.name}`)
  for (const email of document.emails)
    if (email.design?.logo)
      add(mediaKey(email.design.logo), `Mejl: ${email.template}/${email.lang}`)
  const variants = [
    ...document.presentation.pages.map((page) => ({
      label: page.path,
      content: page.content,
      nativeAllowed: ['/', '/about', '/booking', '/my-bookings'].includes(page.path),
    })),
    ...Object.entries(document.presentation.regions).flatMap(([name, content]) =>
      content ? [{ label: name, content, nativeAllowed: false }] : [],
    ),
  ]
  const styles = new Map<string, MediaRef[]>()
  for (const entry of variants)
    for (const lang of ['sv', 'en'] as const) {
      const value = entry.content[lang]
      // HTML (including native metadata and inline CSS) is identical in both modes.
      // Keep the publication validator and its page/region bounds, without running it twice.
      const htmlRefs = validateMarkup(value.html, '', policy, {
        native: entry.nativeAllowed && value.html.includes('data-knc-native="1"'),
      }).refs
      for (const mode of ['light', 'dark'] as const) {
        const css = value.css[mode]
        let cssRefs = styles.get(css)
        if (!cssRefs) {
          cssRefs = validateMarkup('', css, policy).refs
          styles.set(css, cssRefs)
        }
        for (const ref of [...htmlRefs, ...cssRefs])
          add(mediaKey(ref), `${entry.label} · ${lang}/${mode}`)
      }
    }
  return index
}

export function resourceUsage(
  document: CmsDocument,
  reference: MediaRef,
  policy: MarkupPolicy,
): string[] {
  return resourceUsageIndex(document, policy).get(mediaKey(reference)) ?? []
}
export function replaceDocumentResource(
  document: CmsDocument,
  previous: MediaRef,
  next: MediaRef,
  policy: MarkupPolicy,
): void {
  const oldKey = mediaKey(previous)
  if (previous.path.endsWith('.woff2') !== next.path.endsWith('.woff2'))
    throw new Error('Ersätt ett typsnitt med ett typsnitt och en bild med en bild.')
  if (previous.bucket !== next.bucket)
    throw new Error(
      'Ersätt med en fil från samma kategori, så att befintliga databaskopplingar bevaras.',
    )
  const profileOwners = Object.entries(document.photos)
    .filter(([, path]) => `barber-photos/${path}` === oldKey)
    .map(([id]) => id)
  for (const id of profileOwners)
    if (!next.path.startsWith(`${id}/`))
      throw new Error('Profilbilden måste tillhöra samma barberare.')
  const replacesHomepageLogo = `gallery/${document.settings['homepage_logo_path']}` === oldKey
  if (replacesHomepageLogo && !next.path.startsWith('logo/'))
    throw new Error('Logotypen måste laddas upp som logotyp.')
  for (const font of Object.values(document.presentation.fonts ?? {}))
    if (mediaKey(font.ref) === oldKey) font.ref = { bucket: next.bucket, path: next.path }
  const replace = (raw: string): string => {
    try {
      const ref = resourceReference(raw, policy)
      return ref && mediaKey(ref) === oldKey ? mediaUrl(next, policy.storageOrigin) : raw
    } catch {
      return raw
    }
  }
  const css = (raw: string, inline = false): string => {
    const tree = parse(raw, { context: inline ? 'declarationList' : 'stylesheet' })
    walk(tree, (node) => {
      if (node.type === 'Url') node.value = replace(node.value)
    })
    return generate(tree)
  }
  const html = (raw: string): string => {
    const tree = parseFragment(raw)
    const visit = (node: DefaultTreeAdapterMap['node']): void => {
      if ('tagName' in node)
        for (const attr of node.attrs) {
          if (['src', 'href'].includes(attr.name)) attr.value = replace(attr.value)
          if (attr.name === 'style') attr.value = css(attr.value, true)
        }
      if ('childNodes' in node) node.childNodes.forEach(visit)
    }
    visit(tree)
    return serialize(tree)
  }
  for (const image of document.gallery)
    if (`gallery/${image.storage_path}` === oldKey) image.storage_path = next.path
  for (const id of profileOwners) document.photos[id] = next.path
  if (replacesHomepageLogo) document.settings['homepage_logo_path'] = next.path
  for (const image of Object.values(document.presentation.images))
    if (mediaKey(image.ref) === oldKey) image.ref = { bucket: next.bucket, path: next.path }
  for (const email of document.emails)
    if (email.design?.logo && mediaKey(email.design.logo) === oldKey)
      email.design.logo = { bucket: next.bucket, path: next.path }
  for (const content of [
    ...document.presentation.pages.map((page) => page.content),
    ...Object.values(document.presentation.regions),
  ])
    if (content) {
      for (const lang of ['sv', 'en'] as const) {
        content[lang].html = html(content[lang].html)
        for (const mode of ['light', 'dark'] as const)
          content[lang].css[mode] = css(content[lang].css[mode])
      }
    }
}
