import { describe, expect, it } from 'vitest'
import { resourceReference, validateMarkup } from '../../shared/cms-markup'

// SQL reads stored references by their literal spelling; Edge may accept only that spelling.
const policy = { siteOrigin: 'https://site.example', storageOrigin: 'https://media.example' }
const canonical = 'https://media.example/storage/v1/object/public/cms-library/images/archived.webp'

describe('canonical storage references', () => {
  it('accepts the canonical library URL', () => {
    expect(resourceReference(canonical, policy)).toEqual({
      bucket: 'cms-library',
      path: 'images/archived.webp',
    })
  })

  it.each([
    [
      'percent-encoding',
      'https://media.example/storage/v1/object/public/cms-library/%69mages/archived.webp',
    ],
    [
      'dot segments',
      'https://media.example/storage/v1/object/public/cms-library/images/./archived.webp',
    ],
    [
      'an explicit default port',
      'https://media.example:443/storage/v1/object/public/cms-library/images/archived.webp',
    ],
    [
      'an uppercase host',
      'https://MEDIA.example/storage/v1/object/public/cms-library/images/archived.webp',
    ],
  ])('rejects %s', (_case, url) => {
    expect(() => resourceReference(url, policy)).toThrow(
      'Bildadressen måste vara bibliotekets egen adress',
    )
  })

  it('rejects a CSS escape inside url()', () => {
    const css =
      '.hero{background:url("https://media.example/storage/v1/object/public/cms-library/\\69mages/archived.webp")}'
    expect(() => validateMarkup('', css, policy)).toThrow(
      'Bildadressen måste vara bibliotekets egen adress',
    )
  })

  it('accepts a canonical CSS url()', () => {
    expect(validateMarkup('', `.hero{background:url("${canonical}")}`, policy).refs).toEqual([
      { bucket: 'cms-library', path: 'images/archived.webp' },
    ])
  })

  it('accepts a quoted canonical url() with surrounding whitespace', () => {
    expect(validateMarkup('', `.hero{background:url(  '${canonical}'  )}`, policy).refs).toEqual([
      { bucket: 'cms-library', path: 'images/archived.webp' },
    ])
  })
})

// Every reference Edge accepts must be one the SQL extractor reads from the same stored text,
// and the other way round (internal_cms_document_media_placements, markup_source).
describe('references visible to the database', () => {
  const escapedPath = canonical.replace('/images/', '/\\69mages/')
  const rejected = 'Bildadressen måste vara bibliotekets egen adress'
  // The visible src shows another file, as in a native image whose light baseline is unchanged.
  const other = canonical.replace('archived.webp', 'visible.webp')
  const native = (attribute: string, src = other) =>
    `<img src="${src}" alt="" data-knc-native="1" data-knc-baseline="${attribute}">`
  const json = (src: string) => JSON.stringify({ src }).replaceAll('"', '&quot;')

  it('rejects a CSS comment decoy that the database discards', () => {
    const css = `/* ${canonical}.. */ .hero{background:url("${escapedPath}")}`
    expect(() => validateMarkup('', css, policy)).toThrow(rejected)
  })

  it('rejects an escaped url() function name', () => {
    const css = `.hero{background:u\\72l("${escapedPath}")}`
    expect(() => validateMarkup('', css, policy)).toThrow('Unsafe CSS function')
  })

  it('rejects an escaped url() function name even with a canonical path', () => {
    const css = `.hero{background:u\\72l("${canonical}")}`
    expect(() => validateMarkup('', css, policy)).toThrow('Unsafe CSS function')
  })

  it.each([
    ['JSON-escaped slashes', canonical.replaceAll('/', '\\/')],
    ['a JSON-escaped slash before the path', canonical.replace('/images/', '\\u002fimages/')],
    ['a JSON unicode escape in the path', canonical.replace('/images/', '/\\u0069mages/')],
  ])('rejects native metadata hiding the path with %s', (_case, src) => {
    const attribute = `{&quot;src&quot;:&quot;${src}&quot;}`
    expect(() => validateMarkup(native(attribute), '', policy, { native: true })).toThrow(rejected)
  })

  it('accepts the production shape: a src attribute plus entity-encoded native JSON', () => {
    const result = validateMarkup(native(json(canonical), canonical), '', policy, { native: true })
    expect(result.refs).toEqual([
      { bucket: 'cms-library', path: 'images/archived.webp' },
      { bucket: 'cms-library', path: 'images/archived.webp' },
    ])
    expect(result.html).toContain(`&quot;src&quot;:&quot;${canonical}&quot;`)
  })

  it('accepts a canonical storage URL mentioned in text', () => {
    expect(validateMarkup(`<p>${canonical}</p>`, '', policy).refs).toEqual([])
  })

  it('records a link to a library file as a reference', () => {
    expect(validateMarkup(`<a href="${canonical}">Bild</a>`, '', policy).refs).toEqual([
      { bucket: 'cms-library', path: 'images/archived.webp' },
    ])
  })

  it('rejects a percent-encoded link to a library file', () => {
    const href = canonical.replace('/images/', '/%69mages/')
    expect(() => validateMarkup(`<a href="${href}">Bild</a>`, '', policy)).toThrow(rejected)
  })
})

// SVG presentation attributes are CSS: url() in them loads resources like a stylesheet does.
describe('SVG presentation attributes', () => {
  const rejected = 'Bildadressen måste vara bibliotekets egen adress'
  const svg = (attribute: string) =>
    `<svg viewBox="0 0 1 1"><rect width="1" height="1" ${attribute}/></svg>`

  it.each([
    ['an escaped path', canonical.replace('/images/', '/\\69mages/')],
    ['a percent-encoded path', canonical.replace('/images/', '/%69mages/')],
  ])('rejects a mask with %s', (_case, url) => {
    expect(() => validateMarkup(svg(`mask="url(${url})"`), '', policy)).toThrow(rejected)
  })

  it('records a canonical mask image as a reference', () => {
    expect(validateMarkup(svg(`mask="url(${canonical})"`), '', policy).refs).toEqual([
      { bucket: 'cms-library', path: 'images/archived.webp' },
    ])
  })

  it.each(['mask', 'fill', 'clip-path', 'stroke'])('accepts %s="url(#id)"', (name) => {
    expect(validateMarkup(svg(`${name}="url(#shape)"`), '', policy).refs).toEqual([])
  })
})
