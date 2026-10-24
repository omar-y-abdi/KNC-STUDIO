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
})
